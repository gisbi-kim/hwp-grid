import type { HwpDocument } from '@rhwp/core';
import DOMPurify from 'dompurify';
export type PageSize = Readonly<{width:number;height:number}>;
export type DocumentSession = Readonly<{doc:HwpDocument;key:string;name:string;pages:readonly PageSize[]}>;
let enginePromise:Promise<typeof import('@rhwp/core')>|null=null;
export function engine(){
  if(!enginePromise)enginePromise=(async()=>{
    const ctx=document.createElement('canvas').getContext('2d');
    if(!ctx)throw new Error('이 브라우저에서 문서 표시 기능을 사용할 수 없어.');
    (globalThis as unknown as {measureTextWidth:(font:string,text:string)=>number}).measureTextWidth=(font,text)=>{ctx.font=font;return ctx.measureText(text).width;};
    const module=await import('@rhwp/core');
    await module.default({module_or_path:`${import.meta.env.BASE_URL}engine/rhwp-0.8.6.wasm`});
    return module;
  })().catch(error=>{enginePromise=null;throw error});
  return enginePromise;
}
export async function parseDocument(file:File,key:string):Promise<DocumentSession>{
  if(!/\.(hwp|hwpx)$/i.test(file.name))throw new Error('HWP 또는 HWPX 파일을 선택해 줘.');
  if(file.size>50*1024*1024)throw new Error('현재는 50 MB 이하의 문서를 열 수 있어.');
  if(!file.size)throw new Error('빈 파일이야. 다른 문서를 선택해 줘.');
  const [module,buffer]=await Promise.all([engine(),file.arrayBuffer()]);
  // Load Korean fallbacks before the engine measures text, using local font assets only.
  await Promise.all(Array.from(document.fonts).filter(face=>/Noto (Sans|Serif) KR/.test(face.family)).map(face=>face.load()));
  const doc=new module.HwpDocument(new Uint8Array(buffer));
  try{
    const count=doc.pageCount();
    if(count<1||count>3000)throw new Error('페이지 수가 지원 범위를 벗어났어. (1–3,000쪽)');
    const pages=Array.from({length:count},(_,i)=>{
      const p=JSON.parse(doc.getPageInfo(i));
      if(!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0)throw new Error('페이지 크기를 읽지 못했어.');
      return {width:p.width,height:p.height};
    });
    return {doc,key,name:file.name,pages};
  }catch(error){doc.free();throw error;}
}
/** Sanitized, isolated IDs; no links or remote resources from an opened document. */
export function renderPage(session:DocumentSession,index:number):string{
  const clean=DOMPurify.sanitize(session.doc.renderPageSvg(index),{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['a','style','foreignObject','script','animate','set'],FORBID_ATTR:['style']});
  const tree=new DOMParser().parseFromString(clean,'image/svg+xml');
  if(tree.querySelector('parsererror'))throw new Error('페이지 그림을 해석하지 못했어.');
  const prefix=`page-${session.key}-${index}-`;
  for(const el of tree.querySelectorAll('*')){
    if(el.id)el.id=prefix+el.id;
    for(const attr of Array.from(el.attributes)){
      if(attr.localName==='href'){
        if(attr.value.startsWith('#'))el.setAttribute(attr.name,'#'+prefix+attr.value.slice(1));
        else if(!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(attr.value))el.removeAttribute(attr.name);
      }else if(attr.value.includes('url(')){
        if(/^url\(#[\w.-]+\)$/.test(attr.value))el.setAttribute(attr.name,attr.value.replace('url(#','url(#'+prefix));
        else el.removeAttribute(attr.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(tree.documentElement);
}
