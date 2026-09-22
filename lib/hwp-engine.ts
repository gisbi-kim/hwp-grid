import type {RawMemo} from './hwp-memo-records';
import {rewriteHwpx} from './hwpx-rewrite';
import {readSectionMemos,type DocumentMemo} from './document-memos';
import DOMPurify from 'dompurify';
import {documentCacheKey,cachedDocument,cachedPage,cacheDocument,cachePage} from './document-cache';
import type {EditCommand,EditState} from './edit-model';
export type PageSize=Readonly<{width:number;height:number}>;
type RemoteDocument={memos:()=>Promise<DocumentMemo[]>;renderPageSvg:(index:number)=>Promise<string>;free:()=>void};
export type DocumentSession=Readonly<{doc:RemoteDocument;key:string;name:string;pages:readonly PageSize[];cacheId?:string;cacheHit?:boolean}>;
export type EditSession=DocumentSession&{doc:RemoteDocument&{edit:(command:EditCommand)=>Promise<EditState>;editState:()=>Promise<EditState>;exportCopy:(format:'hwp'|'hwpx')=>Promise<Uint8Array<ArrayBuffer>>;selectedText:()=>Promise<string>;clipboard:(forceObject?:boolean)=>Promise<{text:string;html:string}>;checkpoint:()=>Promise<EditState>;restoreCheckpoint:(id:number)=>Promise<EditState>}};
export function editCopyName(name:string){return name.replace(/\.(hwp|hwpx)$/i,'')+'_편집본_'+new Date().toISOString().replace(/[:.]/g,'-')+(/\.hwpx$/i.test(name)?'.hwpx':'.hwp');}
export async function createEditCopy(file:File,signal:AbortSignal,askPassword:(retry:boolean)=>Promise<string|null>):Promise<EditSession>{
  signal.throwIfAborted();
  // A new File and a separate worker: no writes to saved originals or render caches.
  const copy=new File([file],editCopyName(file.name),{type:file.type,lastModified:Date.now()});
  return await parseWithEngine(copy,crypto.randomUUID(),signal,askPassword,true) as EditSession;
}
const workers=new Map<Worker,number>();
export function engineMemoryBytes(){return Array.from(workers.values()).reduce((a,b)=>a+b,0);}
export async function parseDocument(file:File,key:string,signal?:AbortSignal,askPassword?:(retry:boolean)=>Promise<string|null>):Promise<DocumentSession>{
  if(!/\.(hwp|hwpx)$/i.test(file.name))throw new Error('HWP 또는 HWPX 파일을 선택해 주세요.');
  if(file.size>1024*1024*1024)throw new Error('1 GB 이하의 문서만 열 수 있습니다.');
  if(!file.size)throw new Error('빈 파일입니다. 다른 문서를 선택해 주세요.');
  signal?.throwIfAborted();
  let cacheId:string|undefined;
  try{cacheId=await documentCacheKey(file);}catch{/* Cache unavailable: use the engine. */}
  signal?.throwIfAborted();
  const pages=cacheId?await cachedDocument(cacheId).catch(()=>undefined):undefined;
  signal?.throwIfAborted();
  let encrypted=false,closed=false,engine:Promise<DocumentSession>|undefined;
  const controller=new AbortController();
  const password=async(retry:boolean)=>{encrypted=true;return askPassword?askPassword(retry):null;};
  const free=()=>{closed=true;controller.abort();signal?.removeEventListener('abort',free);void engine?.then(s=>s.doc.free(),()=>{});};
  signal?.addEventListener('abort',free,{once:true});
  const getEngine=()=>{
    if(closed)throw new DOMException('문서가 닫혔습니다.','AbortError');
    return engine??=parseWithEngine(file,key,controller.signal,password);
  };
  try{
    const sizes=pages??(await getEngine()).pages;
    if(closed||signal?.aborted)throw new DOMException('문서 열기를 취소했습니다.','AbortError');
    // Never persist decrypted output or password-protected document metadata.
    if(encrypted)cacheId=undefined;
    if(cacheId&&!pages)await cacheDocument(cacheId,sizes);
    signal?.throwIfAborted();
    const doc:RemoteDocument={free,memos:async()=>await (await getEngine()).doc.memos(),renderPageSvg:async index=>{
      if(closed)throw new DOMException('문서가 닫혔습니다.','AbortError');
      if(cacheId){const svg=await cachedPage(cacheId,index).catch(()=>undefined);if(svg!==undefined)return svg;}
      const svg=await (await getEngine()).doc.renderPageSvg(index);
      if(cacheId&&!closed)await cachePage(cacheId,index,svg);
      return svg;
    }};
    return {doc,key,name:file.name,pages:sizes,cacheId,cacheHit:!!pages};
  }catch(error){free();throw error;}
}
async function parseWithEngine(file:File,key:string,signal?:AbortSignal,askPassword?:(retry:boolean)=>Promise<string|null>,editable=false):Promise<DocumentSession>{
  const worker=new Worker(new URL('./hwp-worker.ts',import.meta.url),{type:'module'});
  workers.set(worker,0);
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  let id=0,closed=false;
  const free=()=>{
    if(closed)return;closed=true;worker.terminate();workers.delete(worker);
    for(const request of pending.values())request.reject(new Error('문서가 닫혔습니다.'));
    pending.clear();
  };
  worker.onmessage=({data})=>{
    if(closed)return;workers.set(worker,data.bytes);
    const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
    if(data.error)request.reject(new Error(data.error));else request.resolve(data.value);
  };
  worker.onerror=()=>free();worker.onmessageerror=()=>free();
  signal?.addEventListener('abort',free,{once:true});
  const request=(kind:'open'|'render'|'edit'|'editState'|'exportCopy'|'selectedText'|'clipboard'|'checkpoint'|'restoreCheckpoint'|'memoSource'|'memoPages'|'rawMemos',extra:Record<string,unknown>={})=>new Promise<unknown>((resolve,reject)=>{
    if(closed){reject(new Error('문서가 닫혔습니다.'));return;}
    const next=++id;pending.set(next,{resolve,reject});
    try{worker.postMessage({id:next,kind,...extra});}catch(error){pending.delete(next);reject(error);}
  });
  try{
    let pages:PageSize[],password:string|undefined;
    for(;;){
      try{pages=await request('open',{file,password,editable,url:new URL(`${import.meta.env.BASE_URL}engine/rhwp-0.8.6-native-layout-1.wasm`,location.href).href}) as PageSize[];password=undefined;break;}
      catch(error){
        const message=String(error instanceof Error?error.message:error);
        if(!askPassword||!/비밀번호가 필요한|비밀번호가 일치하지 않/.test(message))throw error;
        const retry=password!==undefined;password=undefined;
        const entered=await askPassword(retry);
        signal?.throwIfAborted();
        if(entered===null)throw new DOMException('문서 열기를 취소했습니다.','AbortError');
        password=entered;
      }
    }
    let memoPromise:Promise<DocumentMemo[]>|undefined;
    const memos=()=>memoPromise??=(async()=>{
      const entries:DocumentMemo[]=[];
      await rewriteHwpx(await request('memoSource') as Uint8Array,(name,xml)=>{entries.push(...readSectionMemos(xml,Number(/section(\d+)\.xml$/.exec(name)![1])));return xml;});
      const raw=await request('rawMemos') as RawMemo[];
      const bodies=new Map(raw.map(m=>[`${m.section}-${m.index}`,m.text]));
      for(const entry of entries){const body=bodies.get(`${entry.section}-${entry.memoIndex}`);if(body!==undefined)entry.text=body;}
      const pages=await request('memoPages',{anchors:entries.map(({section,paragraph})=>({section,paragraph}))}) as (number|null)[];
      return entries.map((m,i)=>({...m,page:pages[i]??undefined}));
    })().catch(error=>{memoPromise=undefined;throw error;});
    const doc={free,memos,renderPageSvg:(index:number)=>request('render',{index}) as Promise<string>,...(editable?{edit:(command:EditCommand)=>request('edit',{command}) as Promise<EditState>,editState:()=>request('editState') as Promise<EditState>,exportCopy:(format:'hwp'|'hwpx')=>request('exportCopy',{format}) as Promise<Uint8Array<ArrayBuffer>>,selectedText:()=>request('selectedText') as Promise<string>,clipboard:(forceObject=false)=>request('clipboard',{forceObject}) as Promise<{text:string;html:string}>,checkpoint:()=>request('checkpoint') as Promise<EditState>,restoreCheckpoint:(index:number)=>request('restoreCheckpoint',{index}) as Promise<EditState>}:{})};
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
  if(!svg||svg.localName!=='svg')throw new Error('페이지 그림을 해석하지 못했습니다.');
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
