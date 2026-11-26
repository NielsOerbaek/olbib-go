// Read-only smoke test against a running server. Uses creds from the capture; never prints them.
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3800';
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find((l) => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);
let cookie = '';
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
};
const show = (label, { status, j }) => console.log(`--- ${label} ${status}`, (typeof j === 'string' ? j : JSON.stringify(j)).slice(0, 700));

show('me (anon)', await call('GET', '/api/me'));
show('login', await call('POST', '/api/login', { site: process.env.SITE ?? 'kobenhavn', card: p.get('loginBibDkUserId'), pin: p.get('pincode') }));
show('me', await call('GET', '/api/me'));
const s = await call('GET', '/api/search?q=' + encodeURIComponent('wimpy kid')); show('search', s);
const w = await call('GET', '/api/work/' + encodeURIComponent('work-of:870970-basis:61756914')); show('work', w);
const l = await call("GET", "/api/loans"); show("loans", l); console.log("PHYS", JSON.stringify(l.j.physical.slice(0,2)), "n", l.j.physical.length, "resv", l.j.reservations.length, "fees", l.j.fees);
const audio = l.j.digital?.find((d) => d.kind === 'audiobook');
if (audio) {
  const t = await call('POST', `/api/audio/${audio.id}/ticket`); show('ticket', t);
  const pl = await call('GET', t.j.url); show('playlist', pl);
}
show('logout', await call('POST', '/api/logout'));
