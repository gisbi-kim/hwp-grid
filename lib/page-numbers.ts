import {HwpDocument} from '@rhwp/core';
import {rewriteHwpx} from './hwpx-rewrite';
/** Uses real HWP page-number controls; headers, footers and body are retained. */
export async function pageNumberCopy(source:HwpDocument,startPage:number|null):Promise<HwpDocument>{
  if(startPage!==null&&(!Number.isInteger(startPage)||startPage<1||startPage>source.pageCount()))throw new Error('시작 쪽을 1부터 문서의 마지막 쪽 사이로 입력해 주세요.');
  let result:HwpDocument|undefined;
  try{
    const bytes=await rewriteHwpx(source.exportHwpx(),(_name,xml)=>{
      // Remove only numbering, keeping other fields and all footer/header text.
      xml=xml.replace(/<hp:pageNum\b[^>]*(?:\/>|>[\s\S]*?<\/hp:pageNum>)/g,'')
        .replace(/<hp:newNum\b(?=[^>]*\bnumType="PAGE")[^>]*(?:\/>|>[\s\S]*?<\/hp:newNum>)/g,'')
        .replace(/<hp:autoNum\b(?=[^>]*\bnumType="PAGE")[^>]*(?:\/>|>[\s\S]*?<\/hp:autoNum>)/g,'')
        .replace(/(<hp:startNum\b[^>]*\bpage=")[^"]*/g,'$10');
      if(startPage!==null)xml=xml.replace(/hidePageNum="1"/g,'hidePageNum="0"').replace('</hp:run>','<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar=" "/></hp:ctrl></hp:run>');
      return xml;
    });
    result=new HwpDocument(bytes);
    if(startPage!==null){
      // HWP hide/restart controls are paragraph anchored. Materialize an existing
      // page boundary when a single body paragraph flows across it.
      const starts=JSON.parse(result.getPageCaretStarts()) as {list:number;para:number;pos:number}[];
      const sections=JSON.parse(result.getSectionStarts()) as number[];
      for(let page=startPage-1;page>0;page--){
        const origin=JSON.parse(result.getPositionOfPage(page)) as {sec:number;para:number};
        const continuingTable=JSON.parse(result.getPageControlLayout(page-1)).controls.some((c:{type:string;secIdx:number;paraIdx:number})=>c.type==='table'&&c.secIdx===origin.sec&&c.paraIdx===origin.para);
        if(continuingTable)throw new Error('여러 쪽에 걸친 표의 중간에서는 번호를 새로 시작할 수 없습니다. 해당 쪽에서 표를 나눈 뒤 다시 지정해 주세요.');
        const at=starts[page];
        if(at.list!==0)throw new Error('시작 쪽 앞에 여러 쪽에 걸친 표가 있습니다. 표를 해당 쪽에서 나눈 뒤 쪽수를 지정해 주세요.');
        let sec=sections.length-1;while(sec>0&&sections[sec]>at.para)sec--;
        const para=at.para-sections[sec],offset=result.logicalToTextOffset(sec,para,at.pos);
        if(offset>0)result.insertPageBreak(sec,para,offset);
      }
      if(result.pageCount()!==source.pageCount())throw new Error('쪽 경계를 유지할 수 없어 쪽수 변경을 취소했습니다.');
      // Anchor hiding and restart to the first editable body position of each page.
      for(let page=0;page<result.pageCount();page++){
        const pos=JSON.parse(result.getPositionOfPage(page)) as {sec:number;para:number;charOffset:number};
        const sec=pos.sec,para=pos.para;
        const hide=JSON.parse(result.getPageHide(sec,para));
        result.setPageHide(sec,para,!!hide.hideHeader,!!hide.hideFooter,!!hide.hideMasterPage,!!hide.hideBorder,!!hide.hideFill,page<startPage-1);
        if(page===startPage-1)result.insertNewNumber(sec,para,0,1);
      }
    }
    return result;
  }catch(error){result?.free();throw error;}
}
