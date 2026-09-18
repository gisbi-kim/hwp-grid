import {useEffect,useRef,useState,type ReactNode} from 'react';

export function BookmarkSidebar({slot,children}:{slot:string;children:ReactNode}){
  const storageKey=`hwp-grid-bookmark-width-v1-${slot}`;
  const rail=useRef<HTMLElement>(null);
  const [preferred,setPreferred]=useState<number|null>(()=>{
    try{const n=Number(localStorage.getItem(storageKey));return n>=82&&n<=320?n:null;}catch{return null;}
  });
  const [bounds,setBounds]=useState({max:320,initial:174});
  const drag=useRef<{id:number;x:number;width:number}|null>(null);
  const width=Math.max(82,Math.min(bounds.max,preferred??bounds.initial));
  const latest=useRef(width);latest.current=width;
  useEffect(()=>{
    const parent=rail.current?.parentElement;if(!parent)return;
    const measure=()=>setBounds({max:Math.max(82,Math.min(320,Math.floor(parent.clientWidth*.4))),initial:matchMedia('(max-width:720px)').matches?123:174});
    const observer=new ResizeObserver(measure);observer.observe(parent);measure();
    return()=>observer.disconnect();
  },[]);
  const change=(value:number)=>{const next=Math.max(82,Math.min(bounds.max,value));latest.current=next;setPreferred(next);};
  const save=()=>{try{localStorage.setItem(storageKey,String(latest.current));}catch{/* Width adjustment remains available when storage is disabled. */}};
  return <aside ref={rail} className="bookmark-rail" aria-label="책갈피 목록" style={{width}}>
    {children}
    <div className="bookmark-resizer" role="separator" tabIndex={0} aria-label="책갈피 영역 너비 조절" aria-orientation="vertical" aria-valuemin={82} aria-valuemax={bounds.max} aria-valuenow={width} aria-valuetext={`${width}픽셀`} title="드래그하거나 좌우 방향키로 너비 조절"
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus({preventScroll:true});drag.current={id:e.pointerId,x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=drag.current;if(d?.id===e.pointerId)change(d.width+e.clientX-d.x);}}
      onPointerUp={e=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;save();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>{drag.current=null;save();}} onLostPointerCapture={()=>{drag.current=null;}}
      onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();change(e.key==='Home'?82:e.key==='End'?bounds.max:width+(e.key==='ArrowRight'?10:-10));save();}}/>
  </aside>;
}
