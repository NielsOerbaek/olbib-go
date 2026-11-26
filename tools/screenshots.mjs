// Takes README screenshots at iPhone size. "Mine lån" and the account name are replaced with
// sample data built from ordinary catalogue searches, so no real loans end up in the images.
// Usage: BASE=https://<your-server> node tools/screenshots.mjs docs/screenshots
import fs from 'node:fs';
import { chromium, devices } from 'playwright-core';

const OUT = process.argv[2] ?? 'docs/screenshots';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3800';
fs.mkdirSync(OUT, { recursive: true });
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find((l) => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const page = await ctx.newPage();
const settle = async (ms = 1200) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };
const shot = async (name) => { await page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; }); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('saved', name); };

// 1. login screen (empty form)
await page.goto(BASE + '/'); await page.waitForSelector('#card'); await settle(); await shot('1-login');
await page.waitForSelector('#site:not([disabled])'); await page.selectOption('#site', process.env.SITE ?? 'kobenhavn'); await page.fill('#card', p.get('loginBibDkUserId')); await page.fill('#pin', p.get('pincode'));
await page.click('button[type=submit]'); await page.waitForSelector('.row, .book', { timeout: 30000 });

// build sample loans from public search results
const search = (q, type) => page.evaluate(([q, type]) => fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}`).then((r) => r.json()), [q, type]);
const audio = (await search('rasmus klump', 'audiobook')).works.filter((w) => w.cover).slice(0, 2);
const ebook = (await search('alfons åberg', 'ebook')).works.filter((w) => w.cover).slice(0, 1);
const books = (await search('pippi langstrømpe', 'book')).works.filter((w) => w.cover).slice(0, 3);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const sample = {
  digital: [
    ...audio.map((w, i) => ({ id: 'demo-a' + i, isbn: '0', kind: 'audiobook', title: w.title, author: w.creators.join(', '), end: day(18 + i * 5) + 'T22:59:59Z', duration: 7200, cover: w.cover })),
    ...ebook.map((w) => ({ id: 'demo-e0', isbn: '0', kind: 'ebook', title: w.title, author: w.creators.join(', '), end: day(26) + 'T22:59:59Z', duration: null, cover: w.cover })),
  ],
  physical: books.map((w, i) => ({ loanId: i + 1, dueDate: day([2, 9, 16][i]), isRenewable: i > 0, renewalStatus: [], work: w })),
  reservations: [],
  fees: 0,
};
await page.evaluate(() => localStorage.setItem('pos:demo-a0', '2650'));
await page.route('**/api/loans', (r) => r.fulfill({ json: sample }));
await page.route('**/api/me', (r) => r.fulfill({ json: { name: 'Eksempel' } }));

// 2. my loans
await page.goto(BASE + '/#/'); await page.reload(); await page.waitForSelector('.book'); await settle(2000); await shot('2-mine-laan');

// 3. live search with the audiobook filter
await page.click('#dock a[data-tab=search]'); await page.click('.filter[data-type=audiobook]');
await page.type('#q', 'rasmus klump', { delay: 50 }); await page.waitForSelector('#hits .row', { timeout: 20000 }); await settle(2000); await shot('3-soeg');
await page.click('.filter[data-type=""]');

// 4. a title page
await page.click('#hits .row'); await page.waitForSelector('.work-head', { timeout: 20000 }); await settle(2000); await shot('4-titel');

// 5. the player with a sleep timer running
await page.goto(BASE + '/#/listen/demo-a0'); await page.waitForSelector('#play'); await settle(1500);
await page.click('#sleep'); await page.click('[data-min="30"]'); await settle(3800); await shot('5-afspiller');

await page.unroute('**/api/loans'); await page.unroute('**/api/me');
await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
await browser.close();
