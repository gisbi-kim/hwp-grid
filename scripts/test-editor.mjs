import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import init,{HwpDocument} from '@rhwp/core';
const code=ts.transpileModule(readFileSync(new URL('../lib/edit-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DocumentEditor}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
await init({module_or_path:readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm',import.meta.url))});
const original=HwpDocument.createEmpty();original.createBlankDocument();original.insertText(0,0,0,'Hello 한글 😀');
const bytes=original.exportHwpx();const doc=new HwpDocument(bytes),editor=new DocumentEditor(doc,bytes.length);
const pick=(offset,extend=false)=>{const r=JSON.parse(doc.getCursorRect(0,0,offset));return editor.command({kind:'pick',page:r.pageIndex,x:r.x,y:r.y+r.height/2,extend});};
pick(0);editor.command({kind:'key',key:'Home'});editor.command({kind:'insert',text:'복사본 '});
assert.equal(doc.getTextRange(0,0,0,100),'복사본 Hello 한글 😀');
assert.equal(original.getTextRange(0,0,0,100),'Hello 한글 😀','source remains unchanged');
editor.command({kind:'undo'});assert.equal(doc.getTextRange(0,0,0,100),'Hello 한글 😀');
editor.command({kind:'redo'});assert.equal(doc.getTextRange(0,0,0,100),'복사본 Hello 한글 😀');
editor.command({kind:'selectParagraph'});editor.command({kind:'format',style:{fontFamily:'Noto Sans KR',fontSize:18,textColor:'#cc2244'}});
const props=JSON.parse(doc.getCharPropertiesAt(0,0,0));assert.equal(props.fontFamily,'Noto Sans KR');assert.equal(props.fontSize,1800);assert.equal(props.textColor,'#cc2244');
editor.command({kind:'key',key:'End'});editor.command({kind:'key',key:'Backspace'});assert.ok(!doc.getTextRange(0,0,0,100).includes('😀'),'delete one Unicode character');
editor.command({kind:'insert',text:'한\n두'});assert.equal(doc.getParagraphCount(0),2);
editor.command({kind:'key',key:'Home'});editor.command({kind:'key',key:'Backspace'});assert.equal(doc.getParagraphCount(0),1,'backspace merges text paragraphs');
const reopened=new HwpDocument(doc.exportHwpx());assert.equal(JSON.parse(reopened.getCharPropertiesAt(0,0,0)).fontSize,1800);assert.ok(reopened.getTextFileText().includes('복사본'));
reopened.free();
const tableDoc=HwpDocument.createEmpty();tableDoc.createBlankDocument();const table=JSON.parse(tableDoc.createTable(0,0,0,2,2));tableDoc.insertTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,'표 내용');
const tableEditor=new DocumentEditor(tableDoc,10_000);const rect=JSON.parse(tableDoc.getCursorRectInCell(0,table.paraIdx,table.controlIdx,0,0,0));
tableEditor.command({kind:'pick',page:rect.pageIndex,x:rect.x,y:rect.y+rect.height/2});tableEditor.command({kind:'key',key:'Home'});tableEditor.command({kind:'insert',text:'수정 '});
assert.equal(tableDoc.getTextInCell(0,table.paraIdx,table.controlIdx,0,0,0,100),'수정 표 내용');
tableEditor.command({kind:'selectParagraph'});tableEditor.command({kind:'format',style:{fontSize:16,textColor:'#112233'}});
assert.equal(JSON.parse(tableDoc.getCellCharPropertiesAt(0,table.paraIdx,table.controlIdx,0,0,0)).fontSize,1600);
tableEditor.command({kind:'key',key:'End'});tableEditor.command({kind:'key',key:'Enter'});tableEditor.command({kind:'insert',text:'둘째 줄'});
assert.equal(tableDoc.getTextInCell(0,table.paraIdx,table.controlIdx,0,1,0,100),'둘째 줄');
tableEditor.command({kind:'key',key:'Home'});tableEditor.command({kind:'key',key:'Backspace'});assert.equal(tableDoc.getCellParagraphCount(0,table.paraIdx,table.controlIdx,0),1);
const hwpCopy=new HwpDocument(doc.exportHwp());assert.ok(hwpCopy.getTextFileText().includes('복사본'));hwpCopy.free();

// Character emphasis survives both formats.
pick(0);editor.command({kind:'selectParagraph'});editor.command({kind:'format',style:{bold:true,italic:true,underline:true}});
for(const data of [doc.exportHwpx(),doc.exportHwp()]){const d=new HwpDocument(data),props=JSON.parse(d.getCharPropertiesAt(0,0,0));assert.equal(props.bold,true);assert.equal(props.italic,true);assert.equal(props.underline,true);d.free();}
// Image insertion, all wrapping modes, resize and paper-relative move.
pick(0);const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64'));
editor.command({kind:'imageInsert',bytes:png,width:100,height:80,extension:'png',name:'test.png'});assert.equal(editor.state().object.type,'image');
for(const mode of ['inline','square','topBottom','front','behind']){editor.command({kind:'imageMode',mode});assert.equal(editor.state().object.mode,mode);}
editor.command({kind:'objectResize',width:200,height:120});assert.equal(editor.state().object.width,200);
editor.command({kind:'imageMove',x:250,y:350});assert.ok(Math.abs(editor.state().object.x-250)<1);assert.ok(Math.abs(editor.state().object.y-350)<1);
for(const data of [doc.exportHwpx(),doc.exportHwp()]){const d=new HwpDocument(data);const o=JSON.parse(d.getPageControlLayout(0)).controls.find(c=>c.type==='image');assert.ok(o);const props=JSON.parse(d.getPictureProperties(o.secIdx,o.paraIdx,o.controlIdx));assert.equal(props.width,15000);assert.equal(props.textWrap,'BehindText');d.free();}
// Each structural table action runs against a fresh 2x2 table, then roundtrips.
for(const operation of ['splitRows','splitCols','mergeRight','mergeDown','addRow','addCol','splitTable','mergeTable','resize']){
 const d=HwpDocument.createEmpty();d.createBlankDocument();const t=JSON.parse(d.createTable(0,0,0,2,2));d.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'keep');
 if(operation==='mergeTable')d.splitTable(0,t.paraIdx,t.controlIdx,1);
 const e=new DocumentEditor(d,1000),cell=operation==='splitTable'?2:0,r=JSON.parse(d.getCursorRectInCell(0,t.paraIdx,t.controlIdx,cell,0,0));e.command({kind:'pick',page:r.pageIndex,x:r.x,y:r.y+r.height/2});assert.equal(e.state().object.type,'table');
 const before=e.state().object;
 e.command(operation==='resize'?{kind:'objectResize',width:before.width*1.2,height:before.height*1.5}:{kind:'table',operation});
 const dims=JSON.parse(d.getTableDimensions(0,t.paraIdx,t.controlIdx));
 if(operation==='splitRows'||operation==='addRow')assert.equal(dims.rowCount,3);
 if(operation==='splitCols'||operation==='addCol')assert.equal(dims.colCount,3);
 if(operation==='mergeRight'||operation==='mergeDown')assert.equal(dims.cellCount,3);
 if(operation==='mergeTable')assert.equal(dims.rowCount,2);
 if(operation==='splitTable')assert.equal(JSON.parse(d.getPageControlLayout(0)).controls.filter(c=>c.type==='table').length,2);
 if(operation==='resize')assert.ok(Math.abs(e.state().object.width-before.width*1.2)<1);
 for(const data of [d.exportHwpx(),d.exportHwp()]){const reopened=new HwpDocument(data);assert.ok(reopened.getTextFileText().includes('keep'));assert.deepEqual(JSON.parse(reopened.getTableDimensions(0,t.paraIdx,t.controlIdx)),dims);reopened.free();}
 e.command({kind:'undo'});assert.ok(d.getTextFileText().includes('keep'));d.free();
}
tableDoc.free();doc.free();original.free();
console.log('PASS: emphasis, image placement/resize/move, table operations in both formats;  copy isolation, Unicode, undo/redo, font/size/color, multiline, HWPX roundtrip, table editing and newline');
