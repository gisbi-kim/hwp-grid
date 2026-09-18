import DOMPurify from 'dompurify';
export type PageSize=Readonly<{width:number;height:number}>;
type RemoteDocument={renderPageSvg:(index:number)=>Promise<string>;free:()=>void};
export type DocumentSession=Readonly<{doc:RemoteDocument;key:string;name:string;pages:readonly PageSize[]}>;
const workers=new Map<Worker,number>();
export function engineMemoryBytes(){return Array.from(workers.values()).reduce((a,b)=>a+b,0);}
export async function parseDocument(file:File,key:string,signal?:AbortSignal):Promise<DocumentSession>{
  if(!/\.(hwp|hwpx)$/i.test(file.name))throw new Error('HWP 또는 HWPX 파일을 선택해 줘.');
  if(file.size>1024*1024*1024)throw new Error('현재는 1 GB 이하의 문서를 열 수 있어.');
  if(!file.size)throw new Error('빈 파일이야. 다른 문서를 선택해 줘.');
  signal?.throwIfAborted();
  const worker=new Worker(new URL('./hwp-worker.ts',import.meta.url),{type:'module'});
  workers.set(worker,0);
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  let id=0,closed=false;
  const free=()=>{
    if(closed)return;closed=true;worker.terminate();workers.delete(worker);
    for(const request of pending.values())request.reject(new Error('문서가 닫혔어.'));
    pending.clear();
  };
  worker.onmessage=({data})=>{
    if(closed)return;workers.set(worker,data.bytes);
    const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
    if(data.error)request.reject(new Error(data.error));else request.resolve(data.value);
  };
  worker.onerror=()=>free();worker.onmessageerror=()=>free();
  signal?.addEventListener('abort',free,{once:true});
  const request=(kind:'open'|'render',extra:Record<string,unknown>)=>new Promise<unknown>((resolve,reject)=>{
    if(closed){reject(new Error('문서가 닫혔어.'));return;}
    const next=++id;pending.set(next,{resolve,reject});
    try{worker.postMessage({id:next,kind,...extra});}catch(error){pending.delete(next);reject(error);}
  });
  try{
    const pages=await request('open',{file,url:new URL(`${import.meta.env.BASE_URL}engine/rhwp-0.8.6.wasm`,location.href).href}) as PageSize[];
    const doc:RemoteDocument={free,renderPageSvg:(index)=>request('render',{index}) as Promise<string>};
    return {doc,key,name:file.name,pages};
  }catch(error){free();throw error;}finally{signal?.removeEventListener('abort',free);}
}
const pageCaches=new WeakMap<DocumentSession,Map<number,string>>();
const MAX_CACHE_BYTES=24*1024*1024,MAX_CACHE_PAGES=16;
/** Sanitized, isolated IDs; no links or remote resources from an opened document. */
export async function renderPage(session:DocumentSession,index:number):Promise<string>{
  let cache=pageCaches.get(session);if(!cache){cache=new Map();pageCaches.set(session,cache);}
  const cached=cache.get(index);
  if(cached!==undefined){cache.delete(index);cache.set(index,cached);return cached;}
  const tree=DOMPurify.sanitize(await session.doc.renderPageSvg(index),{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['a','style','foreignObject','script','animate','set'],FORBID_ATTR:['style'],RETURN_DOM_FRAGMENT:true});
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
