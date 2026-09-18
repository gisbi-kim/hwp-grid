/** Rewrites selected entries in the engine's ordinary (non-ZIP64) HWPX ZIP. */
export async function rewriteHwpx(bytes:Uint8Array,change:(name:string,text:string)=>string):Promise<Uint8Array>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),encoder=new TextEncoder();
  let end=bytes.length-22;while(end>=Math.max(0,bytes.length-65557)&&view.getUint32(end,true)!==0x06054b50)end--;
  if(end<0||view.getUint32(end,true)!==0x06054b50)throw new Error('HWPX ZIP 끝을 읽지 못했습니다.');
  const count=view.getUint16(end+10,true);let cursor=view.getUint32(end+16,true),offset=0;
  const locals:Uint8Array[]=[],central:Uint8Array[]=[];
  for(let i=0;i<count;i++){
    if(view.getUint32(cursor,true)!==0x02014b50)throw new Error('HWPX ZIP 목록이 잘못되었습니다.');
    const size=view.getUint32(cursor+20,true),nameSize=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),at=view.getUint32(cursor+42,true);
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameSize)),method=view.getUint16(cursor+10,true);
    const start=at+30+view.getUint16(at+26,true)+view.getUint16(at+28,true);let payload=bytes.slice(start,start+size),rawSize=view.getUint32(cursor+24,true),crc=view.getUint32(cursor+16,true),compression=method;
    if(/^Contents\/section\d+\.xml$/.test(name)){
      const raw=method===0?payload:method===8?new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()):null;
      if(!raw)throw new Error('지원하지 않는 HWPX 압축입니다.');
      const text=decoder.decode(raw),updated=change(name,text);
      if(updated!==text){payload=encoder.encode(updated);compression=0;rawSize=payload.length;crc=crc32(payload);}
    }
    const nameBytes=bytes.slice(cursor+46,cursor+46+nameSize),local=new Uint8Array(30+nameSize),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(8,compression,true);lv.setUint32(14,crc,true);lv.setUint32(18,payload.length,true);lv.setUint32(22,rawSize,true);lv.setUint16(26,nameSize,true);local.set(nameBytes,30);
    const record=new Uint8Array(46+nameSize),cv=new DataView(record.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(10,compression,true);cv.setUint32(16,crc,true);cv.setUint32(20,payload.length,true);cv.setUint32(24,rawSize,true);cv.setUint16(28,nameSize,true);cv.setUint32(42,offset,true);record.set(nameBytes,46);
    locals.push(local,payload);central.push(record);offset+=local.length+payload.length;cursor+=46+nameSize+extra+comment;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0),tail=new Uint8Array(22),tv=new DataView(tail.buffer);tv.setUint32(0,0x06054b50,true);tv.setUint16(8,count,true);tv.setUint16(10,count,true);tv.setUint32(12,centralSize,true);tv.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+22);let p=0;for(const part of [...locals,...central,tail]){result.set(part,p);p+=part.length;}return result;
}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
