import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import 'fake-indexeddb/auto';
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {EditHistory}=await load('edit-history');
const h=new EditHistory();const bytes=new Uint8Array(2*1024*1024);let seed=123;for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;bytes[i]=seed>>>24;}
await h.add(bytes,1);assert.equal(await h.add(bytes,2),false);assert.equal(h.list().length,1);
const changed=bytes.slice();changed[900000]^=1;await h.add(changed,3);assert.deepEqual(h.restore(1),bytes);assert.deepEqual(h.restore(2),changed);assert.ok(h.bytes<bytes.length*1.3,'unchanged chunks shared');
for(let i=0;i<65;i++){changed[i]=i;await h.add(changed,i+4);}assert.equal(h.list().length,60);assert.throws(()=>h.restore(1));assert.deepEqual(h.restore(h.list().at(-1).id),changed);
const {draftId,readDraft,writeDraft}=await load('edit-drafts');
const file=new File(['original'],'test.hwpx');const id=await draftId(file);assert.equal(id,await draftId(new File(['original'],'renamed.hwpx')));
for(let revision=0;revision<5;revision++)await writeDraft({id,name:file.name,blob:new Blob(['version '+revision]),savedAt:revision,revision,sessionId:'test'});
assert.equal(await (await readDraft(id)).blob.text(),'version 4');
const db=await new Promise(resolve=>{const r=indexedDB.open('hwp-grid-edit-drafts',1);r.onsuccess=()=>resolve(r.result);});
assert.equal(await new Promise(resolve=>{const r=db.transaction('latest').objectStore('latest').count();r.onsuccess=()=>resolve(r.result);}),1);
await new Promise(resolve=>{const tx=db.transaction('latest','readwrite');tx.objectStore('latest').put({id,blob:new Blob(['broken'])});tx.onabort=resolve;tx.abort();});assert.equal(await (await readDraft(id)).blob.text(),'version 4');db.close();
console.log('PASS: history deduplication, unchanged skip, 60 cap and restore; latest draft overwrite, identity and atomic abort');
