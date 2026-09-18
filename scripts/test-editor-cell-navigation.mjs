import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import init,{HwpDocument} from '@rhwp/core';
const code=ts.transpileModule(readFileSync(new URL('../lib/edit-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;const {DocumentEditor}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));await init({module_or_path:readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
const d=HwpDocument.createEmpty();d.createBlankDocument();const e=new DocumentEditor(d,1000);e.command({kind:'tableInsert',rows:3,cols:3,width:450,height:180});const o=e.state().object;
const pick=(row,col)=>{const b=JSON.parse(d.getTableCellBboxes(o.secIdx,o.paraIdx,o.controlIdx)).find(c=>c.row===row&&c.col===col);const r=JSON.parse(d.getCursorRectInCell(o.secIdx,o.paraIdx,o.controlIdx,b.cellIdx,0,0));e.command({kind:'pick',page:r.pageIndex,x:r.x,y:r.y+r.height/2});};
const move=(key,row,col)=>{const s=e.command({kind:'key',key,ctrl:true});assert.equal(s.object.row,row);assert.equal(s.object.col,col);return s;};
const revision=e.state().revision,bytes=d.exportHwpx();
move('ArrowRight',0,1);move('ArrowDown',1,1);move('ArrowLeft',1,0);move('ArrowUp',0,0);move('ArrowLeft',0,0);move('ArrowUp',0,0);pick(2,2);move('ArrowRight',2,2);move('ArrowDown',2,2);assert.equal(e.state().revision,revision);assert.deepEqual(d.exportHwpx(),bytes,'navigation must not change document');
// Preserve the row/column lane when crossing a merged cell.
d.mergeTableCells(o.secIdx,o.paraIdx,o.controlIdx,0,1,1,1);pick(1,0);move('ArrowRight',0,1);move('ArrowRight',1,2);move('ArrowLeft',0,1);move('ArrowDown',2,1);
pick(0,0);e.command({kind:'insert',text:'abc'});const before=e.state();const plain=e.command({kind:'key',key:'ArrowLeft'});assert.equal(plain.object.cellIdx,before.object.cellIdx);assert.ok(plain.caret.x<before.caret.x,'plain arrow still moves within text');
move('ArrowDown',1,0);e.command({kind:'insert',text:'target'});const cell=e.state().object.cellIdx;assert.equal(d.getTextInCell(o.secIdx,o.paraIdx,o.controlIdx,cell,0,0,100),'target');
// Navigation clears an existing cell selection.
pick(0,0);const r=JSON.parse(d.getCursorRectInCell(o.secIdx,o.paraIdx,o.controlIdx,cell,0,0));e.command({kind:'pick',page:r.pageIndex,x:r.x,y:r.y+r.height/2,extend:true});assert.ok(e.state().selection.length);assert.equal(move('ArrowDown',2,0).selection.length,0);
d.free();console.log('PASS: Ctrl-arrow four directions, table edges, merged-cell lane, no document changes, normal arrows and target-cell input');
