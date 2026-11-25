// Server-side login to go.bibliotek.kk.dk via Adgangsplatformen borchk (card + PIN).
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
    const res = await fetch(url, { method, body, redirect: 'manual',
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
  bnimu: 'Du bor ikke i Københavns Kommune ifølge biblioteket.',
};
export class LoginError extends Error {
  constructor(code, retries) {
    super((MESSAGES[code] ?? `Login fejlede (${code}).`) + (retries && code !== 'tmul' ? ` Du har ${retries} forsøg tilbage.` : ''));
    this.code = code;
  }
}

export async function login(card, pin) {
  const jar = new Jar();
  await req(jar, 'https://go.bibliotek.kk.dk/');
  const { res, url } = await req(jar, 'https://bibliotek.kk.dk/login?current-path=/go-login');
  const html = await res.text();
  const action = html.match(/action="(\/login\/identityProviderCallback\/borchk\/[^"]+)"/)?.[1];
  if (!action) throw new Error('login form not found at ' + url);
  const form = new URLSearchParams({ agency: '710100', libraryName: 'København', loginBibDkUserId: card, pincode: pin });
  const done = await req(jar, new URL(action, url).href, { method: 'POST', body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://login.bib.dk' } });
  const session = await (await req(jar, 'https://go.bibliotek.kk.dk/auth/session')).res.json();
  if (!session.isLoggedIn) {
    const u = new URL(done.url);
    const code = u.searchParams.get('error'); const retries = u.searchParams.get('retries');
    if (!code) throw new Error('login failed without error code at ' + u.origin + u.pathname);
    throw new LoginError(code, retries);
  }
  return { jar, session };
}
