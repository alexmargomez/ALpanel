import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'fs';
import path from 'path';

// Durante la actualización en caliente dentro del contenedor (/app),
// limpiar archivos .ts obsoletos que `cp -rf` del contenedor anterior no eliminó.
const selfRepoSrc = path.resolve(
  process.env.PANEL_SELF_PATH || '/opt/alpanel',
  'src'
);
if (
  (path.resolve(process.cwd()) === '/app' ||
    path.resolve(__dirname) === '/app') &&
  fs.existsSync(selfRepoSrc)
) {
  try {
    fs.rmSync('/app/src', { recursive: true, force: true });
    fs.rmSync('/app/dist', { recursive: true, force: true });
    fs.cpSync(selfRepoSrc, '/app/src', { recursive: true });
  } catch {
    // Ignorar si no aplica en entorno local
  }
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend/src'),
    },
  },
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public/assets'),
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'frontend/src/main.ts'),
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'app.css';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
