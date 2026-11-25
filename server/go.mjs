// Talks to go.bibliotek.kk.dk on behalf of one logged-in user.
import fs from 'node:fs';
import { login, req, Jar } from './go-login.mjs';

const GO = 'https://go.bibliotek.kk.dk';
const FN = 'https://europe-west1-biblio-prod-dk.cloudfunctions.net';

// GO's public Firebase web key is not ours to ship: read it from GO's own front page
// (it is embedded there as "firebaseApiKey") and cache it for the life of the process.
let firebaseKey = process.env.FIREBASE_WEB_KEY || null;
async function getFirebaseKey() {
  if (firebaseKey) return firebaseKey;
  const html = await (await fetch(GO + '/')).text();
  const m = html.match(/firebaseApiKey\\*"\s*:\s*\\*"(AIza[0-9A-Za-z_-]{30,})/);
  if (!m) throw new HttpError(502, 'could not find GO firebase key');
  return (firebaseKey = m[1]);
}
const Q = (n) => fs.readFileSync(new URL(`./queries/${n}.graphql`, import.meta.url), 'utf8');
const BRANCHES = JSON.parse(fs.readFileSync(new URL('./queries/branches.json', import.meta.url), 'utf8'));
const QUERIES = Object.fromEntries(['searchWithPagination', 'getMaterial', 'getManifestationsByFaust'].map((n) => [n, Q(n)]));

export class HttpError extends Error {
  constructor(status, msg, body) { super(msg); this.status = status; this.body = body; }
}

export class GoClient {
  // state: { jar, fb?: {idToken, exp}, deviceId, deviceAdded }
  // getCreds: () => {card, pin} | null  (for silent re-login)
  constructor(state, getCreds, onChange) {
    this.state = state; this.jar = Jar.from(state.jar ?? []);
    this.getCreds = getCreds; this.onChange = onChange;
  }

  save() { this.state.jar = this.jar.toJSON(); this.onChange?.(); }

  async relogin() {
    const creds = this.getCreds();
    if (!creds) throw new HttpError(401, 'session expired');
    const { jar } = await login(creds.card, creds.pin);
    this.jar = jar; this.state.fb = null; this.save();
  }

  async raw(path, opts = {}, retry = true) {
    const url = path.startsWith('http') ? path : GO + path;
    const { res } = await req(this.jar, url, opts);
    this.save();
    if ((res.status === 401 || res.status === 403) && retry && url.startsWith(GO)) {
      await this.relogin();
      return this.raw(path, opts, false);
    }
    return res;
  }

  async ap(path, { method = 'GET', body } = {}) {
    const res = await this.raw('/ap-service' + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { 'content-type': 'application/json', origin: GO },
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new HttpError(res.status, `${method} ${path} → ${res.status}`, data);
    return data;
  }

  async fbi(name, variables) {
    const r = await this.ap('/fbi', { method: 'POST', body: { query: QUERIES[name], variables } });
    if (r.errors?.length) throw new HttpError(502, 'fbi: ' + r.errors[0].message, r.errors);
    return r.data;
  }

  async session() {
    const res = await this.raw('/auth/session');
    return res.json();
  }

  // ---------- catalogue ----------
  search(q, offset = 0, limit = 20, materialTypes = null) {
    const filters = { branchId: BRANCHES, ...(materialTypes ? { materialTypesSpecific: materialTypes } : {}) };
    return this.fbi('searchWithPagination', { q: { all: q }, offset, limit, filters });
  }
  work(wid) { return this.fbi('getMaterial', { wid }); }
  byFaust(faust) { return faust.length ? this.fbi('getManifestationsByFaust', { faust }) : { manifestations: [] }; }
  product(isbn) { return this.ap(`/pubhub-adapter/v1/products/${encodeURIComponent(isbn)}`); }

  // ---------- physical (FBS) ----------
  fbsLoans() { return this.ap('/fbs/external/agencyid/patrons/patronid/loans/v2'); }
  fbsReservations() { return this.ap('/fbs/external/v1/agencyid/patrons/patronid/reservations/v2'); }
  fbsFees() { return this.ap('/fbs/external/agencyid/patron/patronid/fees/v2?includepaid=false&includenonpayable=true'); }
  renew(loanIds) { return this.ap('/fbs/external/agencyid/patrons/patronid/loans/renew/v2', { method: 'POST', body: loanIds }); }
  reserve(faustIds) {
    return this.ap('/fbs/external/v1/agencyid/patrons/patronid/reservations/v2', {
      method: 'POST', body: { reservations: faustIds.map((recordId) => ({ recordId })), ...(faustIds.length > 1 ? { type: 'parallel' } : {}) },
    });
  }
  cancelReservation(id) {
    return this.ap(`/fbs/external/v1/agencyid/patrons/patronid/reservations?reservationid=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  availability(faustIds) {
    return this.ap('/fbs/external/agencyid/catalog/availability/v3?' + faustIds.map((f) => 'recordid=' + encodeURIComponent(f)).join('&'));
  }

  // ---------- digital (biblio / WeDoBooks) ----------
  digitalLoans() { return this.ap('/biblio/v1/loans?limit=250'); }
  quotas() { return this.ap('/biblio/v1/users/get_loan_quotas'); }
  borrow(isbn) { return this.ap('/biblio/v1/loans', { method: 'POST', body: { material_id: isbn } }); }

  async firebaseToken() {
    const fb = this.state.fb;
    if (fb && fb.exp > Date.now() + 60_000) return fb.idToken;
    const { token } = await this.ap('/biblio/v1/auth/create-sign-in-token', { method: 'POST', body: {} });
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${await getFirebaseKey()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: GO, referer: GO + '/' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    });
    const j = await r.json();
    if (!j.idToken) throw new HttpError(502, 'firebase sign-in failed', j);
    this.state.fb = { idToken: j.idToken, exp: Date.now() + Number(j.expiresIn) * 1000 };
    this.save();
    return j.idToken;
  }

  async fn(name, { data, query } = {}) {
    const idToken = await this.firebaseToken();
    const url = `${FN}/${name}${query ? '?' + new URLSearchParams(query) : ''}`;
    const r = await fetch(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + idToken, origin: GO, referer: GO + '/', ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify({ data }),
    });
    const text = await r.text();
    if (!r.ok) throw new HttpError(r.status === 401 ? 502 : r.status, `${name} → ${r.status}`, text.slice(0, 500));
    return { text, type: r.headers.get('content-type') };
  }

  // One stable device per card (deviceId is set at login), so re-logins never use up
  // more of WeDoBooks' 6-device limit.
  async ensureDevice() {
    if (!this.state.deviceId) throw new HttpError(401, 'log ind igen');
    if (!this.state.deviceAdded) {
      try {
        await this.fn('Devices-add', { data: { device: { id: this.state.deviceId, name: 'Bibliotek (lyd)', type: 'web' } } });
      } catch (e) {
        if (e.status === 429) throw new HttpError(409, 'Du har brugt alle 6 enheder til lydbøger og e-bøger. Fjern en enhed i GO-appen eller på go.bibliotek.kk.dk under din profil, og prøv igen.');
        if (e.status !== 409) throw e; // 409 = already-exists: fine
      }
      this.state.deviceAdded = true; this.save();
    }
    await this.fn('Devices-set_active', { data: { deviceId: this.state.deviceId } });
  }

  async audiobookPlaylist(checkoutId) {
    await this.ensureDevice();
    await this.fn('LoanManager-update_last_opened', { data: { id: checkoutId } }).catch(() => {});
    const { text } = await this.fn('Streaming-audiobook_playlist', { query: { checkoutId } });
    if (!text.startsWith('#EXTM3U')) throw new HttpError(502, 'unexpected playlist', text.slice(0, 200));
    return text;
  }
}
