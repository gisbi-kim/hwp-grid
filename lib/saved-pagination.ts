import type {HwpDocument} from '@rhwp/core';
import {rewriteHwpx} from './hwpx-rewrite';

export type SavedBreak={section:number;paragraph:number;position:number};
/** Read body lines only. Cell/header lines have independent coordinate systems. */
export function savedPageBreaks(xml:string,section:number):SavedBreak[]{
  // A vertical reset in a multi-column section can be a column, not a page.
  if([...xml.matchAll(/<hp:colPr\b[^>]*\bcolCount="(\d+)"/g)].some(m=>Number(m[1])!==1))return [];
  const result:SavedBreak[]=[];let depth=0,paragraph=-1,previous:number|undefined;
  for(const match of xml.matchAll(/<\/?hp:(p|lineseg)\b[^>]*>/g)){
    const token=match[0];
    if(match[1]==='p'){
      if(token.startsWith('</'))depth--;
      else {if(depth===0)paragraph++;if(!token.endsWith('/>'))depth++;}
      continue;
    }
    if(depth!==1||token.startsWith('</'))continue;
    const attrs=Object.fromEntries([...token.matchAll(/([\w]+)="(-?\d+)"/g)].map(m=>[m[1],Number(m[2])]));
    const y=attrs.vertpos;
    // Synthetic/unmeasured lines do not describe a saved Hancom page boundary.
    if(!Number.isFinite(y)||y<0||!(attrs.vertsize>0)||!(attrs.horzsize>0)||!((attrs.flags??0)&0x40000)){previous=undefined;continue;}
    if(previous!==undefined&&y<5000&&y+1000<previous&&Number.isInteger(attrs.textpos)&&attrs.textpos>=0){
      result.push({section,paragraph,position:attrs.textpos});
    }
    previous=y;
  }
  return result;
}

/** Restore persisted page boundaries on the private viewer document, never on source bytes.
 * RHWP 0.8.6's normal-flow fallback misses resets following inline pictures.
 * Keeping native cached lines avoids font substitution reflow on document open.
 */
export async function restoreSavedPagination(doc:HwpDocument):Promise<number>{
  const breaks:SavedBreak[]=[];
  await rewriteHwpx(doc.exportHwpx(),(name,xml)=>{
    const section=Number(/section(\d+)\.xml$/.exec(name)![1]);
    breaks.push(...savedPageBreaks(xml,section));return xml;
  });
  if(!breaks.length)return 0;
  // Work backwards because a page boundary inside a paragraph splits that paragraph.
  doc.beginBatch();
  try{
    for(const b of breaks.reverse()){
      const offset=doc.logicalToTextOffset(b.section,b.paragraph,b.position);
      const raw=offset===0
        ?doc.applyParaFormat(b.section,b.paragraph,JSON.stringify({pageBreakBefore:true}))
        :doc.insertPageBreak(b.section,b.paragraph,offset);
      if(JSON.parse(raw).ok===false)throw new Error('저장된 쪽 경계를 복원하지 못했습니다.');
    }
  }finally{doc.endBatch();}
  return breaks.length;
}
