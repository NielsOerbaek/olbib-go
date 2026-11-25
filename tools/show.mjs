import fs from 'node:fs';
const pat = new RegExp(process.argv[2]); const n = +(process.argv[3] ?? 1500);
for (const l of fs.readFileSync('capture/traffic.jsonl','utf8').trim().split('\n')) {
  const r = JSON.parse(l); if (!pat.test(r.method+' '+r.url)) continue;
  const h = Object.fromEntries(Object.entries(r.reqHeaders).filter(([k])=>!/^(sec-|accept-|user-agent|priority|referer$)/.test(k)).map(([k,v])=>[k, v.length>120? v.slice(0,120)+'…':v]));
  console.log('====', r.status, r.method, r.url.slice(0,300)); console.log('REQH', JSON.stringify(h));
  if (r.postData) console.log('POST', r.postData.slice(0,n));
  const rh = r.resHeaders; console.log('RESH', JSON.stringify({ct:rh['content-type'], loc:rh.location, sc:rh['set-cookie']?.slice(0,300)}));
  if (r.body) console.log('BODY', r.body.slice(0,n));
}
