import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(projectRoot, 'client');

export default defineConfig({
  root: clientRoot,
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true }
    }
  },
  build: {
    outDir: path.join(projectRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        host: path.join(clientRoot, 'host/index.html'),
        player: path.join(clientRoot, 'player/index.html')
      }
    }
  }
});
