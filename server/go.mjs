// Talks to one Biblo GO! site (and WeDoBooks) on behalf of one logged-in user.
import fs from 'node:fs';
import { login, req, Jar } from './go-login.mjs';
import { upstream } from './upstream.mjs';

const FN = 'https://europe-west1-biblio-prod-dk.cloudfunctions.net';
const Q = (n) => fs.readFileSync(new URL(`./queries/${n}.graphql`, import.meta.url), 'utf8');
const QUERIES = Object.fromEntries(['searchWithPagination', 'getMaterial', 'getManifestationsByFaust'].map((n) => [n, Q(n)]));

// The library's branches, used to limit searches to what that library has. Fetched per site
// from FBS (minus the branches the site itself leaves out) and kept in memory: library config, not user data.
const branchCache = new Map(); // site id -> { at, ids }
export class HttpError extends Error {
  constructor(status, msg, body) { super(msg); this.status = status; this.body = body; }
}

// In-memory only (gone on restart): Firebase ID tokens and which devices are registered,
// keyed by device id. Nothing here is written to disk.
const fbTokens = new Map();
const devicesAdded = new Set();

export class GoClient {
  // site: from sites.mjs. state: { jar, deviceId }
  // getCreds: () => {card, pin} | null  (for silent re-login)
  constructor(site, state, getCreds, onChange) {
    this.site = site; this.base = site.base;
    this.state = state; this.jar = Jar.from(state.jar ?? []);
    this.getCreds = getCreds; this.onChange = onChange;
  }

  save() { this.state.jar = this.jar.toJSON(); this.onChange?.(); }

  async relogin() {
    const creds = this.getCreds();
    if (!creds) throw new HttpError(401, 'session expired');
    const { jar } = await login(creds.card, creds.pin, this.site);
    this.jar = jar; fbTokens.delete(this.state.deviceId); this.save();
  }

  async raw(path, opts = {}, retry = true) {
    const url = path.startsWith('http') ? path : this.base + path;
    const { res } = await req(this.jar, url, opts);
    this.save();
    if ((res.status === 401 || res.status === 403) && retry && url.startsWith(this.base)) {
      await this.relogin();
      return this.raw(path, opts, false);
    }
    return res;
  }

  async ap(path, { method = 'GET', body } = {}) {
    const res = await this.raw('/ap-service' + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { 'content-type': 'application/json', origin: this.base },
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
  async branches() {
    const hit = branchCache.get(this.site.id);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.ids;
    const list = await this.ap('/fbs/external/v1/agencyid/branches');
    const ids = list.map((b) => b.branchId.replace(/^\D+-/, '')).filter((id) => !this.site.blacklistedBranches.has(id));
    branchCache.set(this.site.id, { at: Date.now(), ids });
    return ids;
  }
  async search(q, offset = 0, limit = 20, materialTypes = null) {
    const branchId = await this.branches();
    const filters = { ...(branchId.length ? { branchId } : {}), ...(materialTypes ? { materialTypesSpecific: materialTypes } : {}) };
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
  cancelReservation(id) {
    return this.ap(`/fbs/external/v1/agencyid/patrons/patronid/reservations?reservationid=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---------- digital (biblio / WeDoBooks) ----------
  digitalLoans() { return this.ap('/biblio/v1/loans?limit=250'); }
  quotas() { return this.ap('/biblio/v1/users/get_loan_quotas'); }
  borrow(isbn) { return this.ap('/biblio/v1/loans', { method: 'POST', body: { material_id: isbn } }); }

  async firebaseToken() {
    const fb = fbTokens.get(this.state.deviceId);
    if (fb && fb.exp > Date.now() + 60_000) return fb.idToken;
    const { token } = await this.ap('/biblio/v1/auth/create-sign-in-token', { method: 'POST', body: {} });
    if (!this.site.firebaseKey) throw new HttpError(409, 'Biblioteket har ikke lydbøger og e-bøger i GO.');
    const r = await upstream(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${this.site.firebaseKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.base, referer: this.base + '/' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    });
    const j = await r.json();
    if (!j.idToken) throw new HttpError(502, 'firebase sign-in failed', j);
    fbTokens.set(this.state.deviceId, { idToken: j.idToken, exp: Date.now() + Number(j.expiresIn) * 1000 });
    return j.idToken;
  }

  async fn(name, { data, query } = {}) {
    const idToken = await this.firebaseToken();
    const url = `${FN}/${name}${query ? '?' + new URLSearchParams(query) : ''}`;
    const r = await upstream(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + idToken, origin: this.base, referer: this.base + '/', ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
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
    if (!devicesAdded.has(this.state.deviceId)) {
      try {
        await this.fn('Devices-add', { data: { device: { id: this.state.deviceId, name: 'Bibliotek (lyd)', type: 'web' } } });
      } catch (e) {
        if (e.status === 429) throw new HttpError(409, 'Du har brugt alle 6 enheder til lydbøger og e-bøger. Fjern en enhed i GO under din profil, og prøv igen.');
        if (e.status !== 409) throw e; // 409 = already-exists: fine
      }
      devicesAdded.add(this.state.deviceId);
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
