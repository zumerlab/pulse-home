import { t as core } from '@zumer/pulse';

// The openHAB app's own strings, on top of the object's: the board's words
// where a home on openHAB has its own (items, locations), and the shell's
// (the connect panel, the demo house).
export const t = {
  ...core,
  connecting: 'Reading the home…',
  things: 'Items in openHAB',
  hostError: (message: string) => `openHAB: ${message}`,
  status: { 'signed-out': 'not connected', connecting: 'connecting', live: 'live', offline: 'offline, retrying', error: 'error' } as Record<string, string>,
  disconnect: 'Disconnect',
  leaveDemo: 'Leave the demo',
  demoLabel: 'Demo house · openHAB',
  noFloor: 'Outside and elsewhere',
  noRoom: 'The rest of the house',

  // Connecting
  connectLead: 'Your home, as one object per system. Connect to your openHAB to begin.',
  serverField: 'Your openHAB',
  // Served by openHAB itself: this server; elsewhere: an address, or the demo house through this page's server.
  serverHintHere: 'This openHAB, the one serving this page. Another one needs CORS switched on in its API settings.',
  serverHintAway: (demo: string) => `Its address, with CORS switched on in its API settings. Left empty, this page’s server reads ${demo} for you.`,
  tokenField: 'API token, only if it asks for one',
  tokenHint: 'Made in openHAB under your profile, “Create new API token”. Not needed while the implicit user role is on.',
  connect: 'Connect',
  demoLead: 'No openHAB at hand? Explore openHAB’s demo house as it was one evening, right here.',
  exploreDemo: 'Explore the demo house',
  browseHomes: 'See every demo home, with a preview',
  otherPlatform: 'Your home runs on Home Assistant? Pulse for Home Assistant is here.',
  houseFoot: (items: number, systems: number) => `${items} items in ${systems} ${systems === 1 ? 'system' : 'systems'}`,
  errNoServer: (url: string, why: string) => `No openHAB answered at ${url} (${why}).`,
  errUnauthorized: 'This openHAB asks for an API token, or did not accept the one given.',

  // Readings
  gotIt: 'Got it',
  turnOffHeating: 'Turn off heating',
  lock: 'Lock',
  heatingWindow: (rooms: string) => `Heating in the ${rooms} with the window open`,
  cold: (room: string, t: string) => `${room} is at ${t}°`,
  openAtNight: (what: string) => `${what} open at night`,
  unlockedAtNight: (what: string) => `${what} unlocked at night`,
  highDraw: (kw: string) => `${kw} from the grid`,
  batteryLow: (pct: string) => `Home battery at ${pct}%`,
  alarmOn: (what: string) => `${what} raised an alarm`,
};
