import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The public demo: both apps and the gallery as a folder of static files for
// a plain host with nothing behind it, zumerlab.com/pulse-home/ (GitHub Pages,
// .github/workflows/pages.yml) or any web server of your own.
// `npm run build:pages` → dist-pages/. Relative paths, so the folder can sit
// anywhere; no openHAB target and no proxy, so the openHAB app opens the house
// as recorded and reads an openHAB of yours by its address alone (CORS on
// there); the Home Assistant app signs in to yours or opens a demo home.
export default defineConfig(withCore({
  root: at('./src'),
  base: './',
  envDir: at('.'),
  define: { __OPENHAB_TARGET__: JSON.stringify(''), __OPENHAB_SAME_ORIGIN__: 'false' },
  // No hls.js here either (see src/hls-none.ts): the cameras are stills and MJPEG.
  resolve: { alias: { 'hls.js': at('./src/hls-none.ts') } },
  build: {
    outDir: at('./dist-pages'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: at('./src/index.html'),
        openhab: at('./src/openhab/index.html'),
        gallery: at('./src/gallery.html'),
      },
    },
  },
}));
