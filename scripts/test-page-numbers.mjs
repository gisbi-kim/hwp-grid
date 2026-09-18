import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import ts from 'typescript';import init,{HwpDocument} from '@rhwp/core';await init({module_or_path:readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});const moduleUrl=(path)=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');let code=ts.transpileModule(readFileSync('lib/page-numbers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'@rhwp/core'",JSON.stringify(new URL('../node_modules/@rhwp/core/rhwp.js',import.meta.url).href)).replace("'./hwpx-rewrite'",JSON.stringify(moduleUrl('lib/hwpx-rewrite.ts')));const {pageNumberCopy}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const {DocumentEditor}=await import(moduleUrl('lib/edit-model.ts'));
const numbers=d=>Array.from({length:d.pageCount()},(_,i)=>[...d.renderPageSvg(i).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m=>m[1]).filter(x=>/^\d+$/.test(x)));
const d=HwpDocument.createEmpty();d.createBlankDocument();for(let i=0;i<4;i++){if(i)d.insertPageBreak(0,i-1,1);d.insertText(0,i,0,String.fromCharCode(65+i));}
d.createHeaderFooter(0,true,0);d.insertTextInHeaderFooter(0,true,0,0,0,'KEEP HEADER');d.createHeaderFooter(0,false,0);d.insertTextInHeaderFooter(0,false,0,0,0,'KEEP FOOTER');
const e=new DocumentEditor(d,10000);for(const [k,expected] of [[3,[[],[],['1'],['2']]],[1,[['1'],['2'],['3'],['4']]],[null,[[],[],[],[]]],[2,[[],['1'],['2'],['3']]]]){
 const before=numbers(e.document),v=await pageNumberCopy(e.document,k);e.replaceDocument(v);assert.deepEqual(numbers(e.document),expected);
 assert.ok(v.getHeaderFooter(0,true,0).includes('KEEP HEADER'));assert.ok(v.getHeaderFooter(0,false,0).includes('KEEP FOOTER'));
 for(const bytes of [v.exportHwp(),v.exportHwpx()]){const reopened=new HwpDocument(bytes);assert.deepEqual(numbers(reopened),expected);assert.ok(reopened.getHeaderFooter(0,false,0).includes('KEEP FOOTER'));reopened.free();}
 e.command({kind:'undo'});assert.deepEqual(numbers(e.document),before);e.command({kind:'redo'});assert.deepEqual(numbers(e.document),expected);
}
await assert.rejects(pageNumberCopy(e.document,0));await assert.rejects(pageNumberCopy(e.document,5));e.dispose();
const long=HwpDocument.createEmpty();long.createBlankDocument();long.insertText(0,0,0,'가나다라 마바사 '.repeat(1500));const numbered=await pageNumberCopy(long,3);assert.equal(numbered.pageCount(),long.pageCount());assert.deepEqual(numbers(numbered).slice(0,4),[[],[],['1'],['2']]);numbered.free();long.free();
console.log('PASS page numbering: centered native numbering, k start, removal/reapply, headers/footers preserved, undo/redo, both formats, long paragraph boundary, validation');
