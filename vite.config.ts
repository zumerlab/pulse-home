import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The browser talks to Home Assistant directly (its WebSocket accepts any
// origin), signed in with Home Assistant's own OAuth flow: no proxy and no
// server-side credentials. `src/` is the root: two pages in the build, the app
// (index.html) and the index of demo homes (gallery.html); the card's bench
// (card.html) is a development page the dev server serves and the build
// leaves out. `.env` files are read from the repository root.
export default defineConfig(withCore({
  root: at('./src'),
  envDir: at('.'),
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  // No hls.js in this build (see src/hls-none.ts): the cameras are stills and MJPEG.
  resolve: { alias: { 'hls.js': at('./src/hls-none.ts') } },
  build: {
    outDir: at('./dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: at('./src/index.html'),
        gallery: at('./src/gallery.html'),
      },
    },
  },
}));
