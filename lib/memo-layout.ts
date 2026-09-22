import type {DocumentMemo} from './document-memos';
export const MEMO_GUTTER=260;
/** Keep cards in anchor order; long comments scroll inside a bounded card. */
export function memoCards(memos:readonly DocumentMemo[],page:number,scale:number){
 let bottom=0;
 return memos.filter(m=>m.page===page).sort((a,b)=>(a.anchor?.y??0)-(b.anchor?.y??0)).map(m=>{
  const height=Math.min(220,80+Math.ceil(Array.from(m.text||'').length/22)*20);
  const top=Math.max(12,(m.anchor?.y??12)*scale,bottom);
  bottom=top+height+12;return {memo:m,top,height};
 });
}
