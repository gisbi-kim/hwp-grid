import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'/hwp-grid/',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}}});
