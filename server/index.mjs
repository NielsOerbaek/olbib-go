import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { login, LoginError } from './go-login.mjs';
import { GoClient, HttpError } from './go.mjs';
import * as store from './store.mjs';

const PORT = Number(process.env.PORT ?? 3800);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC = path.resolve(new URL('../public', import.meta.url).pathname);
const COOKIE = 'lyd';
const MAX_AGE = 180 * 86400;

// ---------- helpers ----------
const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 64_000) { reject(new HttpError(413, 'too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new HttpError(400, 'bad json')); } });
});
const cookieOf = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }))[COOKIE];
const setCookie = (res, v, maxAge = MAX_AGE) =>
  res.setHeader('set-cookie', `${COOKIE}=${v}; Path=/; HttpOnly; ${process.env.INSECURE_COOKIE ? "" : "Secure; "}SameSite=Lax; Max-Age=${maxAge}`);
const clientIp = (req) => (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;

function clientFor(req) {
  const s = store.open(cookieOf(req));
  if (!s) throw new HttpError(401, 'not logged in');
  return new GoClient(s.state, s.creds, store.persist);
}

// ---------- shaping ----------
const first = (a) => (Array.isArray(a) ? a[0] : undefined);
// Cover hosts chain to roots old iOS doesn't trust (Sectigo R46, ISRG Root YR), so covers go through us.
const COVER_HOSTS = new Set(['images.pubhub.dk', 'fbiinfo-present.dbc.dk']);
const prox = (u) => (u ? `/api/cover?u=${encodeURIComponent(u)}` : null);
const coverOf = (m) => prox(m?.cover?.small?.url ?? m?.cover?.thumbnail ?? null);
const faustOf = (pid) => pid?.split(':')[1];
const DIGITAL = { EBOOK: 'ebook', AUDIO_BOOK_ONLINE: 'audiobook' };

function teaser(w) {
  if (!w) return null;
  const all = w.manifestations?.all ?? [];
  return {
    id: w.workId,
    title: first(w.titles?.full) ?? '',
    creators: (w.creators ?? []).map((c) => c.display),
    year: w.workYear?.display ?? null,
    types: [...new Set((w.materialTypes ?? []).map((t) => t.materialTypeSpecific?.display).filter(Boolean))],
    cover: coverOf(w.manifestations?.bestRepresentation) ?? coverOf(all.find((m) => coverOf(m))),
  };
}

function workDetail(w) {
  const all = w.manifestations?.all ?? [];
  const digital = []; const physical = [];
  for (const m of all) {
    const code = first(m.materialTypes)?.materialTypeSpecific?.code;
    const isbn = m.identifiers?.find((i) => i.type === 'PUBLIZON')?.value;
    if (isbn && DIGITAL[code]) digital.push({ isbn, kind: DIGITAL[code], label: first(m.materialTypes).materialTypeSpecific.display, cover: coverOf(m) });
    else if (m.accessTypes?.some((a) => a.code === 'PHYSICAL')) {
      physical.push({ faust: faustOf(m.pid), label: first(m.materialTypes)?.materialTypeSpecific?.display ?? 'bog', edition: m.edition?.summary ?? null });
    }
  }
  return {
    ...teaser(w),
    abstract: first(w.abstract) ?? null,
    series: all.map((m) => first(m.series)).find(Boolean) ?? null,
    ages: all.map((m) => first(m.audience?.ages)?.display).find(Boolean) ?? null,
    digital: [...new Map(digital.map((d) => [d.kind, d])).values()],
    physical,
  };
}

async function teasersByFaust(go, faust) {
  const ids = [...new Set(faust.filter(Boolean))];
  if (!ids.length) return {};
  const { manifestations } = await go.byFaust(ids);
  return Object.fromEntries((manifestations ?? []).filter(Boolean).map((m) => [faustOf(m.pid), teaser(m.ownerWork)]));
}

// ---------- audio tickets (Safari's native HLS player can't be trusted to send cookies) ----------
const tickets = new Map();
setInterval(() => { for (const [k, t] of tickets) if (t.exp < Date.now()) tickets.delete(k); }, 60_000).unref();

// ---------- login throttle (all users share box's IP towards login.bib.dk) ----------
const fails = new Map();
const throttled = (ip) => (fails.get(ip) ?? []).filter((t) => t > Date.now() - 15 * 60_000).length >= 5;

// ---------- routes ----------
const routes = [
  ['POST', /^\/api\/login$/, async (req, res) => {
    const ip = clientIp(req);
    if (throttled(ip)) throw new HttpError(429, 'For mange forsøg. Vent et kvarter.');
    const { card, pin } = await readBody(req);
    if (!card || !pin) throw new HttpError(400, 'Udfyld lånernummer og pinkode');
    try {
      const { jar, session } = await login(String(card).trim(), String(pin).trim());
      const deviceId = store.deviceIdFor(String(card).trim());
      setCookie(res, store.create({ card: String(card).trim(), pin: String(pin).trim(), jar: jar.toJSON(), name: session.user?.name, deviceId }));
      json(res, 200, { name: session.user?.name ?? null });
    } catch (e) {
      if (e instanceof LoginError) { fails.set(ip, [...(fails.get(ip) ?? []), Date.now()]); throw new HttpError(401, e.message); }
      throw e;
    }
  }],
  ['POST', /^\/api\/logout$/, async (req, res) => {
    const c = cookieOf(req);
    const s = store.open(c);
    if (s) await new GoClient(s.state, () => null).raw('/auth/logout').catch(() => {});
    store.destroy(c); setCookie(res, '', 0); json(res, 200, {});
  }],
  ['GET', /^\/api\/me$/, async (req, res) => {
    const s = store.open(cookieOf(req));
    json(res, 200, s ? { name: s.state.name ?? null } : { name: null, loggedOut: true });
  }],
  ['GET', /^\/api\/search$/, async (req, res, _m, url) => {
    const go = clientFor(req);
    const q = url.searchParams.get('q')?.trim();
    if (!q) return json(res, 200, { hitcount: 0, works: [] });
    const TYPES = { audiobook: ['lydbog (online)'], ebook: ['e-bog'], book: ['bog'] };
    const { search } = await go.search(q, Number(url.searchParams.get('offset') ?? 0), 20, TYPES[url.searchParams.get('type')] ?? null);
    json(res, 200, { hitcount: search.hitcount, works: search.works.map(teaser) });
  }],
  ['GET', /^\/api\/work\/([^/]+)$/, async (req, res, m) => {
    const go = clientFor(req);
    const { work } = await go.work(decodeURIComponent(m[1]));
    if (!work) throw new HttpError(404, 'Ukendt titel');
    const d = workDetail(work);
    const faust = d.physical.map((p) => p.faust);
    const [avail, digital] = await Promise.all([
      faust.length ? go.availability(faust).catch(() => []) : [],
      go.digitalLoans().catch(() => ({ loans: [] })),
    ]);
    d.physicalAvailable = avail.some((a) => a.available);
    d.physicalReservable = avail.some((a) => a.reservable);
    d.reservationsInQueue = avail.reduce((n, a) => Math.max(n, a.reservations ?? 0), 0);
    d.reserveFaust = avail.find((a) => a.reservable && a.available)?.recordId ?? avail.find((a) => a.reservable)?.recordId ?? null;
    for (const x of d.digital) x.loan = digital.loans.find((l) => l.active && l.material_id === x.isbn)?.id ?? null;
    json(res, 200, d);
  }],
  ['GET', /^\/api\/loans$/, async (req, res) => {
    const go = clientFor(req);
    const [phys, resv, dig, fees] = await Promise.all([
      go.fbsLoans(), go.fbsReservations(), go.digitalLoans(), go.fbsFees().catch(() => []),
    ]);
    const active = dig.loans.filter((l) => l.active);
    const [works, products] = await Promise.all([
      teasersByFaust(go, [...phys.map((l) => l.loanDetails.recordId), ...resv.map((r) => r.recordId)]),
      Promise.all(active.map((l) => go.product(l.material_id).then((p) => p.product).catch(() => null))),
    ]);
    json(res, 200, {
      digital: active.map((l, i) => ({
        id: l.id, isbn: l.material_id, kind: l.material_type, title: l.title, author: l.author, end: l.end,
        duration: l.duration ?? null, cover: prox(products[i]?.thumbnailUri ?? products[i]?.coverUri),
      })),
      physical: phys.map((l) => ({
        loanId: l.loanDetails.loanId, dueDate: l.loanDetails.dueDate, isRenewable: l.isRenewable,
        renewalStatus: l.renewalStatusList, work: works[l.loanDetails.recordId] ?? { title: l.loanDetails.ilBibliographicRecord?.title ?? 'Ukendt titel' },
      })).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      reservations: resv.map((r) => ({
        id: r.reservationId, state: r.state, numberInQueue: r.numberInQueue ?? null,
        pickupDeadline: r.pickupDeadline ?? null, pickupNumber: r.pickupNumber ?? null, pickupBranch: r.pickupBranch ?? null,
        work: works[r.recordId] ?? { title: 'Ukendt titel' },
      })),
      fees: fees.reduce((sum, f) => sum + (f.amount ?? 0), 0),
    });
  }],
  ['POST', /^\/api\/renew$/, async (req, res) => {
    const go = clientFor(req);
    const { loanIds } = await readBody(req);
    json(res, 200, await go.renew(loanIds.map(Number)));
  }],
  ['POST', /^\/api\/reserve$/, async (req, res) => {
    const go = clientFor(req);
    const { faust } = await readBody(req);
    const r = await go.reserve(faust.map(String));
    json(res, r.success ? 200 : 409, { success: r.success, results: (r.reservationResults ?? []).map((x) => x.result) });
  }],
  ['DELETE', /^\/api\/reservations\/(\d+)$/, async (req, res, m) => {
    await clientFor(req).cancelReservation(m[1]);
    json(res, 200, {});
  }],
  ['POST', /^\/api\/borrow$/, async (req, res) => {
    const go = clientFor(req);
    const { isbn } = await readBody(req);
    const r = await go.borrow(String(isbn));
    json(res, 200, { status: r.status, id: r.loan?.id ?? null });
  }],
  ['GET', /^\/api\/cover$/, async (req, res, _m, url) => {
    if (!store.open(cookieOf(req))) throw new HttpError(401, 'not logged in');
    let u; try { u = new URL(url.searchParams.get('u')); } catch { throw new HttpError(400, 'bad url'); }
    if (u.protocol !== 'https:' || !COVER_HOSTS.has(u.hostname)) throw new HttpError(400, 'host not allowed');
    const r = await fetch(u, { redirect: 'error' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/')) throw new HttpError(502, 'cover ' + r.status);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=604800, immutable' });
    res.end(Buffer.from(await r.arrayBuffer()));
  }],
  ['POST', /^\/api\/log$/, async (req, res) => {
    const b = await readBody(req);
    console.log('client', clientIp(req), String(b.kind).slice(0, 20), String(b.detail).slice(0, 500), '|', String(b.ua).slice(0, 160));
    json(res, 200, {});
  }],
  ['POST', /^\/api\/audio\/([\w-]+)\/ticket$/, async (req, res, m) => {
    clientFor(req); // auth check
    const t = crypto.randomBytes(18).toString('base64url');
    tickets.set(t, { cookie: cookieOf(req), checkoutId: m[1], exp: Date.now() + 30 * 60_000 });
    json(res, 200, { url: `/api/audio/${t}.m3u8` });
  }],
  ['GET', /^\/api\/audio\/([\w-]+)\.m3u8$/, async (req, res, m) => {
    const t = tickets.get(m[1]);
    if (!t || t.exp < Date.now()) throw new HttpError(404, 'ticket expired');
    const s = store.open(t.cookie);
    if (!s) throw new HttpError(401, 'not logged in');
    const playlist = t.playlist ?? (t.playlist = await new GoClient(s.state, s.creds, store.persist).audiobookPlaylist(t.checkoutId));
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
    res.end(playlist);
  }],
];

// ---------- static ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(res, pathname) {
  let file = path.join(PUBLIC, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const t0 = Date.now();
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/log' && url.pathname !== '/api/cover') {
    res.on('finish', () => console.log(req.method, url.pathname.replace(/^\/api\/audio\/[\w-]+\.m3u8$/, '/api/audio/<ticket>.m3u8'), res.statusCode, `${Date.now() - t0}ms`, String(req.headers['user-agent'] ?? '').slice(0, 60)));
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return await fn(req, res, m, url);
      }
      throw new HttpError(404, 'not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    serveStatic(res, url.pathname);
  } catch (e) {
    const status = e.status ?? 500;
    if (status >= 400) console.error(req.method, url.pathname.replace(/audio\/[\w-]+\.m3u8/, 'audio/<ticket>.m3u8'), status, e.message, typeof e.body === 'string' ? e.body.slice(0, 300) : JSON.stringify(e.body ?? '').slice(0, 300));
    if (!res.headersSent) json(res, status, { error: status >= 500 && !e.status ? 'Serverfejl' : e.message, detail: e.body ?? undefined });
    else res.end();
  }
}).listen(PORT, HOST, () => console.log(`lyd on http://${HOST}:${PORT}`));
