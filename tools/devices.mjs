// List (and with --clean, remove) WeDoBooks devices registered by this app ("… (lyd)").
import fs from 'node:fs';
import { login } from '../server/go-login.mjs';
import { GoClient } from '../server/go.mjs';
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find((l) => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);
const { jar } = await login(p.get('loginBibDkUserId'), p.get('pincode'));
const go = new GoClient({ jar: jar.toJSON() }, () => null);
const idToken = await go.firebaseToken();
const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url')).user_id;
let devices = null;
for (const path of [`user_devices/${uid}`, `shared/application_data/user_devices/${uid}`]) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/biblio-prod-dk/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer ' + idToken } });
  console.log(path.replace(uid, '<uid>'), r.status);
  if (r.ok) { const d = await r.json(); devices = d.fields.devices.arrayValue.values?.map((v) => Object.fromEntries(Object.entries(v.mapValue.fields).map(([k, x]) => [k, Object.values(x)[0]]))) ?? []; console.log('active', d.fields.active_device?.stringValue); break; }
}
console.log(devices?.map((d) => `${d.id} ${d.name} ${d.type} ${d.last_used ?? ''}`).join('\n'));
if (process.argv.includes('--clean') && devices) {
  const mine = devices.filter((d) => /\(lyd\)$/.test(d.name)).map((d) => d.id);
  if (mine.length) console.log('remove', mine.length, (await go.fn('Devices-remove', { data: { deviceIds: mine } })).text);
}
