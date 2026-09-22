import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
// CFB's UMD export unnecessarily checks `require`, which is absent in web workers.
// Export its browser implementation as ESM before the bundler's CJS conversion.
const cfbBrowser=()=>({name:'cfb-browser-export',enforce:'pre' as const,transform(code:string,id:string){
 if(!/[/\\]cfb[/\\]cfb\.js$/.test(id))return;
 return code.replace(/if\(typeof require !== 'undefined' && typeof module !== 'undefined' && typeof DO_NOT_EXPORT_CFB === 'undefined'\) \{ module\.exports = CFB; \}/,'export default CFB;');
}});
export default defineConfig({base:'/hwp-grid/',plugins:[cfbBrowser(),react()],worker:{plugins:()=>[cfbBrowser()]},resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}}});
