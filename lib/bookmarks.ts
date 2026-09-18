export const BOOKMARK_EVENT='hwp-grid-bookmarks-changed';
// Metadata identifies a local file across reopening; file contents never leave the browser.
export const bookmarkKey=(file:File)=>`hwp-grid-bookmarks-v1:${JSON.stringify([file.name,file.size,file.lastModified])}`;
export function readBookmarks(key:string):number[]{
  try{const value:unknown=JSON.parse(localStorage.getItem(key)||'[]');
    return Array.isArray(value)?[...new Set(value.filter((n):n is number=>Number.isInteger(n)&&n>=0&&n<3000))].sort((a,b)=>a-b):[];
  }catch{return [];}
}
export function writeBookmarks(key:string,pages:number[]){
  if(pages.length)localStorage.setItem(key,JSON.stringify(pages));else localStorage.removeItem(key);
  window.dispatchEvent(new Event(BOOKMARK_EVENT));
}
