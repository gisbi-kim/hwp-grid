import CFB from 'cfb';
import {Inflate} from 'fflate';
export type RawMemo={section:number;index:number;text:string};
const signature=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
/** HWP5 MEMO_LIST lives after body paragraphs; core 0.8.6 does not import it. */
export async function readHwpMemos(bytes:Uint8Array):Promise<RawMemo[]>{
 if(!signature.every((v,i)=>bytes[i]===v))return [];
 const container=CFB.read(bytes,{type:'array'}),header=CFB.find(container,'FileHeader');
 if(!header||header.content.length<40)return [];
 const h=Uint8Array.from(header.content);
 if(new TextDecoder().decode(h.subarray(0,17))!=='HWP Document File')return [];
 const flags=new DataView(h.buffer).getUint32(36,true);
 // Encrypted/distribution streams must be handled by the engine, never guessed.
 if(flags&6)return [];
 const result:RawMemo[]=[];
 for(let i=0;i<container.FullPaths.length;i++){
  const match=/\/BodyText\/Section(\d+)$/.exec(container.FullPaths[i]);if(!match)continue;
  let data=Uint8Array.from(container.FileIndex[i].content);
  if(flags&1){
   const chunks:Uint8Array[]=[];let length=0;
   const inflater=new Inflate(chunk=>{length+=chunk.length;if(length>128*1024*1024)throw new Error('메모 구역의 압축 해제 크기가 너무 큽니다.');chunks.push(chunk);});
   for(let at=0;at<data.length;at+=4096)inflater.push(data.subarray(at,at+4096),at+4096>=data.length);
   data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  }
  result.push(...readMemoRecords(data,Number(match[1])));
 }return result;
}
export function readMemoRecords(data:Uint8Array,section:number):RawMemo[]{
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),result:RawMemo[]=[];
 let memo:RawMemo|undefined,parts:string[]=[];
 const finish=()=>{if(memo){memo.text=parts.join('\n');result.push(memo);}parts=[];};
 for(let offset=0;offset<data.length;){
  if(offset+4>data.length)throw new Error('HWP 메모 레코드가 잘렸습니다.');
  const header=view.getUint32(offset,true);offset+=4;let size=header>>>20;
  if(size===4095){if(offset+4>data.length)throw new Error('HWP 메모 길이가 잘렸습니다.');size=view.getUint32(offset,true);offset+=4;}
  if(size>data.length-offset)throw new Error('HWP 메모 레코드 길이가 잘못되었습니다.');
  const tag=header&1023;
  if(tag===93){finish();if(size<4)throw new Error('HWP 메모 번호가 없습니다.');memo={section,index:view.getUint32(offset,true),text:''};}
  else if(tag===67&&memo)parts.push(memoText(data.subarray(offset,offset+size)));
  offset+=size;
 }finish();return result;
}
function memoText(data:Uint8Array):string{
 if(data.length%2)throw new Error('HWP 메모 문자열 길이가 잘못되었습니다.');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),units:number[]=[];
 for(let i=0;i<data.length;){const c=view.getUint16(i,true);if(c===13)break;
  if(c===9){units.push(9);i+=16;}
  else if((c>=1&&c<=8)||(c>=11&&c<=12)||(c>=14&&c<=23))i+=16;
  else{if(c>=32||c===10)units.push(c);else if(c===24)units.push(0xad);else if(c===30)units.push(0xa0);else if(c===31)units.push(0x2007);i+=2;}
 }
 const out=new Uint8Array(units.length*2),v=new DataView(out.buffer);units.forEach((c,i)=>v.setUint16(i*2,c,true));return new TextDecoder('utf-16le').decode(out);
}

