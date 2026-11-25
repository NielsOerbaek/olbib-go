// Stateless sessions: everything about a login (GO's session cookies, card + PIN for silent
// re-login, name, device id) is sealed with AES-256-GCM and stored ONLY in the user's own
// cookie. The server keeps no list of users; on disk there is nothing but the server secret.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.LYD_DATA ?? path.resolve('data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

const SECRET_FILE = path.join(DATA, 'secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
const KEY = crypto.createHash('sha256').update('lyd-session:' + SECRET).digest(); // separate from the device-id HMAC

const MAX_AGE_MS = 180 * 864e5;

// device ids are HMACs of the card number, so they can't be reversed to a card number
export const deviceIdFor = (card) => crypto.createHmac('sha256', SECRET).update(String(card)).digest('hex').slice(0, 32);

export function seal(session) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ ...session, iat: session.iat ?? Date.now() })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

// returns the session object, or null if missing, tampered with, or too old
export function unseal(value) {
  if (!value) return null;
  try {
    const b = Buffer.from(value, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
    if (!s.iat || Date.now() - s.iat > MAX_AGE_MS) return null;
    return s;
  } catch {
    return null;
  }
}
