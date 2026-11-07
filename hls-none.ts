// hls.js stays out of the Home Assistant builds (the app and the card): Home
// Assistant's cameras reach the object as stills and MJPEG
// (`camera_proxy_stream`), never as HLS, and the library weighs 600 kB.
// <pulse-video> asks it whether it is supported: told no, it leaves HLS to the
// browser's own player (Safari) and keeps the still elsewhere.
export default { isSupported: () => false, Events: { ERROR: 'hlsError' } };
