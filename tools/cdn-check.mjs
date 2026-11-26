import fs from 'node:fs';
import { login } from '../server/go-login.mjs';
import { site } from '../server/sites.mjs';
const SITE = await site(process.env.SITE ?? 'kobenhavn');
import { GoClient } from '../server/go.mjs';
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find((l) => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);
const { jar } = await login(p.get('loginBibDkUserId'), p.get('pincode'), SITE);
const go = new GoClient(SITE, { jar: jar.toJSON(), deviceId: process.argv[2] }, () => null);
const loans = await go.digitalLoans();
const loan = loans.loans.find((l) => l.active && l.material_type === 'audiobook');
const pl = await go.audiobookPlaylist(loan.id);
fs.writeFileSync('capture/playlist.m3u8', pl);
const key = pl.match(/URI="([^"]+)"/)[1]; const seg = pl.split('\n').find((l) => l.startsWith('https://') && l.includes('.ts'));
for (const [label, h] of [['no origin', {}], ['other origin', { origin: 'https://example.org', referer: 'https://example.org/' }], ['go origin', { origin: 'https://go.bibliotek.kk.dk' }]]) {
  for (const [n, u] of [['key', key], ['seg', seg]]) {
    const r = await fetch(u, { headers: { 'user-agent': 'AppleCoreMedia/1.0.0.20G75 (iPhone; U; CPU OS 16_6 like Mac OS X; da_dk)', ...h } });
    const b = Buffer.from(await r.arrayBuffer());
    console.log(label, n, r.status, r.headers.get('content-type'), b.length, r.headers.get('access-control-allow-origin'));
  }
}
console.log(pl.split('\n').slice(0, 8).join('\n').replace(/Signature=[^&"\n]+/g, 'Signature=…'));
console.log('segments', pl.split('\n').filter((l) => l.includes('.ts')).length, 'maxEXTINF', Math.max(...pl.split('\n').filter((l) => l.startsWith('#EXTINF')).map((l) => parseFloat(l.slice(8)))));
