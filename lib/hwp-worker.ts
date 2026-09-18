import init,{HwpDocument} from '@rhwp/core';
let doc:HwpDocument|null=null;
let memory:WebAssembly.Memory|null=null;
self.onmessage=async({data}:{data:{id:number;kind:'open'|'render';file?:File;url?:string;index?:number}})=>{
  try{
    let value:unknown;
    if(data.kind==='open'){
      const [wasm,buffer]=await Promise.all([init({module_or_path:data.url!}),data.file!.arrayBuffer()]);
      memory=wasm.memory;
      doc=new HwpDocument(new Uint8Array(buffer));
      const count=doc.pageCount();
      if(count<1||count>3000)throw new Error('페이지 수가 지원 범위를 벗어났어. (1–3,000쪽)');
      value=Array.from({length:count},(_,i)=>{
        const p=JSON.parse(doc!.getPageInfo(i));
        if(!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0)throw new Error('페이지 크기를 읽지 못했어.');
        return {width:p.width,height:p.height};
      });
    }else{
      if(!doc)throw new Error('문서가 닫혔어.');
      value=doc.renderPageSvg(data.index!);
    }
    self.postMessage({id:data.id,value,bytes:memory?.buffer.byteLength??0});
  }catch(error){self.postMessage({id:data.id,error:String(error instanceof Error?error.message:error),bytes:memory?.buffer.byteLength??0});}
};
