// 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
"use client";
import {memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {FileText,Grid2X2,FolderOpen,ShieldCheck,ChevronLeft,ChevronRight,Minus,Plus,Scan,Maximize,Trash2,LoaderCircle,X} from 'lucide-react';
import {parseDocument,renderPage,type DocumentSession} from '@/lib/hwp-engine';
import {readSavedFile,saveFile,clearFile,readView,VIEW_KEY,type SavedView} from '@/lib/local-document';
import {gridLayout,pageAtScroll} from '@/lib/grid-layout';
import {RuntimeStats} from '@/components/runtime-stats';
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
  const [session,setSession]=useState<DocumentSession|null>(null);
  const [cols,setCols]=useState(2),[zoom,setZoom]=useState(1),[selected,setSelected]=useState(0);
  const [viewport,setViewport]=useState({width:1000,height:700,left:0,top:0});
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[saved,setSaved]=useState(false),[drop,setDrop]=useState(false),[dragging,setDragging]=useState(false);
  const [pageInput,setPageInput]=useState('1');
  const pageInputDirty=useRef(false);
  const [documentMs,setDocumentMs]=useState<number|null>(null);
  const fileInput=useRef<HTMLInputElement>(null),stage=useRef<HTMLDivElement>(null);
  const opening=useRef<AbortController|null>(null);
  const current=useRef<DocumentSession|null>(null),loadId=useRef(0),mounted=useRef(true),dragDepth=useRef(0);
  const restoring=useRef<SavedView|null>(null),anchor=useRef<{x:number;y:number;cx:number;cy:number;oldScale:number}|null>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;moved:boolean}|null>(null);
  const touchMoved=useRef(false);
  const layout=useMemo(()=>gridLayout(session?.pages||[],cols,viewport.width,zoom),[session,cols,viewport.width,zoom]);
  const currentPage=pageAtScroll(layout.items,cols,viewport.top);
  const viewState=useRef({cols,zoom,scale:layout.scale});viewState.current={cols,zoom,scale:layout.scale};
  const saveView=useCallback(()=>{const s=current.current,el=stage.current,v=viewState.current;if(!s||!el||restoring.current)return;
    try{localStorage.setItem(VIEW_KEY,JSON.stringify({key:s.key,cols:v.cols,zoom:v.zoom,left:el.scrollLeft/v.scale,top:el.scrollTop/v.scale}));}catch{setNotice('보기 위치를 저장하지 못했습니다. 브라우저의 사이트 저장 설정을 확인해 주세요.');}
  },[]);
  const open=useCallback(async(file:File,restoreKey?:string)=>{
    saveView();opening.current?.abort();const controller=new AbortController();opening.current=controller;const started=performance.now();const id=++loadId.current;setDocumentMs(null);setBusy(restoreKey?'마지막 문서를 복원하는 중…':'문서를 여는 중…');setNotice('');
    try{
      const key=restoreKey||Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join("-");
      const next=await parseDocument(file,key,controller.signal);
      if(id!==loadId.current||!mounted.current){next.doc.free();return;}
      setDocumentMs(performance.now()-started);
      const previous=current.current;current.current=next;
      const view=restoreKey?readView(key):null;
      restoring.current=view||{key,cols:2,zoom:1,left:0,top:0};
      setCols(view?.cols||2);setZoom(view?.zoom||1);setSession(next);setSelected(0);setSaved(!!restoreKey);
      // Old page effects are disposed by the keyed session before this deferred release.
      if(previous)setTimeout(()=>previous.doc.free(),0);
      if(!restoreKey){try{await saveFile({file,key});if(id===loadId.current)setSaved(true);}catch{if(id===loadId.current)setNotice('문서는 열었으나 브라우저에 저장하지 못했습니다. 새로고침하면 복원되지 않을 수 있습니다.');}}
    }catch(error){if(id===loadId.current){const raw=String(error instanceof Error?error.message:error);if(import.meta.env.DEV)console.warn('HWP Grid:',raw);setNotice(/password|encrypt|암호|비밀번호/i.test(raw)?'암호가 설정된 문서는 현재 지원하지 않습니다. 한글에서 암호를 해제한 사본을 열어 주세요.':/선택해|1 GB|빈 파일|페이지 수|크기를|브라우저에서/.test(raw)?raw:'문서를 열지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다. 원본 문서를 한글에서 확인해 주세요.');}}
    finally{if(id===loadId.current&&mounted.current)setBusy('');}
  },[saveView]);
  useEffect(()=>{mounted.current=true;const id=loadId.current;
    readSavedFile().then(value=>{if(mounted.current&&id===loadId.current&&value)void open(value.file,value.key);}).catch(()=>setNotice('브라우저 저장소에 접근하지 못했습니다. 파일을 직접 선택하여 열 수 있습니다.'));
    const hide=()=>saveView(),visibility=()=>{if(document.visibilityState==='hidden')saveView();};
    window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visibility);
    return()=>{mounted.current=false;++loadId.current;opening.current?.abort();window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visibility);};
  },[open,saveView]);
  useEffect(()=>{const el=stage.current;if(!el)return;const observe=()=>setViewport(v=>({...v,width:el.clientWidth,height:el.clientHeight,left:el.scrollLeft,top:el.scrollTop}));const ro=new ResizeObserver(observe);ro.observe(el);observe();return()=>ro.disconnect();},[]);
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
      if(e.pointerType!=='touch')return;
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
  const go=(page:number)=>{pageInputDirty.current=false;const el=stage.current;if(!el||!session)return;const index=Math.max(0,Math.min(session.pages.length-1,Math.round(page)-1));el.scrollTop=layout.items[index].top-28;el.scrollLeft=0;setSelected(index);setPageInput(String(index+1));};
  const restoreRow=(n:number)=>{
    const s=current.current,el=stage.current;if(!s||!el)return;
    const next=gridLayout(s.pages,n,el.clientWidth,1);
    restoring.current={key:s.key,cols:n,zoom:1,left:0,top:Math.max(0,next.items[currentPage-1].top-28)/next.scale};
  };
  const fit=()=>{anchor.current=null;if(zoom===1){restoring.current=null;if(stage.current)stage.current.scrollLeft=0;return;}restoreRow(cols);setZoom(1);};
  const chooseCols=(n:number)=>{if(n===cols)return;anchor.current=null;restoreRow(n);setCols(n);setZoom(1);};
  const clear=async()=>{saveView();++loadId.current;opening.current?.abort();setBusy('저장된 문서 삭제 중…');try{await clearFile();try{localStorage.removeItem(VIEW_KEY);}catch{}const previous=current.current;current.current=null;setDocumentMs(null);setSession(null);setSaved(false);setZoom(1);setCols(2);setNotice('');if(previous)setTimeout(()=>previous.doc.free(),0);}catch{setNotice('저장된 문서를 삭제하지 못했습니다. 브라우저의 사이트 설정에서 삭제해 주세요.');}finally{setBusy('');}};
  const endDrag=()=>{const d=drag.current;if(d&&stage.current?.hasPointerCapture(d.id))stage.current.releasePointerCapture(d.id);setDragging(false);setTimeout(()=>{drag.current=null;},0);};
  return <main className="app" onDragEnter={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){dragDepth.current++;setDrop(true);}}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDrop(false);}}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDrop(false);if(e.dataTransfer.files[0])void open(e.dataTransfer.files[0]);}}>
    <header className="topbar"><div className="brand"><div className="brand-icon"><Grid2X2 size={22}/></div>HWP <span>Grid</span></div><div className="filename" title={session?.name}>{session?.name||'한글 문서를 한눈에, 자유롭게.'}</div><Button onClick={()=>fileInput.current?.click()}><FolderOpen/>문서 열기</Button><input ref={fileInput} type="file" accept=".hwp,.hwpx" aria-label="한글 문서 파일" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void open(file);}}/></header>
    <nav className="toolbar" aria-label="문서 보기 설정">
      <div className="control-group"><label htmlFor="cols">격자</label><NativeSelect id="cols" value={cols} onChange={e=>chooseCols(Number(e.target.value))} aria-label="격자 열 수">{[1,2,3,4,5,6,8].map(n=><NativeSelectOption key={n} value={n}>{n}열</NativeSelectOption>)}</NativeSelect><span className="text-muted-foreground">× {session?Math.ceil(session.pages.length/cols):'—'}행</span></div><span className="divider"/>
      <div className="control-group"><Button variant="ghost" size="icon" disabled={!session||currentPage<=1} onClick={()=>go(currentPage-cols)} aria-label="이전 행"><ChevronLeft/></Button><Input className="page-input" aria-label="이동할 페이지" type="number" min={1} max={session?.pages.length||1} disabled={!session} value={pageInput} onChange={e=>{pageInputDirty.current=true;setPageInput(e.target.value);}} onBlur={()=>{if(pageInputDirty.current)go(Number(pageInput)||1);}} onKeyDown={e=>{if(e.key==='Enter')go(Number(pageInput)||1);}}/><span className="text-muted-foreground">/ {session?.pages.length||'—'}</span><Button variant="ghost" size="icon" disabled={!session||currentPage+cols>session.pages.length} onClick={()=>go(currentPage+cols)} aria-label="다음 행"><ChevronRight/></Button></div>
      <div className="toolbar-spacer"/><div className="control-group"><Button variant="ghost" size="icon" disabled={!session||zoom<=.2} aria-label="축소" onClick={()=>changeZoom(1/1.25)}><Minus/></Button><output className="zoom-label" aria-label="확대 배율">{Math.round(zoom*100)}%</output><Button variant="ghost" size="icon" disabled={!session||zoom>=8} aria-label="확대" onClick={()=>changeZoom(1.25)}><Plus/></Button><Button variant="secondary" disabled={!session} onClick={fit} title="화면 맞춤 (0)"><Scan/><span className="fit-label">화면 맞춤</span></Button><Button variant="ghost" size="icon" aria-label="전체 화면" onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setNotice('이 브라우저에서는 전체 화면을 사용할 수 없습니다.');}}}><Maximize/></Button></div>
      <span className="divider"/><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={!session||!!busy} aria-label="저장된 문서 삭제" title="저장된 문서 삭제"><Trash2/></Button></AlertDialogTrigger><AlertDialogContent className="delete-dialog"><AlertDialogHeader><AlertDialogTitle>저장된 문서를 삭제하시겠습니까?</AlertDialogTitle><AlertDialogDescription>이 브라우저에 저장된 문서와 보기 위치를 삭제합니다. 컴퓨터에 있는 원본 파일은 삭제되지 않습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={()=>void clear()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </nav>
    <div ref={stage} tabIndex={0} role="region" aria-label="문서 페이지 격자" className={`stage ${session?'ready':''} ${dragging?'dragging':''}`} onScroll={e=>{const el=e.currentTarget;setViewport(v=>({...v,left:el.scrollLeft,top:el.scrollTop}));}} onKeyDown={e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='ArrowRight'){e.preventDefault();go(currentPage+cols);}else if(e.key==='ArrowLeft'){e.preventDefault();go(currentPage-cols);}else if(e.key==='0')fit();else if(e.key==='+'||e.key==='=')changeZoom(1.25);else if(e.key==='-')changeZoom(1/1.25);}} onPointerDown={e=>{if(!session||e.button!==0||e.pointerType==='touch')return;const el=e.currentTarget;if(e.nativeEvent.offsetX>=el.clientWidth&&e.target===el)return;e.preventDefault();touchMoved.current=false;el.focus({preventScroll:true});drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop,moved:false};}} onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>4){d.moved=true;setDragging(true);e.currentTarget.setPointerCapture(d.id);e.currentTarget.scrollLeft=d.left-dx;e.currentTarget.scrollTop=d.top-dy;}}} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {busy&&<div className="loading-bar" role="status"><LoaderCircle className="spin" size={17}/>{busy}</div>}
      {session?<div className="world" style={{width:layout.width,height:layout.height}}>{layout.items.map((p,i)=>{const visible=p.top<viewport.top+viewport.height+450&&p.top+p.height>viewport.top-450&&p.left<viewport.left+viewport.width+250&&p.left+p.width>viewport.left-250;return <section key={`${session.key}-${i}`} className={`sheet ${selected===i?'selected':''}`} style={p} aria-label={`${i+1}쪽`} onClick={()=>{if(!drag.current?.moved&&!touchMoved.current)setSelected(i);}} onDoubleClick={()=>{if(touchMoved.current)return;const el=stage.current;if(!el)return;const z=Math.max(.2,Math.min(8,zoom*Math.min((el.clientWidth-56)/p.width,(el.clientHeight-56)/p.height)));const next=gridLayout(session.pages,cols,el.clientWidth,z);restoring.current={key:session.key,cols,zoom:z,left:Math.max(0,next.items[i].left-28)/next.scale,top:Math.max(0,next.items[i].top-28)/next.scale};setZoom(z);}}><PageContent session={session} index={i} visible={visible} priority={p.top<viewport.top+viewport.height&&p.top+p.height>viewport.top&&p.left<viewport.left+viewport.width&&p.left+p.width>viewport.left}/><span className="sheet-num">{i+1}</span></section>;})}</div>:<div className="welcome"><div className="welcome-inner"><div className="file-icon"><FileText size={42}/></div><h1>한글 문서를 한눈에</h1><p>HWP·HWPX 파일을 이곳에 끌어다 놓으면<br/>여러 페이지를 한눈에 볼 수 있습니다.</p><div className="format-tags"><span>HWP</span><span>HWPX</span></div><Button size="lg" onClick={()=>fileInput.current?.click()}><FolderOpen/>파일 선택</Button><div className="privacy-note"><ShieldCheck size={15}/>문서는 이 브라우저 안에서만 처리됩니다.</div><div className="shortcuts"><span><kbd>휠</kbd>스크롤</span><span><kbd>드래그</kbd>이동</span><span><kbd>Ctrl/⌘ + 휠</kbd>확대</span></div><div className="compat-note">글꼴이나 복잡한 표·수식은 한글 프로그램과 다르게 표시될 수 있습니다.<br/>최대 1 GB · 암호 없는 HWP·HWPX</div></div></div>}
    </div>
    <footer className="statusbar" aria-label="문서 상태 및 성능 정보"><RuntimeStats documentMs={documentMs}/><span className="legal-line">본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다. <a href={`${import.meta.env.BASE_URL}licenses.html`} target="_blank" rel="noreferrer">라이선스·고지</a></span><div className="statusbar-right"><span className="status" role="status">{session?`${session.pages.length}쪽 · ${saved?'이 브라우저에 저장됨':'문서 열림'}`:'마지막 문서·보기 위치는 이 브라우저에 저장됨'}</span><span className="footer-detail">{session?'표·수식·글꼴 배치는 원본과 다를 수 있음':'문서는 서버로 전송되지 않음'}</span><a href="https://github.com/edwardkim/rhwp" target="_blank" rel="noreferrer">rhwp</a></div></footer>
    {notice&&<div className="notice" role="alert"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="알림 닫기" onClick={()=>setNotice('')}><X/></Button></div>}{drop&&<div className="drop-overlay">HWP·HWPX 파일을 놓아서 열기</div>}
  </main>;
}
