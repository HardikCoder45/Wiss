import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(process.cwd(), 'src/main/index.ts'),
          'whisper-worker': resolve(process.cwd(), 'src/main/whisper-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    publicDir: resolve(process.cwd(), 'public'),
    build: {
      sourcemap: true,
    },
  },
});
