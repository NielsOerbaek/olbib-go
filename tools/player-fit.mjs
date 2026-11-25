// Checks the audiobook player fits without scrolling on small phones and the play icon is centred.
import fs from 'node:fs';
import { chromium, devices } from 'playwright-core';
const OUT = process.argv[2]; const BASE = process.env.BASE ?? 'http://127.0.0.1:3800';
const line = fs.readFileSync('capture/traffic.jsonl', 'utf8').split('\n').find((l) => l.includes('identityProviderCallback/borchk') && l.includes('"method":"POST"'));
const p = new URLSearchParams(JSON.parse(line).postData);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ ...devices['iPhone SE'] });
const page = await ctx.newPage();
await page.goto(BASE + '/'); await page.waitForSelector('#card');
await page.fill('#card', p.get('loginBibDkUserId')); await page.fill('#pin', p.get('pincode')); await page.click('button[type=submit]');
await page.waitForSelector('a.book[href^="#/listen"]', { timeout: 30000 });
const href = await page.getAttribute('a.book[href^="#/listen"]', 'href');
for (const [name, vp] of [['se', { width: 320, height: 568 }], ['8', { width: 375, height: 667 }], ['12', { width: 390, height: 844 }]]) {
  await page.setViewportSize(vp);
  await page.goto(BASE + '/' + href); await page.waitForSelector('#play'); await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const b = document.querySelector('#play').getBoundingClientRect(); const i = document.querySelector('#play svg')?.getBoundingClientRect();
    return { scroll: document.documentElement.scrollHeight, inner: innerHeight, dock: !document.querySelector('#dock').hidden,
      extrasBottom: Math.round(document.querySelector('.extras').getBoundingClientRect().bottom),
      iconOffset: i ? [Math.round((i.left + i.width / 2) - (b.left + b.width / 2)), Math.round((i.top + i.height / 2) - (b.top + b.height / 2))] : null };
  });
  console.log(name, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/fit-${name}.png` });
}
await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
await browser.close();
