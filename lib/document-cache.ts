// Bump when the parser, SVG output, or cache format changes.
export const CACHE_VERSION = 'rhwp-0.8.6-saved-pagination-2';
export const CACHE_LIMIT = 10_000_000_000;
type PageSize = Readonly<{width:number;height:number}>;
type Entry = {id:string;pages:readonly PageSize[];bytes:number;lastUsed:number};
type Page = {document:string;index:number;svg:Blob};
let database:Promise<IDBDatabase>|undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('hwp-grid-render-cache',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('documents',{keyPath:'id'});
      request.result.createObjectStore('pages',{keyPath:['document','index']}).createIndex('document','document');
    };
    request.onsuccess=()=>{const value=request.result;value.onversionchange=()=>{value.close();database=undefined;};resolve(value);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Cache unavailable'));
  }).catch(error=>{database=undefined;throw error;});
}
function request<T>(value:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});}
function done(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}
function remove(tx:IDBTransaction,id:string){
  tx.objectStore('documents').delete(id);
  const cursor=tx.objectStore('pages').index('document').openKeyCursor(IDBKeyRange.only(id));
  cursor.onsuccess=()=>{const item=cursor.result;if(item){tx.objectStore('pages').delete(item.primaryKey);item.continue();}};
}
// Full-content digest prevents stale hits even for same name, size and timestamp.
export async function documentCacheKey(file:File){
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return `${CACHE_VERSION}:${Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}`;
}
export async function cachedDocument(id:string){
  const d=await db(),tx=d.transaction('documents','readwrite'),complete=done(tx);
  const store=tx.objectStore('documents'),r=store.get(id);
  let value:Entry|undefined;
  r.onsuccess=()=>{value=r.result;if(value){value.lastUsed=Date.now();store.put(value);}};
  await complete;
  if(!value||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>3000||value.pages.some(p=>!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0))return undefined;
  return value.pages;
}
export async function cachedPage(id:string,index:number){
  const d=await db(),tx=d.transaction(['documents','pages'],'readwrite'),complete=done(tx);
  const r=tx.objectStore('pages').get([id,index]);let value:Page|undefined;
  r.onsuccess=()=>{value=r.result;if(value){const entry=tx.objectStore('documents').get(id);entry.onsuccess=()=>{if(entry.result)tx.objectStore('documents').put({...entry.result,lastUsed:Date.now()});};}};
  await complete;
  return value?.svg.text();
}
async function write(id:string,pages?:readonly PageSize[],page?:Page){
  const estimate=await navigator.storage?.estimate?.().catch(()=>undefined);
  const d=await db(),tx=d.transaction(['documents','pages'],'readwrite'),complete=done(tx);
  const store=tx.objectStore('documents');
  const all=store.getAll();
  // Only IndexedDB request callbacks inside the transaction: no file/crypto awaits.
  all.onsuccess=()=>{
    const entries=all.result as Entry[];
    const existing=entries.find(e=>e.id===id);
    if(!existing&&!pages)return; // Evicted or manually cleared: do not resurrect.
    const apply=(previous?:Page)=>{
      const metadata=pages??existing!.pages;
      const base=new Blob([JSON.stringify({id,pages:metadata})]).size+512;
      const bytes=page?(existing!.bytes+(page.svg.size+128)-(previous?previous.svg.size+128:0)):(existing?.bytes??base);
      let total=entries.reduce((sum,e)=>sum+e.bytes,0);
      // Leave room for saved originals, other same-origin apps, and DB overhead.
      const external=Math.max(0,(estimate?.usage??0)-total);
      const limit=Math.max(0,Math.min(CACHE_LIMIT, (estimate?.quota??Infinity)*0.9)-external);
      if(bytes>limit)return;
      total+=bytes-(existing?.bytes??0);
      for(const entry of entries.sort((a,b)=>a.lastUsed-b.lastUsed||a.id.localeCompare(b.id))){
        if(entry.id===id)continue;
        if(total<=limit&&entry.id.startsWith(CACHE_VERSION+':'))continue;
        remove(tx,entry.id);total-=entry.bytes;
      }
      if(total>limit)return;
      store.put({id,pages:metadata,bytes,lastUsed:Date.now()} satisfies Entry);
      if(page)tx.objectStore('pages').put(page);
    };
    if(page){const old=tx.objectStore('pages').get([id,page.index]);old.onsuccess=()=>apply(old.result);}
    else apply();
  };
  await complete;
}
async function evictOldest(){
  const d=await db(),tx=d.transaction(['documents','pages'],'readwrite'),complete=done(tx);
  const all=tx.objectStore('documents').getAll();let removed=false;
  all.onsuccess=()=>{const oldest=(all.result as Entry[]).sort((a,b)=>a.lastUsed-b.lastUsed)[0];if(oldest){remove(tx,oldest.id);removed=true;}};
  await complete;return removed;
}
// Storage is an optimization. Quota errors never stop opening/rendering a document.
async function bestEffortWrite(id:string,pages?:readonly PageSize[],page?:Page){
  try{await write(id,pages,page);}catch(error){
    if(error instanceof DOMException&&error.name==='QuotaExceededError'){
      try{if(await evictOldest())await write(id,pages,page);}catch{/* Normal rendering continues. */}
    }
  }
}
export const cacheDocument=(id:string,pages:readonly PageSize[])=>bestEffortWrite(id,pages);
export const cachePage=(id:string,index:number,svg:string)=>bestEffortWrite(id,undefined,{document:id,index,svg:new Blob([svg],{type:'image/svg+xml'})});
export async function deleteCachedDocument(id:string){const d=await db(),tx=d.transaction(['documents','pages'],'readwrite'),complete=done(tx);remove(tx,id);await complete;}
export async function clearDocumentCache(){const d=await db(),tx=d.transaction(['documents','pages'],'readwrite'),complete=done(tx);tx.objectStore('documents').clear();tx.objectStore('pages').clear();await complete;}
export async function cacheStats(){const d=await db();const entries=await request<Entry[]>(d.transaction('documents').objectStore('documents').getAll());return {count:entries.length,bytes:entries.reduce((sum,e)=>sum+e.bytes,0)};}
