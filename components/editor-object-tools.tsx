import {useEffect,useRef,useState} from 'react';
import {Button} from './ui/button';
import type {EditCommand,EditObject,ImageMode} from '@/lib/edit-model';

export function ObjectTools({object,busy,onCommand,onCopy}:{object:EditObject;busy:boolean;onCommand:(command:EditCommand)=>void;onCopy?:()=>void}){
  const [width,setWidth]=useState(''),[height,setHeight]=useState('');
  useEffect(()=>{setWidth((object.width*25.4/96).toFixed(1));setHeight((object.height*25.4/96).toFixed(1));},[object.width,object.height]);
  const size=()=>{if(Math.abs(Number(width)*96/25.4-object.width)>.3||Math.abs(Number(height)*96/25.4-object.height)>.3)onCommand({kind:'objectResize',width:Number(width)*96/25.4,height:Number(height)*96/25.4});};
  const title=object.type==='image'?'그림':'표';
  return <div className="editor-toolbar object-tools" aria-label={`${title} 편집 도구`}>
    <strong>{title} 선택</strong><Button variant="outline" size="sm" disabled={busy} onClick={onCopy}>{title} 전체 복사</Button>
    <label>가로 <input aria-label={`${title} 가로 mm`} type="number" step="0.1" value={width} disabled={busy} onChange={e=>setWidth(e.target.value)} onBlur={size} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/> mm</label>
    <label>세로 <input aria-label={`${title} 세로 mm`} type="number" step="0.1" value={height} disabled={busy} onChange={e=>setHeight(e.target.value)} onBlur={size} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/> mm</label>
    {object.type==='image'?<><label>배치 <select aria-label="그림 배치" value={object.mode} disabled={busy} onChange={e=>onCommand({kind:'imageMode',mode:e.target.value as ImageMode})}><option value="inline">글자처럼</option><option value="square">어울림</option><option value="topBottom">자리 차지</option><option value="front">글 앞으로</option><option value="behind">글 뒤로</option></select></label><span className="editor-hint">그림을 끌어 이동 · 모서리를 끌어 크기 조절 · Shift로 비율 유지 · Alt+클릭으로 겹친 글자 선택{object.mode==='inline'?' · 놓은 글 사이 또는 표 앞뒤에 삽입':''}</span></>:<>
      <label>셀 배경 <input type="color" aria-label="셀 배경색" value={object.fillColor??'#ffffff'} disabled={busy} onChange={e=>onCommand({kind:'cellColor',color:e.target.value})}/></label>{!!object.selectedCells&&<span>{object.selectedCells}개 셀 선택</span>}
      <span>{object.row!+1}행 {object.col!+1}열</span>
      {([['splitRows','셀을 2행으로'],['splitCols','셀을 2열로'],['mergeRight','오른쪽 셀과 합치기'],['mergeDown','아래 셀과 합치기'],['addRow','행 추가'],['addCol','열 추가'],['splitTable','현재 행에서 표 나누기'],['mergeTable','다음 표와 합치기']] as const).map(([operation,label])=><Button key={operation} variant="outline" size="sm" disabled={busy} onClick={()=>onCommand({kind:'table',operation})}>{label}</Button>)}
    </>}
  </div>;
}

export function ObjectSelection({object,zoom,busy,onCommand}:{object:EditObject;zoom:number;busy:boolean;onCommand:(command:EditCommand)=>void}){
  const [preview,setPreview]=useState<{x:number;y:number;w:number;h:number}|null>(null);
  const gesture=useRef<{x:number;y:number;resize:boolean;object:EditObject}|null>(null);
  useEffect(()=>{setPreview(null);gesture.current=null;},[object.secIdx,object.paraIdx,object.controlIdx,object.x,object.y,object.w,object.h]);
  const box=preview??object;
  const start=(event:React.PointerEvent<HTMLElement>,resize:boolean)=>{if(busy)return;event.preventDefault();event.stopPropagation();if(event.altKey&&!resize){const r=event.currentTarget.getBoundingClientRect();onCommand({kind:'pick',page:object.pageIndex,x:object.x+(event.clientX-r.left)/zoom,y:object.y+(event.clientY-r.top)/zoom,textOnly:true});return;}event.currentTarget.setPointerCapture(event.pointerId);gesture.current={x:event.clientX,y:event.clientY,resize,object};};
  const move=(event:React.PointerEvent<HTMLElement>)=>{
    const g=gesture.current;if(!g)return;event.preventDefault();event.stopPropagation();const dx=(event.clientX-g.x)/zoom,dy=(event.clientY-g.y)/zoom;
    if(g.resize){const w=Math.max(8,g.object.w+dx),h=event.shiftKey&&object.type==='image'?w*g.object.h/g.object.w:Math.max(8,g.object.h+dy);setPreview({x:g.object.x,y:g.object.y,w,h});}
    else setPreview({x:Math.max(0,g.object.x+dx),y:Math.max(0,g.object.y+dy),w:g.object.w,h:g.object.h});
  };
  const finish=(event:React.PointerEvent<HTMLElement>)=>{
    event.preventDefault();event.stopPropagation();const g=gesture.current;gesture.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(g&&preview&&(Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)>2)){
      if(g.resize)onCommand({kind:'objectResize',width:g.object.width*preview.w/g.object.w,height:g.object.height*preview.h/g.object.h});
      else{
        const sheets=Array.from(event.currentTarget.closest('dialog')?.querySelectorAll<HTMLElement>('.editor-sheet')??[]);
        const page=sheets.findIndex(sheet=>{const r=sheet.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;});
        const rect=page>=0?sheets[page].getBoundingClientRect():null;
        if(g.object.mode!=='inline'||rect)onCommand({kind:'imageMove',x:preview.x,y:preview.y,...(rect?{drop:{page,x:(event.clientX-rect.left)/zoom,y:(event.clientY-rect.top)/zoom}}:{})});
      }
    }setPreview(null);
  };
  return <div className="object-selection" style={{left:box.x*zoom,top:box.y*zoom,width:box.w*zoom,height:box.h*zoom}}>
    {object.type==='image'&&<button type="button" className="object-move" aria-label="그림 이동" disabled={busy} onPointerDown={e=>start(e,false)} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null);}} onKeyDown={e=>{const moves:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(moves[e.key]){e.preventDefault();onCommand({kind:'imageMove',x:object.x+moves[e.key][0]*(e.shiftKey?10:1),y:object.y+moves[e.key][1]*(e.shiftKey?10:1)});}}}/>}
    <button type="button" className="object-resize" aria-label={`${object.type==='image'?'그림':'표'} 크기 조절`} disabled={busy} onPointerDown={e=>start(e,true)} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null);}}/>
  </div>;
}
