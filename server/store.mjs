// Sessions on disk. Card + PIN are AES-GCM encrypted with a key that lives only in the
// user's cookie, so the file alone never reveals credentials.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.LYD_DATA ?? path.resolve('data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const FILE = path.join(DATA, 'sessions.json');

// per-server secret: device ids are HMACs of the card number, so they can't be reversed from sessions.json alone
const SECRET_FILE = path.join(DATA, 'secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
export const deviceIdFor = (card) => crypto.createHmac('sha256', SECRET).update(String(card)).digest('hex').slice(0, 32);

let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

let timer = null;
export function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(sessions), { mode: 0o600 });
    fs.renameSync(FILE + '.tmp', FILE);
  }, 200);
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const idOf = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}
function decrypt(key, s) {
  const b = Buffer.from(s, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
}

export function create({ card, pin, jar, name, deviceId }) {
  const sid = b64u(crypto.randomBytes(24)); const key = crypto.randomBytes(32);
  sessions[idOf(sid)] = { jar, name, deviceId, creds: encrypt(key, { card, pin }), created: Date.now(), seen: Date.now() };
  persist();
  return `${sid}.${b64u(key)}`; // cookie value
}

// returns { state, creds() } or null
export function open(cookie) {
  if (!cookie) return null;
  const [sid, k] = cookie.split('.');
  const state = sid && sessions[idOf(sid)];
  if (!state || !k) return null;
  const key = Buffer.from(k, 'base64url');
  if (key.length !== 32) return null;
  state.seen = Date.now();
  return { state, creds: () => { try { return decrypt(key, state.creds); } catch { return null; } } };
}

export function destroy(cookie) {
  const sid = cookie?.split('.')[0];
  if (sid) { delete sessions[idOf(sid)]; persist(); }
}

// drop sessions unused for 120 days
for (const [id, s] of Object.entries(sessions)) if (Date.now() - s.seen > 120 * 864e5) delete sessions[id];
