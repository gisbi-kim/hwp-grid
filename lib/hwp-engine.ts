import type { HwpDocument } from '@rhwp/core';
import DOMPurify from 'dompurify';
export type PageSize = Readonly<{width:number;height:number}>;
export type DocumentSession = Readonly<{doc:HwpDocument;key:string;name:string;pages:readonly PageSize[]}>;
let enginePromise:Promise<typeof import('@rhwp/core')>|null=null;
let engineMemory:WebAssembly.Memory|null=null;
export function engineMemoryBytes(){return engineMemory?.buffer.byteLength??0;}
export function engine(){
  if(!enginePromise)enginePromise=(async()=>{
    const ctx=document.createElement('canvas').getContext('2d');
    if(!ctx)throw new Error('이 브라우저에서 문서 표시 기능을 사용할 수 없어.');
    (globalThis as unknown as {measureTextWidth:(font:string,text:string)=>number}).measureTextWidth=(font,text)=>{ctx.font=font;return ctx.measureText(text).width;};
    const module=await import('@rhwp/core');
    const wasm=await module.default({module_or_path:`${import.meta.env.BASE_URL}engine/rhwp-0.8.6.wasm`});
    engineMemory=wasm.memory;
    return module;
  })().catch(error=>{enginePromise=null;throw error});
  return enginePromise;
}
export async function parseDocument(file:File,key:string):Promise<DocumentSession>{
  if(!/\.(hwp|hwpx)$/i.test(file.name))throw new Error('HWP 또는 HWPX 파일을 선택해 줘.');
  if(file.size>200*1024*1024)throw new Error('현재는 200 MB 이하의 문서를 열 수 있어.');
  if(!file.size)throw new Error('빈 파일이야. 다른 문서를 선택해 줘.');
  const [module,buffer]=await Promise.all([engine(),file.arrayBuffer()]);
  // SVG text uses CSS unicode-range font loading: fetch only glyph subsets needed
  // by visible pages, instead of blocking parsing on every bundled font subset.
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
const pageCaches=new WeakMap<DocumentSession,Map<number,string>>();
const MAX_CACHE_BYTES=24*1024*1024,MAX_CACHE_PAGES=16;
/** Sanitized, isolated IDs; no links or remote resources from an opened document. */
export function renderPage(session:DocumentSession,index:number):string{
  let cache=pageCaches.get(session);if(!cache){cache=new Map();pageCaches.set(session,cache);}
  const cached=cache.get(index);
  if(cached!==undefined){cache.delete(index);cache.set(index,cached);return cached;}
  const tree=DOMPurify.sanitize(session.doc.renderPageSvg(index),{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['a','style','foreignObject','script','animate','set'],FORBID_ATTR:['style'],RETURN_DOM_FRAGMENT:true});
  const svg=tree.firstElementChild;
  if(!svg||svg.localName!=='svg')throw new Error('페이지 그림을 해석하지 못했어.');
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
  const result=new XMLSerializer().serializeToString(svg);
  // Bound cached SVG text, which may contain large embedded images.
  if(result.length*2<=MAX_CACHE_BYTES){
    cache.set(index,result);
    let bytes=Array.from(cache.values()).reduce((sum,value)=>sum+value.length*2,0);
    while(cache.size>MAX_CACHE_PAGES||bytes>MAX_CACHE_BYTES){const oldest=cache.keys().next().value!;bytes-=cache.get(oldest)!.length*2;cache.delete(oldest);}
  }
  return result;
}
