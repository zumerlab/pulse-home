import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

// The core (`@zumer/pulse`) comes in as a link to ../pulse/packages/core while
// it is not on npm. Vite then serves its files from where they really are,
// outside this repo, so that folder is allowed; and the core's own imports of
// Orbit, Zumly and hls.js must land on this repo's copies, not on the core
// repo's, or Orbit would register its elements twice. Once the core is a
// published version, both lines are harmless.
const here = fileURLToPath(new URL('.', import.meta.url));
const core = realpathSync(fileURLToPath(new URL('./node_modules/@zumer/pulse', import.meta.url)));

export const withCore = (config: UserConfig): UserConfig => ({
  ...config,
  server: { ...config.server, fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), here, core] } },
  resolve: { ...config.resolve, dedupe: [...(config.resolve?.dedupe ?? []), '@zumer/orbit', 'zumly', 'hls.js'] },
});
