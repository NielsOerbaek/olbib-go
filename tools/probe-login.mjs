import fs from 'node:fs';
import { login, req } from '../server/go-login.mjs';
// creds taken from the capture's borchk POST, never printed
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find(l => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);
if (!/^\d{4,}$/.test(p.get('loginBibDkUserId') ?? '') || !/^\d{4,}$/.test(p.get('pincode') ?? '')) throw new Error('creds not found in capture');
const { jar, session } = await login(p.get('loginBibDkUserId'), p.get('pincode'));
console.log('session', session.isLoggedIn, session.expires);
console.log('cookies', JSON.stringify(jar.toJSON().map(([d, m]) => [d, m.map(([k]) => k)])));
fs.writeFileSync('capture/jar.json', JSON.stringify(jar.toJSON()));
const r = await req(jar, 'https://go.bibliotek.kk.dk/ap-service/biblio/v1/loans?limit=250');
console.log('cookie-only biblio loans:', r.res.status, (await r.res.text()).slice(0, 150));
