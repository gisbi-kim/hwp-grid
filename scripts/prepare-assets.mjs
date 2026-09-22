import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync,existsSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
const root=resolve('.');const require=createRequire(join(root,'package.json'));const manifest=JSON.parse(readFileSync('package.json','utf8'));
mkdirSync('public/engine',{recursive:true});mkdirSync('public/licenses',{recursive:true});
function packageDir(name,parent=root){
  let dir=realpathSync(parent);
  for(;;){const candidate=join(dir,'node_modules',name,'package.json');if(existsSync(candidate))return dirname(realpathSync(candidate));const next=dirname(dir);if(next===dir)break;dir=next;}
  let entry=createRequire(join(parent,'package.json')).resolve(name);let dir2=dirname(entry);
  for(;;){const p=join(dir2,'package.json');if(existsSync(p)&&JSON.parse(readFileSync(p,'utf8')).name===name)return dir2;const next=dirname(dir2);if(next===dir2)throw new Error(`Cannot resolve package ${name}`);dir2=next;}
}
const core=packageDir('@rhwp/core');copyFileSync(join(core,'rhwp_bg.wasm'),'public/engine/rhwp-0.8.6-native-layout-1.wasm');
const seen=new Set();const sections=[];const missing=[];
function collect(name,parent=root){
 const dir=packageDir(name,parent),pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8')),key=`${pkg.name}@${pkg.version}`;
 if(seen.has(key))return;seen.add(key);
 const files=readdirSync(dir).filter(n=>/^(licen[sc]e|copying|notice)(\.|$|-)/i.test(n));
 const notices=files.map(n=>({name:n,text:readFileSync(join(dir,n),'utf8')}));
 if(!notices.length && pkg.name==='react-remove-scroll-bar')notices.push({name:'LICENSE (upstream repository)',text:readFileSync('legal/react-remove-scroll-bar-LICENSE','utf8')});
 if(!notices.length)missing.push(key);
 sections.push(`\n${'='.repeat(72)}\n${key}\nDeclared license: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}\n`+notices.map(n=>`\n--- ${n.name} ---\n${n.text}`).join('\n'));
 for(const dep of Object.keys(pkg.dependencies||{}))collect(dep,dir);
}
for(const dep of Object.keys(manifest.dependencies))collect(dep);
const header='HWP Grid third-party notices\nDOMPurify is used under its Apache-2.0 option.\nFont files retain their SIL OFL-1.1 licenses.\nIndividual components retain their own licenses.\n';
writeFileSync('public/THIRD_PARTY_NOTICES.txt',header+sections.join('\n')+'\n\n'+readFileSync('vendor/shadcn-tailwind-4.13.0.LICENSE.md','utf8'));
copyFileSync(join(core,'LICENSE'),'public/licenses/RHWP-LICENSE.txt');
copyFileSync('legal/RHWP-THIRD-PARTY-LICENSES.md','public/licenses/RHWP-THIRD-PARTY-LICENSES.md');
copyFileSync('LICENSE','public/licenses/HWP-GRID-LICENSE.txt');
copyFileSync('legal/NOTICE.md','public/licenses/NOTICE.md');
if(missing.length)throw new Error('Missing license notices; review before publishing: '+missing.join(', '));
console.log(`Prepared engine and notices for ${seen.size} runtime packages.`);
