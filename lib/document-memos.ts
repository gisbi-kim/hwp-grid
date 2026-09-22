export type DocumentMemo={id:string;author:string;text:string;section:number;paragraph:number;inTable:boolean;memoIndex?:number;page?:number;charOffset?:number;cellText?:string;cellParagraph?:number;anchor?:{x:number;y:number;height:number}};
/** Memo fields are document data: parse XML and render as React text, never HTML. */
export function readSectionMemos(xml:string,section:number):DocumentMemo[]{
 const root=new DOMParser().parseFromString(xml,'application/xml');
 if(root.querySelector('parsererror'))throw new Error('메모 정보를 읽지 못했습니다.');
 const result:DocumentMemo[]=[];
 const paragraphs=Array.from(root.documentElement.children).filter(e=>e.localName==='p');
 paragraphs.forEach((p,paragraph)=>{
  for(const field of Array.from(p.getElementsByTagNameNS('*','fieldBegin'))){
   if(field.getAttribute('type')!=='MEMO')continue;
   const params=Array.from(field.getElementsByTagNameNS('*','stringParam'));
   const author=params.find(e=>e.getAttribute('name')==='Author')?.textContent||'';
   const number=Array.from(field.getElementsByTagNameNS('*','integerParam')).find(e=>e.getAttribute('name')==='Number')?.textContent;
   const memoIndex=number&&/^\d+$/.test(number)?Number(number):undefined;
   const sub=Array.from(field.children).find(e=>e.localName==='subList');
   const text=sub?Array.from(sub.children).filter(e=>e.localName==='p').map(e=>Array.from(e.getElementsByTagNameNS('*','t')).map(t=>t.textContent||'').join('')).join('\n'):'';
   let parent=field.parentElement,inTable=false;while(parent&&parent!==p){if(parent.localName==='tc')inTable=true;parent=parent.parentElement;}
   // Count only text in the containing paragraph, excluding nested memo contents.
   const owner=field.closest('p')||p;
   let charOffset=0,found=false;
   const walk=(el:Element)=>{for(const child of Array.from(el.childNodes)){
    if(found)return;if(child===field){found=true;return;}
    if(child instanceof Element){if(child.localName==='subList'||child.localName==='tbl')continue;
     if(child.localName==='t')charOffset+=Array.from(child.textContent||'').length;else walk(child);
    }
   }};walk(owner);
   const cellText=inTable?Array.from(owner.children).filter(e=>e.localName==='run').flatMap(e=>Array.from(e.children).filter(t=>t.localName==='t').map(t=>t.textContent||'')).join(''):undefined;
   const cellParagraph=inTable?Array.from(owner.parentElement?.children||[]).filter(e=>e.localName==='p').indexOf(owner):undefined;
   result.push({cellText,cellParagraph,charOffset:found?charOffset:undefined,id:`${section}-${field.getAttribute('id')||result.length}`,author,text,section,paragraph,inTable,memoIndex});
  }
 });return result;
}
