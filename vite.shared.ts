import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AliasOptions, UserConfig } from 'vite';

// The core, `@zumer/pulse`, is read live from a checkout beside this one when
// there is one (../pulse/src, the files its npm build is made from), so a
// change there shows here at once; otherwise the npm package is used, which is
// what a clone of this repo alone gets. The alias covers the two entries a
// project imports; the core's own imports of Orbit, Zumly and hls.js are
// deduped onto this repo's copies, so Orbit registers its elements once.
// tsconfig `paths` does the same for the types. Each Vite config is
// `defineConfig(withCore({ … }))`.
const here = fileURLToPath(new URL('.', import.meta.url));
const pulse = fileURLToPath(new URL('../pulse/', import.meta.url));
const live = existsSync(`${pulse}src/index.ts`);

const entries = (alias: AliasOptions | undefined) =>
  !alias ? [] : Array.isArray(alias) ? alias : Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));

export const withCore = (config: UserConfig): UserConfig => ({
  ...config,
  server: { ...config.server, fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), here, ...(live ? [pulse] : [])] } },
  resolve: {
    ...config.resolve,
    dedupe: [...(config.resolve?.dedupe ?? []), '@zumer/orbit', 'zumly', 'hls.js'],
    alias: [
      ...(live ? [
        // With its query too: the card takes the stylesheet as text (`?inline`), and without this it got the npm package's.
        { find: /^@zumer\/pulse\/style\.css(\?.*)?$/, replacement: `${pulse}src/style.css$1` },
        { find: /^@zumer\/pulse$/, replacement: `${pulse}src/index.ts` },
      ] : []),
      ...entries(config.resolve?.alias),
    ],
  },
});
