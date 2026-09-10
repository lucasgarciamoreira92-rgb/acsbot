import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  root: path.join(project, 'local'),
  publicDir: path.join(project, 'public'),
  envDir: path.join(project, 'local'),
  plugins: [react()],
  resolve: { alias: { '@': project } },
  css: { postcss: project },
  build: { outDir: path.join(project, '.acs-local/build/client'), emptyOutDir: true },
});
