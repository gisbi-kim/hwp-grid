import type {HwpDocument} from '@rhwp/core';
type Run={text:string;y:number;h:number;secIdx?:number;paraIdx?:number;parentParaIdx?:number};
type Control={type:string;y:number;h:number;secIdx:number;paraIdx:number};
type Info={height:number;marginBottom:number;marginFooter:number;marginTop:number;marginHeader:number;footerArea?:{y:number}};
export function bodyBottom(info:Info):number{return info.footerArea?.y??info.height-info.marginBottom-info.marginFooter;}
/** Guard recomputed layout against under-measured body paragraphs. Only the read-only
 * viewer instance is adjusted; source bytes and the editing/export document are untouched.
 * Keep paragraph identities intact so memo anchors remain valid. */
export function protectFooterArea(doc:HwpDocument):number{
  const moved=new Set<string>();let total=0;
  for(let pass=0;pass<32;pass++){
    const firstSeen=new Map<string,number>();const fixes=new Map<string,{section:number;paragraph:number}>();
    for(let page=0;page<doc.pageCount();page++){
      const info:Info=JSON.parse(doc.getPageInfo(page)),bottom=bodyBottom(info),top=info.marginTop+info.marginHeader;
      const runs:Run[]=JSON.parse(doc.getPageTextLayout(page)).runs;
      const controls:Control[]=JSON.parse(doc.getPageControlLayout(page)).controls;
      const items=[...runs.filter(r=>r.text.trim()&&r.secIdx!==undefined&&r.paraIdx!==undefined&&r.parentParaIdx===undefined).map(r=>({section:r.secIdx!,paragraph:r.paraIdx!,y:r.y,h:r.h})),...controls.filter(c=>c.type==='table').map(c=>({section:c.secIdx,paragraph:c.paraIdx,y:c.y,h:c.h}))];
      const groups=new Map<string,{section:number;paragraph:number;min:number;max:number}>();
      for(const item of items){const key=`${item.section}:${item.paragraph}`;if(!firstSeen.has(key))firstSeen.set(key,page);const g=groups.get(key)??{...item,min:item.y,max:item.y+item.h};g.min=Math.min(g.min,item.y);g.max=Math.max(g.max,item.y+item.h);groups.set(key,g);}
      // Move the earliest offending paragraph on each page. Later content follows it.
      const candidate=[...groups.entries()].filter(([key,g])=>firstSeen.get(key)===page&&!moved.has(key)&&g.min>top+1&&g.max>bottom+1&&g.max-g.min<=bottom-top).sort((a,b)=>a[1].paragraph-b[1].paragraph)[0];
      if(candidate)fixes.set(candidate[0],candidate[1]);
    }
    if(!fixes.size)break;
    doc.beginBatch();try{for(const [key,f]of fixes){const result=JSON.parse(doc.applyParaFormat(f.section,f.paragraph,JSON.stringify({pageBreakBefore:true})));if(result.ok===false)throw new Error('본문의 쪽 경계를 보정하지 못했습니다.');moved.add(key);total++;}}finally{doc.endBatch();}
  }
  return total;
}
