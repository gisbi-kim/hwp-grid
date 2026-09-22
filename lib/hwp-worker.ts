import {readHwpMemos} from './hwp-memo-records';
import {pageNumberCopy} from './page-numbers';
import init,{HwpDocument} from '@rhwp/core';
import {DocumentEditor,type EditCommand} from './edit-model';
import {EditHistory} from './edit-history';
let doc:HwpDocument|null=null;
let memory:WebAssembly.Memory|null=null;
let originalFile:File|undefined;
let source:Uint8Array|null=null;
let editor:DocumentEditor|null=null;
let copyPassword:string|undefined;
let history=new EditHistory(),checkpointRevision=-1,copyFormat:'hwp'|'hwpx'='hwpx',fileBytes=0;
let messages=Promise.resolve();
type Message={id:number;kind:'open'|'render'|'edit'|'editState'|'exportCopy'|'selectedText'|'clipboard'|'checkpoint'|'restoreCheckpoint'|'memoSource'|'memoPages'|'rawMemos';anchors?:{section:number;paragraph:number}[];file?:File;url?:string;index?:number;password?:string;editable?:boolean;forceObject?:boolean;command?:EditCommand;format?:'hwp'|'hwpx'};
self.onmessage=({data}:{data:Message})=>{messages=messages.catch(()=>{}).then(()=>handle(data));};
const state=()=>({...editor!.state(),checkpoints:history.list()});
async function handle(data:Message){
  try{
    let value:unknown;
    if(data.kind==='open'){
      originalFile=data.file;
      const [wasm,buffer]=await Promise.all([init({module_or_path:data.url!}),source?Promise.resolve(source):data.file!.arrayBuffer().then(b=>new Uint8Array(b))]);
      memory=wasm.memory;
      source=buffer;
      doc=data.password===undefined?new HwpDocument(source):HwpDocument.openWithPassword(source,data.password);
      editor=data.editable?new DocumentEditor(doc,data.file!.size):null;
      copyPassword=data.editable?data.password:undefined;
      fileBytes=data.file!.size;copyFormat=/\.hwpx$/i.test(data.file!.name)?'hwpx':'hwp';
      history=new EditHistory();checkpointRevision=-1;
      source=null;
      delete data.password;
      const count=doc.pageCount();
      if(count<1||count>3000)throw new Error('페이지 수가 지원 범위를 벗어났습니다. (1–3,000쪽)');
      value=Array.from({length:count},(_,i)=>{
        const p=JSON.parse(doc!.getPageInfo(i));
        if(!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0)throw new Error('페이지 크기를 읽지 못했습니다.');
        return {width:p.width,height:p.height};
      });
    }else{
      if(!doc)throw new Error('문서가 닫혔습니다.');
      if(data.kind==='render')value=doc.renderPageSvg(data.index!);
      else if(data.kind==='rawMemos')value=originalFile?await readHwpMemos(new Uint8Array(await originalFile.arrayBuffer())):[];
      else if(data.kind==='memoSource')value=doc.exportHwpx();
      else if(data.kind==='memoPages')value=(data.anchors||[]).map(a=>{try{const p=JSON.parse(doc!.getPageOfPosition(a.section,a.paragraph));return p.ok?p.page:null;}catch{return null;}});
      else {
        if(!editor)throw new Error('읽기 전용 문서는 편집할 수 없습니다.');
        if(data.kind==='edit'){if(data.command?.kind==='pageNumbers')editor.replaceDocument(await pageNumberCopy(doc,data.command.startPage));else editor.command(data.command!);doc=editor.document;value=state();}
        else if(data.kind==='editState')value=state();
        else if(data.kind==='clipboard')value=editor.clipboard(data.forceObject);
        else if(data.kind==='selectedText')value=editor.selectedText();
        else if(data.kind==='checkpoint'){
          const revision=editor.state().revision;
          if(revision!==checkpointRevision){await history.add(copyFormat==='hwp'?doc.exportHwp():doc.exportHwpx());checkpointRevision=revision;}
          value=state();
        }else if(data.kind==='restoreCheckpoint'){
          const revision=editor.state().revision,target=history.restore(data.index!);
          if(revision!==checkpointRevision)await history.add(copyFormat==='hwp'?doc.exportHwp():doc.exportHwpx());
          const restored=new HwpDocument(target);
          editor.dispose();doc=restored;editor=new DocumentEditor(doc,fileBytes,revision+1);value=state();
        }
        else value=data.format==='hwp'?(copyPassword===undefined?doc.exportHwp():doc.exportHwpWithPassword(copyPassword)):(copyPassword===undefined?doc.exportHwpx():doc.exportHwpxWithPassword(copyPassword));
      }
    }
    self.postMessage({id:data.id,value,bytes:memory?.buffer.byteLength??0},{transfer:value instanceof Uint8Array?[value.buffer as ArrayBuffer]:[]});
  }catch(error){self.postMessage({id:data.id,error:String(error instanceof Error?error.message:error),bytes:memory?.buffer.byteLength??0});}
}
