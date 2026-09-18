export type SavedFile=Readonly<{file:File;key:string}>;
export type SavedView=Readonly<{key:string;cols:number;zoom:number;left:number;top:number}>;
export const VIEW_KEY='hwp-grid-view-v1';
let database:Promise<IDBDatabase>|null=null;
function db(){
  if(!database)database=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('hwp-grid',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>{const value=request.result;value.onversionchange=()=>{value.close();database=null;};resolve(value);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('다른 탭에서 저장소를 사용 중입니다.'));
  }).catch(error=>{database=null;throw error});
  return database;
}
export async function readSavedFile(slot="current"):Promise<SavedFile|undefined>{
  const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('files').objectStore('files').get(slot);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
let queue=Promise.resolve();
function mutate(value:SavedFile|null,slot:string){
  const next=queue.catch(()=>{}).then(async()=>{const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction('files','readwrite');const s=tx.objectStore('files');if(value)s.put(value,slot);else s.delete(slot);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});});
  queue=next;return next;
}
export const saveFile=(value:SavedFile,slot="current")=>mutate(value,slot);
export const clearFile=(slot="current")=>mutate(null,slot);
export function readView(key:string,viewKey=VIEW_KEY):SavedView|null{
  try{const v=JSON.parse(localStorage.getItem(viewKey)||'null');if(!v||v.key!==key)return null;
    return {key,cols:Math.max(1,Math.min(8,Math.round(Number(v.cols)||2))),zoom:Math.max(.2,Math.min(8,Number(v.zoom)||1)),left:Math.max(0,Number(v.left)||0),top:Math.max(0,Number(v.top)||0)};
  }catch{return null;}
}
