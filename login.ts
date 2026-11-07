// The sign-in panel: the address of the user's Home Assistant and a button
// that takes them to Home Assistant's own login page. Below it, the demo homes
// of demo.home-assistant.io for whoever has no Home Assistant at hand, and,
// for kiosks and automation, a long-lived access token instead.

import { esc } from '@zumer/pulse';
import { t } from './strings.ts';
import { lastUrl, type WebSocketSource } from './source.ts';
import { DEFAULT_HOME, homes } from './demo/homes/index.ts';
import { previewHome } from './preview.ts';

export function mountLogin(root: HTMLElement, ha: WebSocketSource, onDemo: (homeId: string) => void) {
  const url = lastUrl() || 'http://homeassistant.local:8123';
  // Beside the form, on a wide screen, the home chosen below as the object
  // it would be: its systems as mini rings, read from its own entities.
  root.innerHTML = `<form class="login" novalidate>
    <div class="login-main">
      <h1>Pulse</h1>
      <p class="login-lead">${t.loginLead}</p>
      <label>${t.yourHA}<input name="url" type="url" inputmode="url" autocomplete="url" required value="${esc(url)}" placeholder="http://homeassistant.local:8123"></label>
      <button type="submit" class="primary" data-login="oauth">${t.signIn}</button>
      <p class="error" hidden></p>
      <div class="login-demo">
        <p class="login-hint">${t.demoLead}</p>
        <label>${t.demoHome}<select name="home">${homes.map((h) =>
          `<option value="${h.id}"${h.id === DEFAULT_HOME ? ' selected' : ''}>${esc(h.name)} · ${esc(h.author)}</option>`).join('')}</select></label>
        <p class="login-hint" data-home-description></p>
        <div class="login-actions">
          <button type="button" class="plain" data-login="demo">${t.exploreDemo}</button>
          <a class="login-link" href="./gallery.html">${t.browseHomes}</a>
        </div>
      </div>
      <details>
        <summary>${t.tokenInstead}</summary>
        <label>${t.tokenLabel}<input name="token" type="password" autocomplete="off" spellcheck="false"></label>
        <p class="login-hint">${t.tokenHint}</p>
        <button type="button" class="plain" data-login="token">${t.connect}</button>
      </details>
    </div>
    <aside class="login-side" data-preview aria-live="polite"></aside>
  </form>`;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const err = root.querySelector<HTMLElement>('.error')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const showError = () => {
    err.hidden = !ha.error;
    err.textContent = ha.error;
  };
  showError();
  ha.onStatus(showError);
  const description = root.querySelector<HTMLElement>('[data-home-description]')!;
  const side = root.querySelector<HTMLElement>('[data-preview]')!;
  let previewing = 0;
  const preview = () => {
    // The preview of the home chosen; a later choice wins over a slower load.
    const turn = ++previewing;
    if (root.hidden) return;
    void previewHome(field('home').value, 'data-home-system').then(({ tiles, entities }) => {
      if (turn !== previewing || !root.isConnected || root.hidden) return;
      side.innerHTML = `<span class="tiles">${tiles.join('')}</span><p class="login-preview-foot">${esc(t.homeFoot(entities, tiles.length))}</p>`;
    });
  };
  const describe = () => {
    description.textContent = homes.find((h) => h.id === field('home').value)?.description ?? '';
    preview();
  };
  describe();
  field('home').addEventListener('change', describe);
  // The panel stays in the page behind the board: its preview goes while it is hidden, and comes back with it.
  new MutationObserver(() => { if (root.hidden) { previewing++; side.innerHTML = ''; } else preview(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!field('url').reportValidity()) return;
    void ha.signIn(field('url').value);
  });
  form.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-login="demo"]')) { onDemo(field('home').value); return; }
    if (target.closest('[data-login="token"]')) {
      if (!field('url').reportValidity() || !field('token').value.trim()) { field('token').focus(); return; }
      void ha.signInWithToken(field('url').value, field('token').value);
    }
  });
}
