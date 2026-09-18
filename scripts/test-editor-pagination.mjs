import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import init,{HwpDocument} from '@rhwp/core';
const code=ts.transpileModule(readFileSync(new URL('../lib/edit-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;const {DocumentEditor}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));await init({module_or_path:readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
for(const changeSize of [false,true]){
 const d=HwpDocument.createEmpty();d.createBlankDocument();const e=new DocumentEditor(d,1000);e.command({kind:'newPage'});
 for(let line=0;line<12;line++){
  const before=e.state().caret;
  if(changeSize)e.command({kind:'format',style:{fontSize:line%2?18:12,bold:true,textColor:'#cc2244'}});
  for(const character of `줄${line}입력한글`){const state=e.command({kind:'insert',text:character});assert.equal(state.caret.pageIndex,1,`line ${line}: typing must stay on page 2`);assert.equal(state.pages.length,2);assert.ok(state.caret.y>=before.y-2);}
  if(changeSize){e.command({kind:'selectParagraph'});const state=e.command({kind:'format',style:{fontSize:16}});assert.equal(state.caret.pageIndex,1,'selection resize keeps paragraph on page');e.command({kind:'key',key:'End'});}
  const svg=d.renderPageSvg(1).replace(/<[^>]*>/g,'').replace(/\s/g,'');assert.ok(svg.includes(`줄${line}입력한글`),'text renders on the cursor page before Enter');
  const after=e.command({kind:'key',key:'Enter'});assert.equal(after.caret.pageIndex,1);assert.ok(after.caret.y>before.y);
 }
 for(const bytes of [d.exportHwp(),d.exportHwpx()]){const reopened=new HwpDocument(bytes);assert.equal(reopened.pageCount(),2);assert.ok(reopened.renderPageSvg(1).replace(/<[^>]*>/g,'').replace(/\s/g,'').includes('줄11입력한글'));reopened.free();}
 e.command({kind:'insert',text:'실행취소확인'});e.command({kind:'undo'});assert.equal(e.state().caret.pageIndex,1);e.command({kind:'redo'});assert.equal(e.state().caret.pageIndex,1);
 // Genuine page overflow is still allowed; the fix does not pin the caret to a page.
 e.command({kind:'insert',text:'자연스럽게 이어지는 긴 본문입니다. '.repeat(400)});assert.ok(e.state().pages.length>2);assert.ok(e.state().caret.pageIndex>1);d.free();
}
console.log('PASS: page-break typing, repeated Enter, pending/selected font size, rendered page, undo/redo, genuine overflow, HWP/HWPX roundtrip');
