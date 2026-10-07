import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: 'es2022' }, server: { port: 5173, strictPort: true }, preview: { port: 4175, strictPort: true } });
