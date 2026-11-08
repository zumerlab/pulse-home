// Set by the Vite configs: the server the dev server's /oh proxy points at
// (vite.config.ts), and whether this build is served by openHAB itself, from
// the same origin as its REST API (vite.openhab.config.ts).
declare const __OPENHAB_TARGET__: string;
declare const __OPENHAB_SAME_ORIGIN__: boolean;
