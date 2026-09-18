// 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
"use client";
import {memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {FileText,Grid2X2,FolderOpen,ShieldCheck,ChevronLeft,ChevronRight,Minus,Plus,Scan,Maximize,Trash2,LoaderCircle,X,Bookmark,Columns2} from 'lucide-react';
import {parseDocument,renderPage,type DocumentSession} from '@/lib/hwp-engine';
import {readSavedFile,saveFile,clearFile,readView,VIEW_KEY,type SavedView} from '@/lib/local-document';
import {gridLayout,pageAtScroll} from '@/lib/grid-layout';
import {RuntimeStats} from '@/components/runtime-stats';
import {bookmarkKey,readBookmarks,writeBookmarks,BOOKMARK_EVENT} from '@/lib/bookmarks';
import {queuePageRender} from '@/lib/page-render-queue';

const PageContent=memo(function PageContent({session,index,visible,priority}:{session:DocumentSession;index:number;visible:boolean;priority:boolean}){
  const [svg,setSvg]=useState('');const [error,setError]=useState('');
  useEffect(()=>{
    if(!visible){setSvg('');return;}let active=true;
    const cancel=queuePageRender(async()=>{try{const value=await renderPage(session,index);if(active){setSvg(value);setError('');}}catch{if(active)setError('이 페이지를 표시할 수 없습니다. 원본 문서를 한글에서 확인해 주세요.');}},priority);
    return()=>{active=false;cancel();};
  },[session,index,visible,priority]);
  if(error)return <div className="sheet-status" role="alert">{error}</div>;
  if(!svg)return <div className="sheet-status">{visible?'페이지 표시 중…':''}</div>;
  return <div className="page-svg" aria-hidden="true" dangerouslySetInnerHTML={{__html:svg}}/>;
});
export default function Home(){
  const [compare,setCompare]=useState(()=>{try{return localStorage.getItem('hwp-grid-compare')==='true';}catch{return false;}});
  const toggleCompare=()=>setCompare(value=>{try{localStorage.setItem('hwp-grid-compare',String(!value));}catch{}return !value;});
  return <main className={`workspace ${compare?'comparing':''}`}>
    <DocumentPane slot="current" compare={compare} onCompare={toggleCompare}/>
    {compare&&<DocumentPane slot="comparison" compare onCompare={toggleCompare}/>}
  </main>;
}
function DocumentPane({slot,compare,onCompare}:{slot:'current'|'comparison';compare:boolean;onCompare:()=>void}){
  const viewKey=slot==='current'?VIEW_KEY:`${VIEW_KEY}-${slot}`;
  const [bookmarks,setBookmarks]=useState<number[]>([]);
  const [bookmarkStorageKey,setBookmarkStorageKey]=useState('');
  const bookmarkSet=useMemo(()=>new Set(bookmarks),[bookmarks]);
  useEffect(()=>{const refresh=()=>{if(bookmarkStorageKey)setBookmarks(readBookmarks(bookmarkStorageKey));};window.addEventListener(BOOKMARK_EVENT,refresh);window.addEventListener('storage',refresh);return()=>{window.removeEventListener(BOOKMARK_EVENT,refresh);window.removeEventListener('storage',refresh);};},[bookmarkStorageKey]);
  const toggleBookmark=(index:number)=>{if(!session)return;const next=readBookmarks(bookmarkStorageKey);const updated=next.includes(index)?next.filter(n=>n!==index):[...next,index].sort((a,b)=>a-b);setBookmarks(updated);try{writeBookmarks(bookmarkStorageKey,updated);}catch{setNotice('책갈피를 저장하지 못했습니다. 브라우저의 사이트 저장 설정을 확인해 주세요.');}};
  const [session,setSession]=useState<DocumentSession|null>(null);
  const [cols,setCols]=useState(2),[zoom,setZoom]=useState(1),[selected,setSelected]=useState(0);
  const [viewport,setViewport]=useState({width:1000,height:700,left:0,top:0});
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[saved,setSaved]=useState(false),[drop,setDrop]=useState(false),[dragging,setDragging]=useState(false);
  const [passwordRequest,setPasswordRequest]=useState<{name:string;retry:boolean;finish:(value:string|null)=>void}|null>(null);
  const passwordInput=useRef<HTMLInputElement>(null);
  const [pageInput,setPageInput]=useState('1');
  const [documentMs,setDocumentMs]=useState<number|null>(null);
  const fileInput=useRef<HTMLInputElement>(null),stage=useRef<HTMLDivElement>(null);
  const opening=useRef<AbortController|null>(null);
  const current=useRef<DocumentSession|null>(null),loadId=useRef(0),mounted=useRef(true),dragDepth=useRef(0);
  const restoring=useRef<SavedView|null>(null),anchor=useRef<{x:number;y:number;cx:number;cy:number;oldScale:number}|null>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;moved:boolean}|null>(null);
  const touchMoved=useRef(false);
  const layout=useMemo(()=>gridLayout(session?.pages||[],cols,viewport.width,zoom),[session,cols,viewport.width,zoom]);
  const layoutRef=useRef(layout);layoutRef.current=layout;
  const currentPage=pageAtScroll(layout.items,cols,viewport.top);
  const viewState=useRef({cols,zoom,scale:layout.scale});viewState.current={cols,zoom,scale:layout.scale};
  const saveView=useCallback(()=>{const s=current.current,el=stage.current,v=viewState.current;if(!s||!el||restoring.current)return;
    try{localStorage.setItem(viewKey,JSON.stringify({key:s.key,cols:v.cols,zoom:v.zoom,left:el.scrollLeft/v.scale,top:el.scrollTop/v.scale}));}catch{setNotice('보기 위치를 저장하지 못했습니다. 브라우저의 사이트 저장 설정을 확인해 주세요.');}
  },[viewKey]);
  const open=useCallback(async(file:File,restoreKey?:string)=>{
    saveView();opening.current?.abort();const controller=new AbortController();opening.current=controller;const started=performance.now();const id=++loadId.current;setDocumentMs(null);setBusy(restoreKey?'마지막 문서를 복원하는 중…':'문서를 여는 중…');setNotice('');
    try{
      const key=restoreKey||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join("-");
      let passwordWaitMs=0;
      const next=await parseDocument(file,key,controller.signal,async retry=>{
        const waiting=performance.now();
        const value=await new Promise<string|null>(resolve=>{
          const finish=(value:string|null)=>{
            controller.signal.removeEventListener('abort',cancel);
            if(passwordInput.current)passwordInput.current.value='';
            setPasswordRequest(null);resolve(value);
          };
          const cancel=()=>finish(null);
          if(controller.signal.aborted){resolve(null);return;}
          controller.signal.addEventListener('abort',cancel,{once:true});
          setPasswordRequest({name:file.name,retry,finish});
        });
        passwordWaitMs+=performance.now()-waiting;
        return value;
      });
      if(id!==loadId.current||!mounted.current){next.doc.free();return;}
      setDocumentMs(performance.now()-started-passwordWaitMs);
      const previous=current.current;current.current=next;
      const view=restoreKey?readView(key,viewKey):null;
      restoring.current=view||{key,cols:2,zoom:1,left:0,top:0};
      setCols(view?.cols||2);setZoom(view?.zoom||1);setSession(next);setSelected(0);const bk=bookmarkKey(file);setBookmarkStorageKey(bk);setBookmarks(readBookmarks(bk));setSaved(!!restoreKey);
      // Old page effects are disposed by the keyed session before this deferred release.
      if(previous)setTimeout(()=>previous.doc.free(),0);
      if(!restoreKey){try{await saveFile({file,key},slot);if(id===loadId.current)setSaved(true);}catch{if(id===loadId.current)setNotice('문서는 열었으나 브라우저에 저장하지 못했습니다. 새로고침하면 복원되지 않을 수 있습니다.');}}
    }catch(error){if(id===loadId.current&&!(error instanceof DOMException&&error.name==='AbortError')){const raw=String(error instanceof Error?error.message:error);if(import.meta.env.DEV)console.warn('HWP Grid:',raw);setNotice(/password|encrypt|암호|비밀번호/i.test(raw)?'이 문서의 암호화 방식은 지원하지 않거나 파일이 손상되었을 수 있습니다. 원본 문서를 한글에서 확인해 주세요.':/선택해|1 GB|빈 파일|페이지 수|크기를|브라우저에서/.test(raw)?raw:'문서를 열지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다. 원본 문서를 한글에서 확인해 주세요.');}}
    finally{if(id===loadId.current&&mounted.current)setBusy('');}
  },[saveView,slot,viewKey]);
  useEffect(()=>{mounted.current=true;const id=loadId.current;
    readSavedFile(slot).then(value=>{if(mounted.current&&id===loadId.current&&value)void open(value.file,value.key);}).catch(()=>setNotice('브라우저 저장소에 접근하지 못했습니다. 파일을 직접 선택하여 열 수 있습니다.'));
    const hide=()=>saveView(),visibility=()=>{if(document.visibilityState==='hidden')saveView();};
    window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visibility);
    return()=>{saveView();mounted.current=false;++loadId.current;opening.current?.abort();current.current?.doc.free();current.current=null;window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visibility);};
  },[open,saveView,slot]);
  useEffect(()=>{const el=stage.current;if(!el)return;const observe=()=>{
      const doc=current.current,old=layoutRef.current,v=viewState.current;
      if(doc&&!restoring.current&&old.items.length){
        const index=pageAtScroll(old.items,v.cols,el.scrollTop)-1;
        const next=gridLayout(doc.pages,v.cols,el.clientWidth,v.zoom);
        if(next.scale!==old.scale)restoring.current={key:doc.key,cols:v.cols,zoom:v.zoom,left:el.scrollLeft/old.scale,top:Math.max(0,next.items[index].top+(el.scrollTop-old.items[index].top)*next.scale/old.scale)/next.scale};
      }
      setViewport(v=>({...v,width:el.clientWidth,height:el.clientHeight,left:el.scrollLeft,top:el.scrollTop}));
    };const ro=new ResizeObserver(observe);ro.observe(el);observe();return()=>ro.disconnect();},[]);
  useLayoutEffect(()=>{const el=stage.current;if(!el||!session)return;
    if(restoring.current){const v=restoring.current;el.scrollLeft=v.left*layout.scale;el.scrollTop=v.top*layout.scale;restoring.current=null;}
    else if(anchor.current){const a=anchor.current;el.scrollLeft=a.x*layout.scale/a.oldScale-a.cx;el.scrollTop=a.y*layout.scale/a.oldScale-a.cy;anchor.current=null;}
    setViewport(v=>({...v,left:el.scrollLeft,top:el.scrollTop}));
  },[session,layout]);
  useEffect(()=>{setPageInput(String(currentPage));},[currentPage]);
  useEffect(()=>{if(!session)return;const timer=setTimeout(saveView,180);return()=>clearTimeout(timer);},[session,cols,zoom,viewport.left,viewport.top,saveView]);
  const changeZoom=useCallback((factor:number,cx?:number,cy?:number)=>{const el=stage.current;if(!el||!current.current)return;const v=viewState.current;const x=cx??el.clientWidth/2,y=cy??el.clientHeight/2;anchor.current={x:el.scrollLeft+x,y:el.scrollTop+y,cx:x,cy:y,oldScale:v.scale};setZoom(z=>Math.max(.2,Math.min(8,z*factor)));},[]);
  useEffect(()=>{const el=stage.current;if(!el)return;const wheel=(e:WheelEvent)=>{if(!current.current||!(e.ctrlKey||e.metaKey))return;e.preventDefault();const r=el.getBoundingClientRect();changeZoom(Math.exp(-Math.max(-150,Math.min(150,e.deltaY*(e.deltaMode===1?16:1)))*.002),e.clientX-r.left,e.clientY-r.top);};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[changeZoom]);
  // Own touch gestures only inside an opened document; toolbar/browser zoom stays native.
  useEffect(()=>{
    const el=stage.current;if(!el||!session)return;
    const points=new Map<number,{x:number;y:number}>();
    let gesture:{distance:number;zoom:number;x:number;y:number}|null=null;
    const pair=()=>Array.from(points.values()).slice(0,2);
    const begin=()=>{
      if(points.size<2){gesture=null;return;}
      const [a,b]=pair(),v=viewState.current,r=el.getBoundingClientRect();
      const g=gridLayout(session.pages,v.cols,el.clientWidth,v.zoom);
      gesture={distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),zoom:v.zoom,
        x:(el.scrollLeft+(a.x+b.x)/2-r.left-g.items[0].left)/g.scale,
        y:(el.scrollTop+(a.y+b.y)/2-r.top-28)/g.scale};
      touchMoved.current=true;
    };
    const down=(e:PointerEvent)=>{
      if(e.pointerType!=='touch'||(e.target instanceof Element&&e.target.closest('button')))return;
      if(!points.size)touchMoved.current=false;
      points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      el.setPointerCapture(e.pointerId);begin();
    };
    const move=(e:PointerEvent)=>{
      const previous=points.get(e.pointerId);if(!previous)return;
      points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(points.size===1){
        const dx=e.clientX-previous.x,dy=e.clientY-previous.y;
        if(dx||dy)touchMoved.current=true;
        el.scrollLeft-=dx;el.scrollTop-=dy;return;
      }
      if(!gesture)return;
      const [a,b]=pair(),r=el.getBoundingClientRect();
      const next=Math.max(.2,Math.min(8,gesture.zoom*Math.hypot(b.x-a.x,b.y-a.y)/gesture.distance));
      const g=gridLayout(session.pages,viewState.current.cols,el.clientWidth,next);
      const cx=(a.x+b.x)/2-r.left,cy=(a.y+b.y)/2-r.top;
      if(next===viewState.current.zoom){
        el.scrollLeft=gesture.x*g.scale+g.items[0].left-cx;
        el.scrollTop=gesture.y*g.scale+28-cy;
      }else{
        anchor.current={x:gesture.x,y:gesture.y,cx:cx-g.items[0].left,cy:cy-28,oldScale:1};
        setZoom(next);
      }
    };
    const end=(e:PointerEvent)=>{
      if(!points.delete(e.pointerId))return;
      if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
      begin();
    };
    const reset=()=>{points.clear();gesture=null;};
    el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
    el.addEventListener('lostpointercapture',end);window.addEventListener('blur',reset);
    return()=>{
      el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);
      el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);
      el.removeEventListener('lostpointercapture',end);window.removeEventListener('blur',reset);
    };
  },[session]);
  const go=(page:number)=>{const el=stage.current;if(!el||!session)return;const index=Math.max(0,Math.min(session.pages.length-1,Math.round(page)-1));el.scrollTop=layout.items[index].top-28;el.scrollLeft=Math.max(0,layout.items[index].left-28);setSelected(index);setPageInput(String(index+1));};
  const restoreRow=(n:number)=>{
    const s=current.current,el=stage.current;if(!s||!el)return;
    const next=gridLayout(s.pages,n,el.clientWidth,1);
    restoring.current={key:s.key,cols:n,zoom:1,left:0,top:Math.max(0,next.items[currentPage-1].top-28)/next.scale};
  };
  const fit=()=>{anchor.current=null;if(zoom===1){restoring.current=null;if(stage.current)stage.current.scrollLeft=0;return;}restoreRow(cols);setZoom(1);};
  const chooseCols=(n:number)=>{if(n===cols)return;anchor.current=null;restoreRow(n);setCols(n);setZoom(1);};
  const clear=async()=>{saveView();++loadId.current;opening.current?.abort();setBusy('저장된 문서 삭제 중…');try{await clearFile(slot);try{localStorage.removeItem(viewKey);if(bookmarkStorageKey)writeBookmarks(bookmarkStorageKey,[]);}catch{}const previous=current.current;current.current=null;setDocumentMs(null);setSession(null);setBookmarks([]);setBookmarkStorageKey('');setSaved(false);setZoom(1);setCols(2);setNotice('');if(previous)setTimeout(()=>previous.doc.free(),0);}catch{setNotice('저장된 문서를 삭제하지 못했습니다. 브라우저의 사이트 설정에서 삭제해 주세요.');}finally{setBusy('');}};
  const endDrag=()=>{const d=drag.current;if(d&&stage.current?.hasPointerCapture(d.id))stage.current.releasePointerCapture(d.id);setDragging(false);setTimeout(()=>{drag.current=null;},0);};
  return <section aria-label={slot==='current'?'첫 번째 문서':'두 번째 문서'} className="app document-pane" onDragEnter={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){dragDepth.current++;setDrop(true);}}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDrop(false);}}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDrop(false);if(e.dataTransfer.files[0])void open(e.dataTransfer.files[0]);}}>
    <header className="topbar"><div className="brand"><div className="brand-icon"><Grid2X2 size={22}/></div>{slot==='current'?<>HWP <span>Grid</span></>:<>비교 문서</>}</div><div className="filename" title={session?.name}>{session?.name||'한글 문서를 한눈에, 자유롭게.'}</div><Button onClick={()=>fileInput.current?.click()}><FolderOpen/>문서 열기</Button><Button variant="secondary" aria-label={slot==='comparison'?'비교 닫기':compare?'비교 종료':'문서 비교'} onClick={onCompare}>{slot==='comparison'?<X/>:<Columns2/>}<span>{slot==='comparison'?'닫기':compare?'비교 종료':'문서 비교'}</span></Button><input ref={fileInput} type="file" accept=".hwp,.hwpx" aria-label="한글 문서 파일" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void open(file);}}/></header>
    <nav className="toolbar" aria-label="문서 보기 설정">
      <div className="control-group"><label htmlFor={`cols-${slot}`}>격자</label><NativeSelect id={`cols-${slot}`} value={cols} onChange={e=>chooseCols(Number(e.target.value))} aria-label="격자 열 수">{[1,2,3,4,5,6,8].map(n=><NativeSelectOption key={n} value={n}>{n}열</NativeSelectOption>)}</NativeSelect><span className="text-muted-foreground">× {session?Math.ceil(session.pages.length/cols):'—'}행</span></div><span className="divider"/>
      <div className="control-group"><Button variant="ghost" size="icon" disabled={!session||currentPage<=1} onClick={()=>go(currentPage-cols)} aria-label="이전 행"><ChevronLeft/></Button><Input className="page-input" aria-label="이동할 페이지" type="number" min={1} max={session?.pages.length||1} disabled={!session} value={pageInput} title="페이지 번호 입력 후 Enter로 이동" onChange={e=>setPageInput(e.target.value)} onBlur={()=>setPageInput(String(currentPage))} onWheel={e=>e.currentTarget.blur()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();go(Number(pageInput)||1);}else if(e.key==='Escape'){setPageInput(String(currentPage));e.currentTarget.blur();}}}/><span className="text-muted-foreground">/ {session?.pages.length||'—'}</span><Button variant="ghost" size="icon" disabled={!session||currentPage+cols>session.pages.length} onClick={()=>go(currentPage+cols)} aria-label="다음 행"><ChevronRight/></Button></div>
      <div className="toolbar-spacer"/><div className="control-group"><Button variant="ghost" size="icon" disabled={!session||zoom<=.2} aria-label="축소" onClick={()=>changeZoom(1/1.25)}><Minus/></Button><output className="zoom-label" aria-label="확대 배율">{Math.round(zoom*100)}%</output><Button variant="ghost" size="icon" disabled={!session||zoom>=8} aria-label="확대" onClick={()=>changeZoom(1.25)}><Plus/></Button><Button variant="secondary" disabled={!session} onClick={fit} title="화면 맞춤 (0)"><Scan/><span className="fit-label">화면 맞춤</span></Button><Button variant="ghost" size="icon" aria-label="전체 화면" onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setNotice('이 브라우저에서는 전체 화면을 사용할 수 없습니다.');}}}><Maximize/></Button></div>
      <span className="divider"/><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={!session||!!busy} aria-label="저장된 문서 삭제" title="저장된 문서 삭제"><Trash2/></Button></AlertDialogTrigger><AlertDialogContent className="delete-dialog"><AlertDialogHeader><AlertDialogTitle>저장된 문서를 삭제하시겠습니까?</AlertDialogTitle><AlertDialogDescription>이 브라우저에 저장된 문서와 보기 위치, 책갈피를 삭제합니다. 컴퓨터에 있는 원본 파일은 삭제되지 않습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={()=>void clear()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </nav>
    <div className="pane-body">
      {session&&<aside className="bookmark-rail" aria-label="책갈피 목록"><div className="bookmark-heading"><Bookmark size={18}/><span>책갈피</span><small>{bookmarks.length}</small></div><div className="bookmark-list">{bookmarks.filter(i=>i<session.pages.length).map(i=><button key={i} type="button" className={selected===i?'active':''} aria-label={`${i+1}쪽 책갈피로 이동`} aria-current={selected===i?'page':undefined} onClick={()=>go(i+1)}><Bookmark size={14} fill="currentColor"/><span>{i+1}쪽</span></button>)}</div>{!bookmarks.length&&<p>페이지의 책갈피 버튼을 눌러 추가해 주세요.</p>}</aside>}
    <div ref={stage} tabIndex={0} role="region" aria-label="문서 페이지 격자" className={`stage ${session?'ready':''} ${dragging?'dragging':''}`} onScroll={e=>{const el=e.currentTarget;setPageInput(String(pageAtScroll(layout.items,cols,el.scrollTop)));setViewport(v=>({...v,left:el.scrollLeft,top:el.scrollTop}));}} onKeyDown={e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='ArrowRight'){e.preventDefault();go(currentPage+cols);}else if(e.key==='ArrowLeft'){e.preventDefault();go(currentPage-cols);}else if(e.key==='0')fit();else if(e.key==='+'||e.key==='=')changeZoom(1.25);else if(e.key==='-')changeZoom(1/1.25);}} onPointerDown={e=>{if(!session||e.button!==0||e.pointerType==='touch'||(e.target instanceof Element&&e.target.closest('button')))return;const el=e.currentTarget;if(e.nativeEvent.offsetX>=el.clientWidth&&e.target===el)return;e.preventDefault();touchMoved.current=false;el.focus({preventScroll:true});drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop,moved:false};}} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>4){d.moved=true;setDragging(true);e.currentTarget.setPointerCapture(d.id);e.currentTarget.scrollLeft=d.left-dx;e.currentTarget.scrollTop=d.top-dy;}}} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {busy&&<div className="loading-bar" role="status"><LoaderCircle className="spin" size={17}/>{busy}</div>}
      {session?<div className="world" style={{width:layout.width,height:layout.height}}>{layout.items.map((p,i)=>{const visible=p.top<viewport.top+viewport.height+450&&p.top+p.height>viewport.top-450&&p.left<viewport.left+viewport.width+250&&p.left+p.width>viewport.left-250;return <section key={`${session.key}-${i}`} className={`sheet ${selected===i?'selected':''}`} style={p} aria-label={`${i+1}쪽`} onClick={()=>{if(!drag.current?.moved&&!touchMoved.current)setSelected(i);}} onDoubleClick={()=>{if(touchMoved.current)return;const el=stage.current;if(!el)return;const z=Math.max(.2,Math.min(8,zoom*Math.min((el.clientWidth-56)/p.width,(el.clientHeight-56)/p.height)));const next=gridLayout(session.pages,cols,el.clientWidth,z);restoring.current={key:session.key,cols,zoom:z,left:Math.max(0,next.items[i].left-28)/next.scale,top:Math.max(0,next.items[i].top-28)/next.scale};setZoom(z);}}><PageContent session={session} index={i} visible={visible} priority={p.top<viewport.top+viewport.height&&p.top+p.height>viewport.top&&p.left<viewport.left+viewport.width&&p.left+p.width>viewport.left}/><button type="button" className={`page-bookmark ${bookmarkSet.has(i)?'marked':''}`} aria-label={`${i+1}쪽 책갈피 ${bookmarkSet.has(i)?'해제':'추가'}`} aria-pressed={bookmarkSet.has(i)} onClick={e=>{e.stopPropagation();toggleBookmark(i);}} onDoubleClick={e=>e.stopPropagation()}><Bookmark size={18} fill={bookmarkSet.has(i)?'currentColor':'none'}/></button><span className="sheet-num">{i+1}</span></section>;})}</div>:<div className="welcome"><div className="welcome-inner"><div className="file-icon"><FileText size={42}/></div><h1>한글 문서를 한눈에</h1><p>HWP·HWPX 파일을 이곳에 끌어다 놓으면<br/>여러 페이지를 한눈에 볼 수 있습니다.</p><div className="format-tags"><span>HWP</span><span>HWPX</span></div><Button size="lg" onClick={()=>fileInput.current?.click()}><FolderOpen/>파일 선택</Button><div className="privacy-note"><ShieldCheck size={15}/>문서는 이 브라우저 안에서만 처리됩니다.</div><div className="shortcuts"><span><kbd>휠</kbd>스크롤</span><span><kbd>드래그</kbd>이동</span><span><kbd>Ctrl/⌘ + 휠</kbd>확대</span></div><div className="compat-note">글꼴이나 복잡한 표·수식은 한글 프로그램과 다르게 표시될 수 있습니다.<br/>최대 1 GB · HWP·HWPX · 암호 입력 지원</div></div></div>}
    </div>
    </div>
    <footer className="statusbar" aria-label="문서 상태 및 성능 정보"><RuntimeStats documentMs={documentMs}/><span className="legal-line">본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다. <a href={`${import.meta.env.BASE_URL}licenses.html`} target="_blank" rel="noreferrer">라이선스·고지</a></span><div className="statusbar-right"><span className="status" role="status">{session?`${session.pages.length}쪽 · ${saved?'이 브라우저에 저장됨':'문서 열림'}`:'마지막 문서·보기 위치는 이 브라우저에 저장됨'}</span><span className="footer-detail">{session?'표·수식·글꼴 배치는 원본과 다를 수 있음':'문서는 서버로 전송되지 않음'}</span><a href="https://github.com/edwardkim/rhwp" target="_blank" rel="noreferrer">rhwp</a></div></footer>
    {notice&&<div className="notice" role="alert"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="알림 닫기" onClick={()=>setNotice('')}><X/></Button></div>}{drop&&<div className="drop-overlay">HWP·HWPX 파일을 놓아서 열기</div>}
    <AlertDialog open={!!passwordRequest} onOpenChange={value=>{if(!value)passwordRequest?.finish(null);}}>
      <AlertDialogContent onOpenAutoFocus={e=>{e.preventDefault();passwordInput.current?.focus();}}>
        <AlertDialogHeader><AlertDialogTitle>문서 암호를 입력해 주세요</AlertDialogTitle><AlertDialogDescription>{passwordRequest?.name}<br/>암호는 이 문서를 여는 데만 사용하며 저장하거나 서버로 전송하지 않습니다.</AlertDialogDescription></AlertDialogHeader>
        <form onSubmit={e=>{e.preventDefault();const value=passwordInput.current?.value;if(value)passwordRequest?.finish(value);}}>
          <label htmlFor={`document-password-${slot}`}>문서 암호</label>
          <Input ref={passwordInput} id={`document-password-${slot}`} type="password" autoComplete="off" required aria-describedby={passwordRequest?.retry?`password-error-${slot}`:undefined}/>
          {passwordRequest?.retry&&<p id={`password-error-${slot}`} role="alert">암호가 일치하지 않거나 파일이 손상되었습니다. 암호를 확인한 후 다시 입력해 주세요.</p>}
          <AlertDialogFooter className="mt-4"><Button type="button" variant="outline" onClick={()=>passwordRequest?.finish(null)}>취소</Button><Button type="submit">문서 열기</Button></AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
