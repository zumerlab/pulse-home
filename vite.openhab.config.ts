import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withCore } from './vite.shared.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Pulse for openHAB as a folder of static files that openHAB itself serves:
// `npm run build:openhab` → dist-openhab/, copied into openHAB's `conf/html/pulse/`
// and opened at `/static/pulse/`. Same origin as the REST API, so no CORS and
// no proxy; relative paths, so the folder can sit anywhere.
// `npm run pack:openhab` zips it for a release.
export default defineConfig(withCore({
  root: at('./src/openhab'),
  base: './',
  envDir: at('.'),
  define: { __OPENHAB_TARGET__: JSON.stringify(''), __OPENHAB_SAME_ORIGIN__: 'true' },
  // No hls.js here either (see src/hls-none.ts): openHAB's pictures are stills.
  resolve: { alias: { 'hls.js': at('./src/hls-none.ts') } },
  build: {
    outDir: at('./dist-openhab'),
    emptyOutDir: true,
    target: 'es2022',
  },
}));
