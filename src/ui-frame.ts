/** Public renderer shell contains no user data. Untrusted apps run in an opaque origin. */
export function uiFrame(nonce: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script nonce="${nonce}">
  const nonce = document.currentScript.nonce;
  const receive = event => {
    if (event.source !== parent || event.data?.type !== 'pida:render' || typeof event.data.html !== 'string' || event.data.html.length > 131072) return;
    removeEventListener('message', receive);
    const parsed = new DOMParser().parseFromString(event.data.html, 'text/html');
    parsed.querySelectorAll('meta[http-equiv],base,iframe,object,embed').forEach(node => node.remove());
    const scripts = [...parsed.querySelectorAll('script')].map(node => ({ text: node.src ? '' : node.textContent, type: node.getAttribute('type') }));
    parsed.querySelectorAll('script').forEach(node => node.remove());
    for (const node of parsed.querySelectorAll('*')) for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    document.documentElement.lang = parsed.documentElement.lang;
    document.head.replaceChildren(...parsed.head.childNodes);
    document.body.replaceWith(parsed.body);
    addEventListener('error', () => parent.postMessage({ type: 'pida:render-error' }, '*'));
    addEventListener('unhandledrejection', () => parent.postMessage({ type: 'pida:render-error' }, '*'));
    for (const source of scripts) {
      const script = document.createElement('script'); script.nonce = nonce;
      if (source.type) script.type = source.type;
      script.textContent = source.text; document.body.append(script);
    }
    document.dispatchEvent(new Event('DOMContentLoaded'));
    parent.postMessage({ type: 'pida:rendered' }, '*');
  };
  addEventListener('message', receive);
  parent.postMessage({ type: 'pida:ready' }, '*');
  </script></body></html>`;
}

export function uiFramePolicy(nonce: string) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`;
}
