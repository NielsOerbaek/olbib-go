import { Jar, req } from '../server/go-login.mjs';
const jar = new Jar();
await req(jar, 'https://bibliotek.kk.dk/login?current-path=/go-login');
const { res } = await req(jar, 'https://login.bib.dk/login?token=undefined&returnurl=null&agency=710100&error=bonui&presel=710100&retries=2');
const h = await res.text();
const i=h.search(/fejl|forkert|error|ugyldig/i); for (const m of h.matchAll(/(class="[^"]*(error|alert|danger|warning)[^"]*"[^>]*>[\s\S]{0,300})/gi)) console.log(m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,300));
