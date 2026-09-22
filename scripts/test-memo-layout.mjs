import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {memoCards,MEMO_GUTTER}=await load('lib/memo-layout.ts');
const {gridLayout}=await load('lib/grid-layout.ts');
const memos=[{id:'b',page:0,text:'한글'.repeat(300),anchor:{y:790}},{id:'a',page:0,text:'짧은 메모',anchor:{y:789}},{id:'c',page:1,text:'다른 쪽',anchor:{y:50}}];
for(const zoom of [.2,1,3,8])for(const cols of [1,2,4]){
 const pages=Array.from({length:6},()=>({width:600,height:800}));
 const notes={gutter:MEMO_GUTTER,bottom:(i,s)=>Math.max(0,...memoCards(memos,i,s).map(c=>c.top+c.height+12))};
 const layout=gridLayout(pages,cols,1200,zoom,notes),cards=memoCards(memos,0,layout.scale);
 assert.equal(cards.length,2);assert.equal(cards[0].memo.id,'a');assert.ok(cards[1].top>=cards[0].top+cards[0].height+12);
 if(cols>1)assert.ok(layout.items[1].left>=layout.items[0].left+layout.items[0].width+MEMO_GUTTER);
 assert.ok(layout.items[cols].top>=layout.items[0].top+cards[1].top+cards[1].height);
 assert.ok(cards[1].height<=220);
}
assert.deepEqual(memoCards(memos,4,1),[]);
console.log('PASS page memo ordering, bounded long cards, collision avoidance, gutters, row spacing and zoom');
