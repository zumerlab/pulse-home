import { defineConfig, type ProxyOptions } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The browser talks to Home Assistant directly (its WebSocket accepts any
// origin), signed in with Home Assistant's own OAuth flow: no proxy and no
// server-side credentials. `src/` is the root: three pages in the build, the
// Home Assistant app (index.html), the openHAB app (openhab/index.html) and
// the index of demo homes (gallery.html); the card's bench (card.html) is a
// development page the dev server serves and the build leaves out. `.env`
// files are read from the repository root.
//
// openHAB does not let a page from another origin read its REST API unless
// CORS is switched on, and the public demo house has it off: this server
// (dev and preview) asks it for the page at /oh/…, demo.openhab.org unless
// OPENHAB_URL names another. Served from openHAB itself (vite.openhab.config.ts)
// the app needs none of this.
const openhab = (process.env.OPENHAB_URL ?? 'https://demo.openhab.org').replace(/\/+$/, '');
const proxy: Record<string, ProxyOptions> = {
  '/oh': { target: openhab, changeOrigin: true, rewrite: (path: string) => path.slice('/oh'.length) },
};

export default defineConfig(withCore({
  root: at('./src'),
  envDir: at('.'),
  define: { __OPENHAB_TARGET__: JSON.stringify(openhab), __OPENHAB_SAME_ORIGIN__: 'false' },
  server: { host: '127.0.0.1', strictPort: true, proxy },
  preview: { host: '127.0.0.1', strictPort: true, proxy },
  // No hls.js in this build (see src/hls-none.ts): the cameras are stills and MJPEG.
  resolve: { alias: { 'hls.js': at('./src/hls-none.ts') } },
  build: {
    outDir: at('./dist'),
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
