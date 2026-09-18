type Chunk={bytes:Uint8Array;refs:number};
type Checkpoint={id:number;time:number;keys:string[];length:number};
const gear=Array.from({length:256},(_,i)=>{let n=i+1;n^=n<<13;n^=n>>>17;n^=n<<5;return n>>>0;});
/** Session-only, content-defined chunks share unchanged binary data between snapshots. */
export class EditHistory {
  private chunks=new Map<string,Chunk>();
  private snapshots:Checkpoint[]=[];
  private nextId=1;
  constructor(private limit=60){}
  list(){return this.snapshots.map(({id,time})=>({id,time}));}
  get bytes(){return [...this.chunks.values()].reduce((sum,c)=>sum+c.bytes.length,0);}
  async add(bytes:Uint8Array,time=Date.now()){
    const keys:string[]=[],fresh=new Map<string,Uint8Array>();let start=0,hash=0;
    const chunk=async(end:number)=>{
      const slice=bytes.slice(start,end),digest=await crypto.subtle.digest('SHA-256',slice);
      const key=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      keys.push(key);if(!this.chunks.has(key))fresh.set(key,slice);start=end;hash=0;
    };
    for(let i=0;i<bytes.length;i++){
      hash=((hash<<1)+gear[bytes[i]])>>>0;
      if(i-start>=16_384&&((hash&0xffff)===0||i-start>=262_143))await chunk(i+1);
    }
    if(start<bytes.length)await chunk(bytes.length);
    if(JSON.stringify(keys)===JSON.stringify(this.snapshots.at(-1)?.keys))return false;
    for(const key of keys){const existing=this.chunks.get(key);if(existing)existing.refs++;else this.chunks.set(key,{bytes:fresh.get(key)!,refs:1});}
    this.snapshots.push({id:this.nextId++,time,keys,length:bytes.length});
    while(this.snapshots.length>this.limit)for(const key of this.snapshots.shift()!.keys){const item=this.chunks.get(key)!;if(--item.refs===0)this.chunks.delete(key);}
    return true;
  }
  restore(id:number){const snapshot=this.snapshots.find(s=>s.id===id);if(!snapshot)throw new Error('이력의 보관 기간이 지났습니다.');const result=new Uint8Array(snapshot.length);let offset=0;for(const key of snapshot.keys){const bytes=this.chunks.get(key)!.bytes;result.set(bytes,offset);offset+=bytes.length;}return result;}
}
