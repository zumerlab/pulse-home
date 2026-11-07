// The index: every way to see Pulse, as cards to pick from. Your own Home
// Assistant, the demo app with simulated systems (in development), and the
// six homes of demo.home-assistant.io, each previewed with the mini rings its
// entities fill, computed from the same model the board uses.

import '@zumer/orbit/style';
import '@zumer/orbit';
import '@zumer/pulse/style.css';
import './style.css';
import { esc } from '@zumer/pulse';
import { homes, type Home } from './demo/homes/index.ts';
import { previewHome } from './preview.ts';
import { t } from './strings.ts';

// The demo app runs beside this one in development; elsewhere, point to it
// with VITE_DEMO_APP_URL or the card does not appear.
const DEMO_APP: string = import.meta.env.VITE_DEMO_APP_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:5173/' : '');

const root = document.querySelector<HTMLElement>('#gallery')!;

const card = (href: string, title: string, lead: string, body: string, foot: string, cls = '') =>
  `<a class="home-card ${cls}" href="${esc(href)}">
    <span class="home-head"><strong>${esc(title)}</strong></span>
    <span class="home-lead">${esc(lead)}</span>
    ${body}
    <span class="home-foot">${esc(foot)}</span>
  </a>`;

// The links name index.html: a static host that does not serve a folder as its
// index (Home Assistant's /local/, for one) still reaches the app.
// Each home with one mini ring per system it fills (`preview.ts`).
async function homeCard(home: Home) {
  const { tiles, entities } = await previewHome(home.id);
  return card(`./index.html?demo=${home.id}`, home.name, `${home.author} · ${home.description}`,
    `<span class="tiles">${tiles.join('')}</span>`,
    t.homeFoot(entities, tiles.length), 'home-card-demo');
}

root.innerHTML = `<h1>Pulse</h1><p class="gallery-lead">${t.galleryLead}</p>
  <section class="home-cards">
    ${card('./index.html', t.yourHA, t.yourHALead, '', t.signIn, 'home-card-live')}
    ${DEMO_APP ? card(DEMO_APP, t.demoApp, t.demoAppLead, '', t.openShort, 'home-card-app') : ''}
  </section>
  <h2>${t.demoHomes}</h2><p class="gallery-lead">${t.demoHomesLead}</p>
  <section class="home-cards" data-homes></section>`;
const list = root.querySelector<HTMLElement>('[data-homes]')!;
for (const home of homes) list.insertAdjacentHTML('beforeend', await homeCard(home));
