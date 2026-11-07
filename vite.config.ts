import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

// The browser talks to Home Assistant directly (its WebSocket accepts any
// origin), signed in with Home Assistant's own OAuth flow: no proxy and no
// server-side credentials. Two pages in the build: the app (index.html) and
// the index of demo homes (gallery.html). The card's bench (card.html) is a
// development page: the dev server serves it, the build leaves it out.
export default defineConfig(withCore({
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  // No hls.js in this build (see hls-none.ts): the cameras are stills and MJPEG.
  resolve: { alias: { 'hls.js': fileURLToPath(new URL('./hls-none.ts', import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)),
      },
    },
  },
}));
