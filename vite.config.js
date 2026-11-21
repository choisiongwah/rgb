import { defineConfig } from 'vite';
export default defineConfig({
 root:'client',
 server:{host:'0.0.0.0',port:5173,proxy:{'/api':'http://localhost:3000','/socket.io':{target:'http://localhost:3000',ws:true}}},
 build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:{host:'host/index.html',player:'player/index.html'}}}
});
