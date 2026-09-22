import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import init,{HwpDocument} from '@rhwp/core';
const moduleUrl=path=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const code=ts.transpileModule(fs.readFileSync('lib/saved-pagination.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./hwpx-rewrite'",JSON.stringify(moduleUrl('lib/hwpx-rewrite.ts')));
const {savedPageBreaks,restoreSavedPagination}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const line=(y,pos=0,flags=393216)=>`<hp:lineseg textpos="${pos}" vertpos="${y}" vertsize="1200" horzsize="42000" flags="${flags}"/>`;
const para=body=>`<hp:p><hp:run><hp:t>text</hp:t></hp:run><hp:linesegarray>${body}</hp:linesegarray></hp:p>`;
assert.deepEqual(savedPageBreaks(para(line(65000))+para(line(0)),0),[{section:0,paragraph:1,position:0}]);
assert.deepEqual(savedPageBreaks(para(line(65000)+line(0,42)),1),[{section:1,paragraph:0,position:42}]);
assert.deepEqual(savedPageBreaks(para(line(0))+para(line(1500)),0),[]);
assert.deepEqual(savedPageBreaks(para(line(65000))+para(line(0,0,0)),0),[]);
assert.deepEqual(savedPageBreaks('<hp:colPr colCount="2"/>'+para(line(65000))+para(line(0)),0),[]);
assert.deepEqual(savedPageBreaks('<hp:p><hp:run><hp:tbl>'+para(line(65000))+para(line(0))+'</hp:tbl></hp:run>'+line(2000)+'</hp:p>'+para(line(3500)),0),[]);
await init({module_or_path:fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const empty=HwpDocument.createEmpty();empty.createBlankDocument();assert.equal(await restoreSavedPagination(empty),0);empty.free();
// User documents stay local: opt-in fixture path, never added to the repository.
if(process.env.HWP_PAGINATION_FIXTURE){
 const bytes=fs.readFileSync(process.env.HWP_PAGINATION_FIXTURE);const d=new HwpDocument(bytes);
 const text=JSON.parse(d.getTextFileText()).replace(/\s/g,'');
 const stats=()=>{let bodyOverflow=0,cellOverflow=0;for(let i=0;i<d.pageCount();i++){const info=JSON.parse(d.getPageInfo(i));for(const r of JSON.parse(d.getPageTextLayout(i)).runs){if(r.text.trim()&&r.y+r.h>info.height-info.marginBottom+1){if(r.parentParaIdx!==undefined)cellOverflow++;else bodyOverflow++;}}}return {pages:d.pageCount(),bodyOverflow,cellOverflow};};
 const before=stats(),restored=await restoreSavedPagination(d);
 const after=stats();
 assert.equal(JSON.parse(d.getTextFileText()).replace(/\s/g,''),text,'render-only corrections retain all text');
 assert.ok(restored>0);assert.ok(after.bodyOverflow<before.bodyOverflow,'body overflow must decrease');
 console.log(JSON.stringify({before,restored,after}));d.free();
}
console.log('PASS saved page resets, inside-paragraph reset, nested cell exclusion, multicolumn exclusion, synthetic lines, empty document');
