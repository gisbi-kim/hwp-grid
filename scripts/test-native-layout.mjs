import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import init,{HwpDocument} from '@rhwp/core';
const code=ts.transpileModule(fs.readFileSync('lib/hwpx-rewrite.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {rewriteHwpx}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
await init({module_or_path:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const d=HwpDocument.createEmpty();d.createBlankDocument();
assert.equal(JSON.parse(d.createTable(0,0,0,6,2)).ok,true);
assert.equal(JSON.parse(d.mergeTableCells(0,0,2,0,0,2,0)).ok,true);
assert.equal(JSON.parse(d.mergeTableCells(0,0,2,3,0,5,0)).ok,true);
let fixture=await rewriteHwpx(d.exportHwpx(),(_name,xml)=>xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/,table=>{
 table=table.replace(/<hp:sz\b[^>]*>/,tag=>tag.replace(/height="\d+"/,'height="3600"'));
 table=table.replace(/<hp:pos\b[^>]*>/,tag=>tag.replace(/treatAsChar="\d+"/,'treatAsChar="1"'));
 return table.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g,cell=>{
  const span=Number(/rowSpan="(\d+)"/.exec(cell)[1]);
  return cell.replace(/<hp:cellSz\b[^>]*>/,tag=>tag.replace(/height="\d+"/,`height="${span*600}"`));
 });
}));d.free();
for(const format of ['hwpx','hwp']){
 let test=new HwpDocument(fixture);
 if(format==='hwp'){const bytes=test.exportHwp();test.free();test=new HwpDocument(bytes);}
 const table=JSON.parse(test.getPageControlLayout(0)).controls.find(c=>c.type==='table');
 assert.ok(table,'micro-grid is rendered');
 assert.ok(Math.abs(table.h-48)<1,`${format}: six 600-HU rows must occupy 48px, got ${table.h}`);
 assert.equal(test.pageCount(),1);test.free();
}
// A user's private document is opt-in and is never stored in the repository.
if(process.env.HWP_NATIVE_LAYOUT_FIXTURE){
 const doc=new HwpDocument(fs.readFileSync(process.env.HWP_NATIVE_LAYOUT_FIXTURE));
 let bodyOverflow=0;
 for(let i=0;i<doc.pageCount();i++){
  const info=JSON.parse(doc.getPageInfo(i));
  const runs=JSON.parse(doc.getPageTextLayout(i)).runs;
  bodyOverflow+=runs.filter(r=>r.parentParaIdx===undefined&&r.text.trim()&&r.y+r.h>info.height-info.marginBottom+1).length;
 }
 assert.equal(bodyOverflow,0,'saved body boundaries must keep text inside the page');
 console.log('Local fixture pages:',doc.pageCount());doc.free();
}
console.log('PASS coherent subdivided row geometry in HWP/HWPX');

