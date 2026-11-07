import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The card and the dashboard strategy as one JavaScript module for Home
// Assistant (a dashboard resource): Orbit, Zumly, the core and this app's
// styles inside. `npm run build:card` → dist-card/zumer-pulse.js.
export default defineConfig(withCore({
  root: at('./src'),
  envDir: at('.'),
  // No hls.js in the card (see src/hls-none.ts): Home Assistant's cameras are stills and MJPEG.
  resolve: { alias: { 'hls.js': at('./src/hls-none.ts') } },
  build: {
    outDir: at('./dist-card'),
    emptyOutDir: true,
    lib: {
      entry: at('./src/card/zumer-pulse.ts'),
      formats: ['es'],
      fileName: () => 'zumer-pulse.js',
    },
    rollupOptions: { output: { codeSplitting: false } },
    cssCodeSplit: false,
    target: 'es2022',
  },
}));
