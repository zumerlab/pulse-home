import { t as core } from '@zumer/pulse';

// The Home Assistant app's own strings, on top of the object's: the board's
// words where Home Assistant has its own (entities, areas, rooms), and the
// shell's (sign-in, the demo homes, the gallery).
export const t = {
  ...core,
  connecting: 'Connecting to your home…',
  status: { 'signed-out': 'signed out', connecting: 'connecting', live: 'live', offline: 'offline, retrying', error: 'error' } as Record<string, string>,
  modes: { grid: 'Grid', orbit: 'Orbit', layers: 'Layers', list: 'List' },
  nAlerts: (n: number) => `${n} ${n === 1 ? 'alert' : 'alerts'}`,
  things: 'Entities in Home Assistant',
  assist: 'Assist',
  notice: 'Notice',
  backyardCamera: 'Backyard camera',
  hostError: (message: string) => `Home Assistant: ${message}`,
  signOut: 'Sign out',

  // The gear: what this screen shows
  contentLead: 'What the board shows: which systems, where in the home, and what each one follows.',
  tuneLabels: {
    orbit: 'Size of the orbit', tile: 'Thickness of each system\'s ring', align: 'Systems pulled inward', hub: 'Size of the center',
    orbitStep: 'Depth of the systems behind',
    layerGrow: 'Growth from layer to layer', layerEase: 'Spacing: tight behind or tight in front', layerStroke: 'Stroke of the layers behind',
    layerBlur: 'Blur of the layers behind', layerStep: 'Depth between layers', layerZoom: 'Size of the object', layerOpacity: 'Opacity of the layers behind',
    timeGap: 'Gap between the segments and the news', timeSplit: 'Height of the line across the face', timePointer: 'Pointer toward each system',
    timeBar: 'Tallest bar of a calm day',
  } as Record<string, string>,
  axes: { systems: 'Systems', groups: 'Rooms' } as Record<string, string>,
  axisHint: 'By system, the board is lights, climate, security… By room, each area of the home is one object, with what calls the most in front.',
  noGroup: 'No area',
  groupsField: 'Areas',
  groupsHint: 'Only what is in the ticked areas; an entity with no area stays out.',
  noFloor: 'No floor',
  channelsHint: 'What each system shows, and the entity a channel follows when there is more than one.',
  pickFor: (channel: string) => `Entity for ${channel}`,
  monthField: 'Energy month',
  openChanges: (h: number) => `Open the changes of the last ${h} hours`,
  changesIn24h: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} in 24 h`,

  // Sign in
  loginLead: 'Your home, as one object per system. Sign in with your Home Assistant account to begin.',
  yourHA: 'Your Home Assistant',
  signIn: 'Sign in with Home Assistant',
  tokenInstead: 'Use a long-lived access token instead',
  tokenLabel: 'Long-lived access token',
  tokenHint: 'For wall panels and kiosks. Create one in Home Assistant under your profile › Security.',
  connect: 'Connect',
  errCannotConnect: 'Could not reach Home Assistant at that address.',
  errInvalidAuth: 'Home Assistant did not accept the credentials. Sign in again.',
  errHostRequired: 'Enter the address of your Home Assistant.',
  errHttpsToHttp: 'A page served over HTTPS cannot sign in to a Home Assistant over HTTP.',
  errAuthCallback: 'The sign-in did not complete. Try again.',
  errNoConnection: 'No connection to Home Assistant.',

  // Demo homes (the ones of demo.home-assistant.io, no Home Assistant needed)
  demo: 'demo',
  demoLead: 'No Home Assistant at hand? Explore one of the homes of demo.home-assistant.io, right here.',
  demoHome: 'Demo home',
  exploreDemo: 'Explore the demo',
  leaveDemo: 'Leave the demo',
  browseHomes: 'See every demo home, with a preview',

  // The index (gallery.html)
  galleryLead: 'Your home, as one object per system. Pick where to look.',
  yourHALead: 'Sign in with your Home Assistant account; the object is built from your own entities.',
  demoApp: 'Pulse demo',
  demoAppLead: 'The object over simulated systems: home, car, pet, health and server, with alerts to trigger.',
  demoHomes: 'Demo homes',
  demoHomesLead: 'The six homes of demo.home-assistant.io, with entities that answer the ring. No Home Assistant needed.',
  homeFoot: (entities: number, systems: number) => `${entities} entities in ${systems} ${systems === 1 ? 'system' : 'systems'}`,
};
