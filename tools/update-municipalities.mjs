// Refreshes server/municipalities.json from the municipality picker on biblogo.dk.
// The list lives in one of the site's JS bundles as {value, label, domain, secondaryDomains}.
import fs from 'node:fs';
const html = await (await fetch('https://biblogo.dk/')).text();
const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"]+\.js/g))];
let list = null;
for (const c of chunks) {
  const js = await (await fetch('https://biblogo.dk' + c)).text();
  const found = [...js.matchAll(/\{value:"([^"]+)",label:"([^"]+)",domain:"([^"]+)"/g)];
  if (found.length > 50) { list = found.map(([, value, label, domain]) => ({ id: value, label: label.trim(), domain: domain.replace(/\/$/, '') })); break; }
}
if (!list) throw new Error('municipality list not found on biblogo.dk');
list.sort((a, b) => a.label.localeCompare(b.label, 'da'));
fs.writeFileSync(new URL('../server/municipalities.json', import.meta.url), JSON.stringify(list, null, 1) + '\n');
console.log(list.length, 'municipalities');
