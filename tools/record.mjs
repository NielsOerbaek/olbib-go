// Opens a headed Chrome with a dedicated profile and logs all traffic to capture/traffic.jsonl
import { chromium } from 'playwright-core';
import fs from 'node:fs';

fs.mkdirSync('capture', { recursive: true });
const out = fs.createWriteStream('capture/traffic.jsonl', { flags: 'a' });
const SKIP = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|ico|css|mp4)(\?|$)/i;

const ctx = await chromium.launchPersistentContext('.chrome-profile', {
  executablePath: '/usr/bin/google-chrome',
  headless: false,
  viewport: null,
  args: ['--remote-debugging-port=9333'],
});

ctx.on('response', async (res) => {
  const req = res.request();
  const url = req.url();
  if (SKIP.test(url)) return;
  const type = req.resourceType();
  let body = null;
  if (['xhr', 'fetch', 'document', 'script', 'other'].includes(type)) {
    try {
      const buf = await res.body();
      body = type === 'script' ? `<${buf.length} bytes>` : buf.toString('utf8').slice(0, 200_000);
    } catch { body = '<unavailable>'; }
  }
  out.write(JSON.stringify({
    t: new Date().toISOString(), type, method: req.method(), url,
    status: res.status(),
    reqHeaders: await req.allHeaders().catch(() => req.headers()),
    postData: req.postData(),
    resHeaders: await res.allHeaders().catch(() => res.headers()),
    body,
  }) + '\n');
});

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://go.bibliotek.kk.dk');
console.log('recording; CDP on :9333');
await new Promise((r) => ctx.on('close', r));
out.end();
