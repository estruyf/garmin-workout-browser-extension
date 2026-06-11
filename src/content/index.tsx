import { createRoot, type Root } from 'react-dom/client';

import App from './App';
import './styles.css';

const HOST_ID = 'gwi-root';

/**
 * Extension.js content_script entrypoint. The framework calls this on
 * injection and the returned cleanup function on teardown.
 *
 * The widget renders inside a Shadow DOM so Garmin Connect's own (unlayered,
 * global) CSS can't bleed into it. Two Tailwind-v4-in-shadow-DOM quirks are
 * handled when injecting the compiled stylesheet: theme variables emitted under
 * :root are remapped to :host (so they apply inside the shadow tree), and
 * @property at-rules are lifted into the document <head> (they don't register
 * from inside a shadow root).
 */
export default function initial() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const shadowStyle = document.createElement('style');
  shadow.appendChild(shadowStyle);

  const mount = document.createElement('div');
  shadow.appendChild(mount);

  let headStyle: HTMLStyleElement | undefined;
  fetchCss().then((css) => {
    shadowStyle.textContent = css.replaceAll(':root', ':host');
    const propertyRules = css.match(/@property[^{]+\{[^}]*\}/g);
    if (propertyRules) {
      headStyle = document.createElement('style');
      headStyle.setAttribute('data-gwi-properties', 'true');
      headStyle.textContent = propertyRules.join('');
      document.head.appendChild(headStyle);
    }
  });

  const root: Root = createRoot(mount);
  root.render(<App />);

  return () => {
    root.unmount();
    host.remove();
    headStyle?.remove();
  };
}

async function fetchCss(): Promise<string> {
  const url = new URL('./styles.css', import.meta.url);
  const res = await fetch(url);
  return res.ok ? res.text() : '';
}
