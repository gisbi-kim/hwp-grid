export type EditDraft={id:string;name:string;blob:Blob;savedAt:number;revision:number;sessionId:string};
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open('hwp-grid-edit-drafts',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('latest',{keyPath:'id'});
  r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>{d.close();database=undefined;};resolve(d);};
  r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('자동저장 저장소가 다른 탭에서 사용 중입니다.'));
}).catch(error=>{database=undefined;throw error;});}
export async function draftId(file:File){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');}
export async function readDraft(id:string):Promise<EditDraft|undefined>{const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('latest').objectStore('latest').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
/** One atomic replacement per source. A quota failure leaves the previous version intact. */
export async function writeDraft(value:EditDraft){const d=await db();return new Promise<void>((resolve,reject)=>{const tx=d.transaction('latest','readwrite');tx.objectStore('latest').put(value);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}
// Hold an exclusive editing lease until the modal closes, preventing competing tab saves.
export async function lockDraft(id:string,signal:AbortSignal):Promise<()=>void>{
  if(!navigator.locks)throw new Error('이 브라우저는 안전한 자동저장 잠금을 지원하지 않습니다. 최신 Chrome, Edge, Firefox 또는 Safari를 이용해 주세요.');
  return new Promise((resolve,reject)=>{
    void navigator.locks.request('hwp-grid-edit:'+id,{ifAvailable:true},async lock=>{
      if(!lock){reject(new Error('같은 원본의 편집 모드가 다른 창에 열려 있습니다. 그 편집을 종료한 후 다시 열어 주세요.'));return;}
      if(signal.aborted){reject(signal.reason);return;}
      await new Promise<void>(release=>{const unlock=()=>{signal.removeEventListener('abort',unlock);release();};signal.addEventListener('abort',unlock,{once:true});resolve(unlock);});
    }).catch(reject);
  });
}
