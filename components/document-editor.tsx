import {memo,useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {createPortal} from 'react-dom';
import {Button} from './ui/button';
import {ObjectTools,ObjectSelection} from './editor-object-tools';
import {createEditCopy,renderPage,type DocumentSession,type EditSession} from '@/lib/hwp-engine';
import type {EditCommand,EditState} from '@/lib/edit-model';
import {draftId,readDraft,writeDraft,lockDraft,type EditDraft} from '@/lib/edit-drafts';

const EditorPage=memo(function EditorPage({session,index}:{session:DocumentSession;index:number}){
  const element=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false),[svg,setSvg]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{root:element.current?.closest('.editor-scroll'),rootMargin:'300px'});if(element.current)observer.observe(element.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{let active=true;if(visible){setError('');void renderPage(session,index).then(value=>{if(active)setSvg(value);},()=>{if(active)setError('페이지를 표시하지 못했습니다.');});}else setSvg('');return()=>{active=false;};},[session,index,visible]);
  return <div ref={element} className="editor-page-content page-svg" aria-hidden="true">{error?<span className="sheet-status">{error}</span>:svg?<div dangerouslySetInnerHTML={{__html:svg}}/>:<span className="sheet-status">페이지 표시 중…</span>}</div>;
});

/** Native modal keeps the original viewer inert. It is never replaced by the draft. */
export function DocumentEditor({file,onClose}:{file:File;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLTextAreaElement>(null);
  const alive=useRef(true),sessionRef=useRef<EditSession|null>(null),stateRef=useRef<EditState|null>(null);
  const queue=useRef<Promise<unknown>>(Promise.resolve()),composing=useRef(false),savedRevision=useRef(0);
  const focusRequested=useRef(false);
  const pendingCommands=useRef(0);
  const sourceId=useRef(''),savedDraftRevision=useRef(-1),savingDraft=useRef<Promise<boolean>|null>(null),saveAfterComposition=useRef(false);
  const sessionId=useRef(crypto.randomUUID()),imageInput=useRef<HTMLInputElement>(null);
  const drag=useRef<{page:number;startX:number;startY:number;lastX:number;lastY:number}|null>(null);
  const [session,setSession]=useState<EditSession|null>(null),[state,setState]=useState<EditState|null>(null);
  const [zoom,setZoom]=useState(1),[busy,setBusy]=useState('편집 복사본을 준비하는 중…'),[error,setError]=useState('');
  const [composition,setComposition]=useState(''),[focused,setFocused]=useState(false),[confirmClose,setConfirmClose]=useState(false);
  const [password,setPassword]=useState<{retry:boolean;finish:(value:string|null)=>void}|null>(null);
  const [saved,setSaved]=useState(false);
  const [draftStatus,setDraftStatus]=useState('자동저장 준비 중…');
  const [restorePrompt,setRestorePrompt]=useState<{draft:EditDraft;choose:(restore:boolean)=>void}|null>(null);
  const [historyId,setHistoryId]=useState('');
  const [tablePrompt,setTablePrompt]=useState(false);
  const clipboardToken=useRef('');
  const focus=()=>input.current?.focus({preventScroll:true});
  useEffect(()=>{
    alive.current=true;dialog.current?.showModal();const controller=new AbortController();
    void (async()=>{
      const id=await draftId(file);await lockDraft(id,controller.signal);sourceId.current=id;
      const draft=await readDraft(id);controller.signal.throwIfAborted();let openingFile=file;
      if(draft){
        const restore=await new Promise<boolean>((resolve,reject)=>{const cancel=()=>reject(new DOMException('취소','AbortError'));controller.signal.addEventListener('abort',cancel,{once:true});setRestorePrompt({draft,choose:restore=>{controller.signal.removeEventListener('abort',cancel);setRestorePrompt(null);resolve(restore);}});});
        if(restore){openingFile=new File([draft.blob],file.name,{lastModified:draft.savedAt});savedDraftRevision.current=0;setDraftStatus('이전 자동저장본을 복원했습니다.');}
      }
      controller.signal.throwIfAborted();
      return createEditCopy(openingFile,controller.signal,retry=>new Promise(resolve=>{
      const finish=(value:string|null)=>{controller.signal.removeEventListener('abort',cancel);if(alive.current)setPassword(null);resolve(value);};
      const cancel=()=>finish(null);controller.signal.addEventListener('abort',cancel,{once:true});
      if(controller.signal.aborted)finish(null);else setPassword({retry,finish});
      }));
    })().then(async value=>{
      if(!alive.current||controller.signal.aborted){value.doc.free();return;}
      sessionRef.current=value;const initial=await value.doc.editState();
      if(alive.current){stateRef.current=initial;setState(initial);setSession(value);setBusy('');if(savedDraftRevision.current<0)setDraftStatus('10초마다 자동저장 · 파일별 최신 1개 보관');}
    }).catch(reason=>{if(alive.current&&!controller.signal.aborted){setBusy('');setError(String(reason instanceof Error?reason.message:reason));}});
    const preventLoss=(event:BeforeUnloadEvent)=>{if(composing.current||pendingCommands.current||(stateRef.current?.revision??0)!==savedDraftRevision.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',preventLoss);
    return()=>{alive.current=false;controller.abort();sessionRef.current?.doc.free();sessionRef.current=null;window.removeEventListener('beforeunload',preventLoss);};
  },[file]);
  const run=(command:EditCommand)=>{
    pendingCommands.current++;
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(!alive.current||!sessionRef.current){pendingCommands.current--;return;}
      try{if(command.kind==='imageMove'||command.kind==='pageNumbers'||command.kind==='undo'||command.kind==='redo')clipboardToken.current='';const next=await sessionRef.current.doc.edit(command);if(alive.current){if(command.kind!=='format')focusRequested.current=true;stateRef.current=next;setState(next);setSaved(next.revision===savedRevision.current&&savedRevision.current>0);setError('');}}
      catch(reason){if(alive.current)setError(String(reason instanceof Error?reason.message:reason));}
      finally{pendingCommands.current--;}
    });
  };
  const persist=():Promise<boolean>=>{
    if(savingDraft.current)return savingDraft.current.then(()=>persistRef.current());
    if(composing.current){saveAfterComposition.current=true;return Promise.resolve(false);}
    if(!sessionRef.current||!sourceId.current)return Promise.resolve(false);
    const task=queue.current.catch(()=>{}).then(async()=>{
      const current=sessionRef.current,revision=stateRef.current?.revision;if(!current||revision===undefined||!alive.current)return false;
      if(savedDraftRevision.current===revision){setDraftStatus('최신 변경이 자동저장되어 있습니다.');return true;}
      setDraftStatus('자동저장 중…');
      const bytes=await current.doc.exportCopy(/\.hwpx$/i.test(file.name)?'hwpx':'hwp');
      await writeDraft({id:sourceId.current,name:current.name,blob:new Blob([bytes]),savedAt:Date.now(),revision,sessionId:sessionId.current});
      savedDraftRevision.current=revision;if(alive.current)setDraftStatus('자동저장 완료 · '+new Date().toLocaleTimeString());return true;
    }).catch(reason=>{if(alive.current)setDraftStatus('자동저장 실패 — 이전 저장본은 유지됩니다. '+String(reason instanceof Error?reason.message:reason));return false;});
    queue.current=task;savingDraft.current=task;void task.finally(()=>{savingDraft.current=null;});return task;
  };
  const checkpoint=()=>{
    queue.current=queue.current.catch(()=>{}).then(async()=>{if(!sessionRef.current||!alive.current)return;try{const next=await sessionRef.current.doc.checkpoint();if(alive.current){stateRef.current=next;setState(next);}}catch(reason){if(alive.current)setError('세션 이력을 저장하지 못했습니다. '+String(reason));}});
  };
  const restoreHistory=()=>{
    if(!historyId)return;
    queue.current=queue.current.catch(()=>{}).then(async()=>{if(!sessionRef.current||!alive.current)return;try{const next=await sessionRef.current.doc.restoreCheckpoint(Number(historyId));if(alive.current){stateRef.current=next;setState(next);setError('');setSaved(false);}}catch(reason){if(alive.current)setError('이력을 복원하지 못했습니다. '+String(reason));}});
  };
  const persistRef=useRef(persist);persistRef.current=persist;
  const checkpointRef=useRef(checkpoint);checkpointRef.current=checkpoint;
  useEffect(()=>{
    if(!session)return;checkpointRef.current();
    const autosave=setInterval(()=>void persistRef.current(),10_000),history=setInterval(()=>checkpointRef.current(),60_000);
    const hidden=()=>{if(document.visibilityState==='hidden')void persistRef.current();};document.addEventListener('visibilitychange',hidden);
    return()=>{clearInterval(autosave);clearInterval(history);document.removeEventListener('visibilitychange',hidden);};
  },[session]);
  const renderSession=useMemo(()=>session&&state?{...session,key:session.key+'-edit-'+state.revision,pages:state.pages}:null,[session,state?.revision]);
  const requestClose=async()=>{if(!sessionRef.current){onClose();return;}await queue.current;if(alive.current)setConfirmClose(true);};
  const returnToViewer=async()=>{if(!sessionRef.current){onClose();return;}setBusy('최신 편집 내용을 자동저장하는 중…');if(await persist())onClose();else if(alive.current)setBusy('');};
  const download=async(close=false)=>{
    if(!sessionRef.current||busy||composing.current)return;
    setBusy('복사본을 저장하는 중…');
    try{
      await queue.current;const current=sessionRef.current;if(!current||!alive.current)return;
      const bytes=await current.doc.exportCopy(/\.hwpx$/i.test(current.name)?'hwpx':'hwp');
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const link=document.createElement('a');link.href=url;link.download=current.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
      savedRevision.current=stateRef.current?.revision??0;setSaved(true);setError('');if(close){await persist();onClose();}
    }catch(reason){setError('복사본을 저장하지 못했습니다. '+String(reason instanceof Error?reason.message:reason));}
    finally{if(alive.current)setBusy('');}
  };
  const insertImage=async(file:File)=>{
    if(file.size>30*1024*1024){setError('그림은 30MB 이하로 넣어 주세요.');return;}
    setBusy('그림을 읽는 중…');
    try{const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();const extension=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp'} as Record<string,string>)[file.type];if(!extension)throw new Error('PNG, JPEG, GIF, WebP, BMP 그림을 선택해 주세요.');run({kind:'imageInsert',bytes:new Uint8Array(await file.arrayBuffer()),width,height,extension,name:file.name});}
    catch(reason){setError('그림을 넣지 못했습니다. '+String(reason));}finally{if(alive.current)setBusy('');}
  };
  const copySelection=(forceObject=false,cut=false)=>{
    if(busy||composing.current)return;
    queue.current=queue.current.catch(()=>{}).then(async()=>{try{if(!sessionRef.current)return;const before=stateRef.current;const object=before?.object;if(cut&&object?.type!=='image')return;clipboardToken.current='';const data=await sessionRef.current.doc.clipboard(forceObject);if(!data.html&&!data.text)return;const token=crypto.randomUUID();await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([data.text],{type:'text/plain'}),'text/html':new Blob(['<div data-hwp-grid-clip="'+token+'">'+data.html+'</div>'],{type:'text/html'})})]);clipboardToken.current=token;if(cut&&object&&before){const next=await sessionRef.current.doc.edit({kind:'cutImage',revision:before.revision,secIdx:object.secIdx,paraIdx:object.paraIdx,controlIdx:object.controlIdx});if(alive.current){focusRequested.current=true;stateRef.current=next;setState(next);setSaved(false);}}setError('');}catch(reason){setError('복사하지 못했습니다. '+String(reason));}});
  };
  const pasteContent=(html:string,text:string)=>{
    if(html){const internal=!!clipboardToken.current&&html.includes(clipboardToken.current);const tree=DOMPurify.sanitize(html,{RETURN_DOM:true,FORBID_TAGS:['script','iframe','object','embed','link','style'],FORBID_ATTR:['srcset']}) as HTMLElement;for(const el of tree.querySelectorAll('[src],[href],[style]')){for(const name of ['src','href'])if(el.hasAttribute(name)&&!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(el.getAttribute(name)!))el.removeAttribute(name);const style=el.getAttribute('style');if(style&&/url\s*\(/i.test(style))el.removeAttribute('style');}run({kind:'paste',html:tree.innerHTML,internal});}
    else if(text)run({kind:'insert',text});
  };
  const pasteClipboard=async()=>{try{for(const item of await navigator.clipboard.read()){if(item.types.includes('text/html')){pasteContent(await (await item.getType('text/html')).text(),item.types.includes('text/plain')?await (await item.getType('text/plain')).text():'');return;}const type=item.types.find(type=>type.startsWith('image/'));if(type){await insertImage(new File([await item.getType(type)],'붙여넣은 그림.'+type.split('/')[1],{type}));return;}if(item.types.includes('text/plain')){pasteContent('',await (await item.getType('text/plain')).text());return;}}}catch{setError('클립보드를 읽지 못했습니다. 입력 위치에서 Ctrl+V를 사용해 주세요.');}};
  const consume=(element:HTMLTextAreaElement)=>{const value=element.value;element.value='';if(value)run({kind:'insert',text:value});};
  const pick=(event:React.PointerEvent<HTMLElement>,page:number,extend=false)=>{
    if(busy||composing.current)return;
    let rect=event.currentTarget.getBoundingClientRect();
    if(extend){const sheets=Array.from(dialog.current?.querySelectorAll<HTMLElement>('.editor-sheet')??[]);const hit=sheets.findIndex(sheet=>{const r=sheet.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;});if(hit>=0){page=hit;rect=sheets[hit].getBoundingClientRect();}}
    focusRequested.current=true;run({kind:'pick',page,x:(event.clientX-rect.left)/zoom,y:(event.clientY-rect.top)/zoom,extend,textOnly:event.altKey});focus();
  };
  useEffect(()=>{if(focusRequested.current&&state?.caret){focusRequested.current=false;focus();}else if(state?.object?.type==='image'){focusRequested.current=false;dialog.current?.querySelector<HTMLButtonElement>('.object-move')?.focus({preventScroll:true});}},[state]);
  useEffect(()=>{if(!state?.caret)return;const caret=dialog.current?.querySelector<HTMLElement>('.edit-caret');caret?.scrollIntoView({block:'nearest',inline:'nearest'});},[state?.caret?.pageIndex,state?.caret?.y]);
  useEffect(()=>{if(confirmClose)dialog.current?.querySelector<HTMLButtonElement>('.editor-prompt button')?.focus();else if(!password&&stateRef.current?.caret)focus();},[confirmClose,password,restorePrompt]);
  const [numberStart,setNumberStart]=useState('1');
  const font=state?.style.fontFamily??'Noto Sans KR';
  const sizes=Array.from(new Set([state?.style.fontSize??10,8,9,10,11,12,14,16,18,20,24,28,32,36,48,72,96])).sort((a,b)=>a-b);
  return createPortal(<dialog ref={dialog} className="document-editor" aria-label="문서 복사본 편집" onCancel={event=>{event.preventDefault();if(tablePrompt)setTablePrompt(false);else if(restorePrompt||password){password?.finish(null);onClose();}else if(confirmClose){if(!busy)setConfirmClose(false);}else void requestClose();}} onCut={event=>{const target=event.target as HTMLElement;if(target.matches('input,select,textarea:not(.edit-input)'))return;if(!confirmClose&&!password&&!restorePrompt&&!tablePrompt&&stateRef.current?.object?.type==='image'){event.preventDefault();copySelection(true,true);}}} onCopy={event=>{const target=event.target as HTMLElement;if(target.matches('input,select,textarea:not(.edit-input)'))return;if(!confirmClose&&!password&&!restorePrompt&&!tablePrompt){event.preventDefault();copySelection();}}} onPaste={event=>{const target=event.target as HTMLElement;if(target.matches('input,select,textarea:not(.edit-input)')||busy||composing.current||confirmClose||password||restorePrompt||tablePrompt)return;event.preventDefault();const image=Array.from(event.clipboardData.files).find(f=>f.type.startsWith('image/'));const html=event.clipboardData.getData('text/html');if(image&&!html)void insertImage(image);else pasteContent(html,event.clipboardData.getData('text/plain'));}} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!confirmClose&&!password&&!restorePrompt&&!tablePrompt)void persist();}}}>
    <header className="editor-header" inert={confirmClose||!!password||!!restorePrompt||tablePrompt}><strong>편집 모드 <span>원본 유지 · 복사본 작업</span></strong><span className="editor-filename" title={session?.name??file.name}>{session?.name??file.name}</span><Button variant="outline" disabled={!session||!!busy} onClick={()=>void persist()}>지금 자동저장</Button><Button disabled={!session||!!busy||!!composition} onClick={()=>void download()}>복사본 다운로드</Button><Button variant="secondary" onClick={()=>void requestClose()}>뷰어로 돌아가기</Button></header>
    <div className="editor-toolbar" inert={confirmClose||!!password||!!restorePrompt||tablePrompt} aria-label="글자 편집 도구">
      <label>글꼴 <select aria-label="글꼴" value={font} disabled={!state?.caret||!!busy} onChange={e=>{run({kind:'format',style:{fontFamily:e.target.value}});focus();}}>{!['Noto Sans KR','Noto Serif KR','Arial'].includes(font)&&<option value={font}>{font} (원래 글꼴)</option>}<option value="Noto Sans KR">본고딕</option><option value="Noto Serif KR">본명조</option><option value="Arial">Arial</option></select></label>
      <label title="선택 글자: Ctrl+Shift+, 작게 / Ctrl+Shift+. 크게">크기 <select aria-label="글자 크기" value={state?.style.fontSize??10} disabled={!state?.caret||!!busy} onChange={e=>{run({kind:'format',style:{fontSize:Number(e.target.value)}});focus();}}>{sizes.map(size=><option key={size} value={size}>{size} pt</option>)}</select></label>
      <label>색상 <input aria-label="글자 색상" type="color" value={state?.style.textColor??'#000000'} disabled={!state?.caret||!!busy} onChange={e=>run({kind:'format',style:{textColor:e.target.value}})}/></label>
      {(['bold','italic','underline'] as const).map((key,i)=><Button key={key} variant="outline" size="sm" aria-label={['굵게','기울임','밑줄'][i]} aria-pressed={!!state?.style[key]} disabled={!state?.caret||!!busy} onClick={()=>{run({kind:'format',style:{[key]:!state?.style[key]}});focus();}}><span style={{fontWeight:key==='bold'?700:undefined,fontStyle:key==='italic'?'italic':undefined,textDecoration:key==='underline'?'underline':undefined}}>{['B','I','U'][i]}</span></Button>)}
      <Button variant="outline" size="sm" disabled={!state?.caret||!!busy} onClick={()=>imageInput.current?.click()}>그림 삽입</Button><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" hidden aria-label="삽입할 그림" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void insertImage(file);}}/>
      <Button variant="outline" size="sm" disabled={!state?.canUndo||!!busy} onClick={()=>{run({kind:'undo'});focus();}}>실행 취소</Button><Button variant="outline" size="sm" disabled={!state?.canRedo||!!busy} onClick={()=>{run({kind:'redo'});focus();}}>다시 실행</Button>
      <label>확대 <select aria-label="편집 화면 확대" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value*100}%</option>)}</select></label>
      <span className="editor-hint">글자를 눌러 입력 · 드래그로 여러 줄·문단 선택 · 서식은 선택 영역 또는 다음 입력에 적용</span>
    </div>
    <div className="editor-toolbar editor-insert" inert={confirmClose||!!password||!!restorePrompt||tablePrompt}>
      <Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>setTablePrompt(true)}>표 만들기</Button><Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>run({kind:'newPage'})}>새 쪽 추가</Button><Button variant="outline" size="sm" disabled={!state?.caret&&!state?.object||!!busy} onClick={()=>copySelection()}>선택 내용 복사</Button><Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>void pasteClipboard()}>붙여넣기</Button><span className="editor-hint">셀 드래그로 여러 셀 선택 · Ctrl+방향키로 셀 이동 · Ctrl+C / Ctrl+V · 그림 Ctrl+X</span>
    </div>
    <div className="editor-toolbar" aria-label="쪽수 도구" inert={confirmClose||!!password||!!restorePrompt||tablePrompt}>
      <strong>쪽수 · 아래 가운데</strong>
      <Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>run({kind:'pageNumbers',startPage:1})}>쪽수 기재하기 · 처음부터 1쪽</Button>
      <label>시작 쪽 <input aria-label="쪽수 시작 쪽" type="number" min="1" max={state?.pages.length??1} value={numberStart} onChange={e=>setNumberStart(e.target.value)} style={{width:70}}/></label>
      <Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>run({kind:'pageNumbers',startPage:Number(numberStart)})}>지정한 쪽부터 1로 매기기</Button>
      <Button variant="outline" size="sm" disabled={!session||!!busy} onClick={()=>run({kind:'pageNumbers',startPage:null})}>쪽수 지우기</Button>
      <span className="editor-hint">시작 쪽 앞에는 번호를 표시하지 않습니다.</span>
    </div>
    <div className="editor-toolbar editor-history" inert={confirmClose||!!password||!!restorePrompt||tablePrompt}>
      <label>이번 편집 이력 <select aria-label="이번 편집 이력" value={historyId} onChange={e=>setHistoryId(e.target.value)}><option value="">복원할 시점 선택</option>{state?.checkpoints?.slice().reverse().map(item=><option key={item.id} value={item.id}>{new Date(item.time).toLocaleTimeString()} · #{item.id}</option>)}</select></label><Button variant="outline" size="sm" disabled={!historyId||!!busy} onClick={restoreHistory}>선택 이력 복원</Button><span className="editor-hint">변경 시 1분마다 · 최대 60개 · 이 창을 닫으면 이력 종료</span>
    </div>
    {state?.object&&<div inert={confirmClose||!!password||!!restorePrompt||tablePrompt}><ObjectTools object={state.object} busy={!!busy} onCommand={run} onCopy={()=>copySelection(true)}/></div>}
    <div className="editor-status" role="status">{busy||error||(saved?'복사본 다운로드를 요청했습니다.':'원본 유지 · 복사본 편집')} <span>{draftStatus}</span></div>
    <div className="editor-scroll" inert={confirmClose||!!password||!!restorePrompt||tablePrompt}>{renderSession?.pages.map((page,index)=>{
      const caret=state?.caret?.pageIndex===index?state.caret:null;
      return <section key={index} className="editor-sheet" aria-label={`${index+1}쪽 편집`} style={{width:page.width*zoom,height:page.height*zoom}} onPointerDown={event=>{if(event.button!==0||busy||composing.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={page:index,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY};pick(event,index,event.shiftKey);}} onPointerMove={event=>{const d=drag.current;if(!d||d.page!==index||Math.abs(event.clientX-d.lastX)+Math.abs(event.clientY-d.lastY)<5)return;d.lastX=event.clientX;d.lastY=event.clientY;pick(event,index,true);}} onPointerUp={event=>{const d=drag.current;if(d&&Math.abs(event.clientX-d.startX)+Math.abs(event.clientY-d.startY)>3)pick(event,index,true);drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=null;}}>
        <EditorPage session={renderSession} index={index}/>
        {state?.object?.pageIndex===index&&<ObjectSelection object={state.object} zoom={zoom} busy={!!busy} onCommand={run}/>}
        {state?.selection.filter(rect=>rect.pageIndex===index).map((rect,i)=><span key={i} className="edit-selection" style={{left:rect.x*zoom,top:rect.y*zoom,width:(rect.width??0)*zoom,height:rect.height*zoom}}/>)}
        {caret&&<><span className={`edit-caret ${focused?'focused':''}`} style={{left:caret.x*zoom,top:caret.y*zoom,height:caret.height*zoom}}/>{composition&&<span className="edit-composition" style={{left:caret.x*zoom,top:caret.y*zoom,fontSize:state!.style.fontSize*96/72*zoom,fontFamily:font,color:state!.style.textColor}}>{composition}</span>}<textarea ref={input} className="edit-input" aria-label="문서 내용 입력" spellCheck={false} autoCapitalize="off" autoComplete="off" disabled={!!busy} style={{left:caret.x*zoom,top:caret.y*zoom,height:Math.max(20,caret.height*zoom)}} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onCompositionStart={()=>{composing.current=true;}} onCompositionUpdate={event=>setComposition(event.data)} onCompositionEnd={event=>{composing.current=false;setComposition('');consume(event.currentTarget);if(saveAfterComposition.current){saveAfterComposition.current=false;void persist();}}} onInput={event=>{if(!composing.current&&!(event.nativeEvent as InputEvent).isComposing)consume(event.currentTarget);}} onKeyDown={event=>{
          if(composing.current||event.nativeEvent.isComposing||event.keyCode===229)return;
          const modifier=event.ctrlKey||event.metaKey;
          if(event.ctrlKey&&event.shiftKey&&(['Comma','Period'].includes(event.code)||[',','.','<','>'].includes(event.key))){event.preventDefault();run({kind:'fontSizeStep',delta:event.code==='Comma'||event.key===','||event.key==='<'?-1:1});}
          else if(modifier&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();const key=({b:'bold',i:'italic',u:'underline'} as const)[event.key.toLowerCase() as 'b'|'i'|'u'];run({kind:'format',style:{[key]:!state?.style[key]}});}
          else if(modifier&&event.key.toLowerCase()==='a'){event.preventDefault();run({kind:'selectParagraph'});}
          else if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();run({kind:event.shiftKey?'redo':'undo'});}
          else if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();run({kind:'redo'});}
          else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Backspace','Delete','Enter'].includes(event.key)){event.preventDefault();run({kind:'key',key:event.key,extend:event.shiftKey,ctrl:event.ctrlKey});}
          else if(event.key==='Tab'){event.preventDefault();run({kind:'insert',text:'\t'});}
        }}/></>}
        <span className="editor-page-number">{index+1}</span>
      </section>;
    })}</div>
    {tablePrompt&&<div className="editor-prompt" role="dialog" aria-label="표 만들기"><form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);run({kind:'tableInsert',rows:Number(data.get('rows')),cols:Number(data.get('cols')),width:Number(data.get('width'))*96/25.4,height:Number(data.get('height'))*96/25.4});setTablePrompt(false);}}><h2>표 만들기</h2><p>행·열 수와 표 전체 크기를 지정해 주세요.</p>{[['rows','행 수',3,1,50],['cols','열 수',3,1,50],['width','표 가로 (mm)',150,5,700],['height','표 세로 (mm)',30,5,1200]].map(([name,label,value,min,max])=><label className="table-create-field" key={name}><span>{label}</span><input autoFocus={name==='rows'} name={String(name)} aria-label={String(label)} type="number" min={min} max={max} step={name==='rows'||name==='cols'?1:.1} defaultValue={value} required/></label>)}<div><Button type="submit">표 삽입</Button><Button type="button" variant="secondary" onClick={()=>setTablePrompt(false)}>취소</Button></div></form></div>}
    {password&&<div className="editor-prompt"><form onSubmit={event=>{event.preventDefault();const element=event.currentTarget.elements.namedItem('password') as HTMLInputElement;const value=element.value;element.value='';password.finish(value);}}><h2>편집 복사본의 암호를 입력해 주세요</h2><p>복사본도 같은 암호로 보호하여 다운로드합니다.</p>{password.retry&&<p role="alert">암호를 다시 확인해 주세요.</p>}<input name="password" aria-label="편집 문서 암호" type="password" autoComplete="off" autoFocus required/><div><Button type="submit">복사본 열기</Button><Button type="button" variant="secondary" onClick={()=>{password.finish(null);onClose();}}>취소</Button></div></form></div>}
    {restorePrompt&&<div className="editor-prompt" role="alertdialog" aria-label="이전 편집 복구"><div><h2>이전에 편집하던 내용을 불러올까요?</h2><p>{new Date(restorePrompt.draft.savedAt).toLocaleString()}에 자동저장한 최신 복사본이 있습니다. 원본은 그대로 유지됩니다.</p><Button autoFocus onClick={()=>restorePrompt.choose(true)}>이전 편집 불러오기</Button><Button variant="outline" onClick={()=>restorePrompt.choose(false)}>원본부터 새로 편집</Button><Button variant="secondary" onClick={onClose}>취소</Button></div></div>}
    {confirmClose&&<div className="editor-prompt" role="alertdialog" aria-label="뷰어로 돌아가기 확인"><div><h2>뷰어로 돌아가시겠습니까?</h2><p>최신 편집본 하나는 자동저장하여 다음에 이어서 편집할 수 있습니다. 이번 세션의 이력은 종료됩니다.</p><p role="status">{error||draftStatus}</p><Button disabled={!!busy||!session} onClick={()=>void download(true)}>복사본 저장하고 돌아가기</Button><Button variant="outline" disabled={!!busy} onClick={()=>void returnToViewer()}>자동저장하고 돌아가기</Button><Button variant="secondary" disabled={!!busy} onClick={()=>setConfirmClose(false)}>계속 편집</Button></div></div>}
  </dialog>,document.body);
}
