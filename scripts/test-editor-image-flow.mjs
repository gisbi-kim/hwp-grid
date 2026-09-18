import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import init,{HwpDocument} from '@rhwp/core';
const code=ts.transpileModule(readFileSync('lib/edit-model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DocumentEditor}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
await init({module_or_path:readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm')});
const image=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64'));
const controls=d=>Array.from({length:d.pageCount()},(_,page)=>JSON.parse(d.getPageControlLayout(page)).controls.map(c=>({...c,page}))).flat();
for(const destination of ['text','tableBefore','tableAfter','page']){
 const d=HwpDocument.createEmpty();d.createBlankDocument();d.insertText(0,0,0,'START');d.insertParagraph(0,1);d.insertText(0,1,0,'abcdef');d.insertParagraph(0,2);const t=JSON.parse(d.createTable(0,2,0,2,2));d.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'KEEP TABLE');
 const e=new DocumentEditor(d,1000);let r=JSON.parse(d.getCursorRect(0,0,0));e.command({kind:'pick',page:r.pageIndex,x:r.x,y:r.y+r.height/2});e.command({kind:'imageInsert',bytes:image,width:80,height:60,extension:'png',name:'keep image'});
 let target;if(destination==='text'){r=JSON.parse(d.getCursorRect(0,1,3));target={page:r.pageIndex,x:r.x,y:r.y+r.height/2};}
 else if(destination==='page'){e.command({kind:'newPage'});r=e.state().caret;target={page:r.pageIndex,x:r.x,y:r.y+r.height/2};const im=controls(d).find(c=>c.type==='image');e.command({kind:'pick',page:im.page,x:im.x+im.w/2,y:im.y+im.h/2});}
 else{const table=controls(d).find(c=>c.type==='table');target={page:table.page,x:table.x+20,y:table.y+table.h*(destination==='tableBefore'?.1:.9)};}
 e.command({kind:'imageMove',x:target.x,y:target.y,drop:target});const o=e.state().object;assert.equal(o.mode,'inline');assert.equal(controls(d).filter(c=>c.type==='image').length,1);assert.ok(d.getTextFileText().includes('KEEP TABLE'));assert.equal(controls(d).filter(c=>c.type==='table').length,1);
 if(destination==='text'){assert.match(d.getTextFileText(),/abc[\s\\rn"]*def/);}
 if(destination.startsWith('table')){const table=controls(d).find(c=>c.type==='table');assert.ok(destination==='tableBefore'?o.pageIndex<table.page||o.y+o.h<=table.y+1:o.pageIndex>table.page||o.y>=table.y+table.h-1,'inline image does not overlap table');}
 for(const bytes of [d.exportHwp(),d.exportHwpx()]){const reopened=new HwpDocument(bytes),im=controls(reopened).find(c=>c.type==='image');assert.equal(JSON.parse(reopened.getPictureProperties(im.secIdx,im.paraIdx,im.controlIdx)).treatAsChar,true);assert.deepEqual(reopened.getControlImageData(im.secIdx,im.paraIdx,'[]',im.controlIdx),image);reopened.free();}
 const clip=e.clipboard(true);assert.ok(clip.html.includes('img'));const rev=e.state().revision;assert.throws(()=>e.command({kind:'cutImage',...o,revision:rev-1}));e.command({kind:'cutImage',...o,revision:rev});assert.equal(controls(d).filter(c=>c.type==='image').length,0);e.command({kind:'paste',html:clip.html,internal:true});assert.equal(controls(d).filter(c=>c.type==='image').length,1);e.command({kind:'undo'});assert.equal(controls(d).filter(c=>c.type==='image').length,0);e.command({kind:'undo'});assert.equal(controls(d).filter(c=>c.type==='image').length,1);d.free();
 console.log('PASS inline relocation + cut/paste:',destination);
}

