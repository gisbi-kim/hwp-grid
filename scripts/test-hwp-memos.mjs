import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import ts from 'typescript';
import * as CFB from 'cfb';
const code=ts.transpileModule(fs.readFileSync('lib/hwp-memo-records.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'cfb'",JSON.stringify(pathToFileURL(process.cwd()+'/node_modules/cfb/cfb.js').href)).replace("'fflate'",JSON.stringify(pathToFileURL(process.cwd()+'/node_modules/fflate/esm/browser.js').href));
const {readHwpMemos,readMemoRecords}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function record(tag,body,extended=false){const h=Buffer.alloc(extended?8:4);h.writeUInt32LE((tag|((extended?4095:body.length)<<20))>>>0);if(extended)h.writeUInt32LE(body.length,4);return Buffer.concat([h,body]);}
const number=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const memo=(n,text)=>Buffer.concat([record(93,number(n)),record(67,Buffer.from(text+'\r','utf16le'),true)]);
const data=Buffer.concat([record(67,Buffer.from('본문','utf16le')),memo(1,'한글 😀 <script>'),memo(5,'둘째\n줄')]);
assert.deepEqual(readMemoRecords(data,2),[{section:2,index:1,text:'한글 😀 <script>'},{section:2,index:5,text:'둘째\n줄'}]);
const tab=Buffer.alloc(16);tab.writeUInt16LE(9);tab.writeUInt16LE(9,14);
assert.equal(readMemoRecords(Buffer.concat([record(93,number(2)),record(67,Buffer.concat([Buffer.from('A','utf16le'),tab,Buffer.from('B\r','utf16le')]))]),0)[0].text,'A\tB');
assert.throws(()=>readMemoRecords(data.subarray(0,data.length-1),0));
assert.throws(()=>readMemoRecords(Buffer.from([1,2,3]),0));
assert.deepEqual(await readHwpMemos(Buffer.from('PK\x03\x04')),[]);
function file(flags){const c=CFB.utils.cfb_new();const h=Buffer.alloc(256);h.write('HWP Document File');h.writeUInt32LE(flags,36);CFB.utils.cfb_add(c,'FileHeader',h);CFB.utils.cfb_add(c,'BodyText/Section2',flags&1?deflateRawSync(data):data);return CFB.write(c,{type:'buffer'});}
for(const flags of [0,1])assert.deepEqual(await readHwpMemos(file(flags)),readMemoRecords(data,2));
for(const flags of [2,3,4,5])assert.deepEqual(await readHwpMemos(file(flags)),[]);
if(process.env.HWP_MEMO_FIXTURE){const memos=await readHwpMemos(fs.readFileSync(process.env.HWP_MEMO_FIXTURE));assert.equal(memos.length,4);assert.ok(memos.every(m=>m.text.length>0));console.log('PASS local recovered fixture: four nonempty memo bodies');}
console.log('PASS HWP memo records: compressed/uncompressed, IDs, UTF-16, tabs, malformed lengths, encryption/distribution guards');
