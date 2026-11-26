// Server-side login to a Biblo GO! site via Adgangsplatformen borchk (card + PIN).
import { upstream } from './upstream.mjs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

export class Jar {
  constructor() { this.c = new Map(); } // host -> Map(name -> value)
  set(url, res) {
    const host = new URL(url).hostname;
    for (const sc of res.headers.getSetCookie()) {
      const [nv, ...attrs] = sc.split(';');
      const i = nv.indexOf('='); const name = nv.slice(0, i).trim(); const val = nv.slice(i + 1).trim();
      const dom = attrs.map(a => a.trim()).find(a => /^domain=/i.test(a))?.slice(7).replace(/^\./, '') ?? host;
      if (!this.c.has(dom)) this.c.set(dom, new Map());
      if (val === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) this.c.get(dom).delete(name); else this.c.get(dom).set(name, val);
    }
  }
  header(url) {
    const host = new URL(url).hostname; const out = [];
    for (const [dom, m] of this.c) if (host === dom || host.endsWith('.' + dom)) for (const [k, v] of m) out.push(`${k}=${v}`);
    return out.join('; ');
  }
  toJSON() { return [...this.c].map(([d, m]) => [d, [...m]]); }
  static from(j) { const jar = new Jar(); for (const [d, m] of j) jar.c.set(d, new Map(m)); return jar; }
}

export async function req(jar, url, opts = {}, maxHops = 15) {
  let method = opts.method ?? 'GET', body = opts.body, headers = opts.headers ?? {};
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await upstream(url, { method, body, redirect: 'manual',
      headers: { 'user-agent': UA, cookie: jar.header(url), ...headers } });
    jar.set(url, res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).href;
      if (res.status !== 307 && res.status !== 308) { method = 'GET'; body = undefined; headers = {}; }
      continue;
    }
    return { res, url };
  }
  throw new Error('too many redirects');
}

const MESSAGES = {
  bonfd: 'Forkert lånernummer eller pinkode.',
  bonui: 'Forkert lånernummer eller pinkode.',
  tmul: 'For mange forkerte forsøg. Prøv igen senere.',
  bnimu: 'Ifølge biblioteket bor du ikke i den valgte kommune.',
};
export class LoginError extends Error {
  constructor(code, retries) {
    super((MESSAGES[code] ?? `Login fejlede (${code}).`) + (retries && code !== 'tmul' ? ` Du har ${retries} forsøg tilbage.` : ''));
    this.code = code;
  }
}

// site: from sites.mjs (base = GO site, loginUrl = the library's "go-login" link)
export async function login(card, pin, site) {
  const jar = new Jar();
  await req(jar, site.base + '/');
  const { res, url } = await req(jar, site.loginUrl);
  const html = await res.text();
  const action = html.match(/action="(\/login\/identityProviderCallback\/borchk\/[^"]+)"/)?.[1];
  if (!action) throw new Error('login form not found at ' + new URL(url).host);
  // the library's own login link pre-selects it: read its agency number and name from the form
  const agency = html.match(/<input[^>]*value="(\d{6})"[^>]*name="agency"[^>]*id="libraryid-input"/)?.[1]
    ?? html.match(/<input[^>]*id="libraryid-input"[^>]*value="(\d{6})"/)?.[1];
  const libraryName = html.match(/<input[^>]*id="libraryname-input"[^>]*value="([^"]*)"/)?.[1] ?? '';
  if (!agency) throw new Error('library not preselected on login form');
  const form = new URLSearchParams({ agency, libraryName: decodeEntities(libraryName), loginBibDkUserId: card, pincode: pin });
  const done = await req(jar, new URL(action, url).href, { method: 'POST', body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(url).origin } });
  const session = await (await req(jar, site.base + '/auth/session')).res.json();
  if (!session.isLoggedIn) {
    const u = new URL(done.url);
    const code = u.searchParams.get('error'); const retries = u.searchParams.get('retries');
    if (!code) throw new Error('login failed without error code at ' + u.origin + u.pathname);
    throw new LoginError(code, retries);
  }
  return { jar, session };
}

const decodeEntities = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
