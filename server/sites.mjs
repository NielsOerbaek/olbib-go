// Biblo GO! runs one site per municipality (list from biblogo.dk, see tools/update-municipalities.mjs).
// Each GO page embeds its own settings ("dplCmsConfig"): login URL, library name, whether
// digital loans are enabled, Firebase settings and branches to leave out of availability.
// Settings are read from the page and kept in memory for a few hours (library config, not user data).
import fs from 'node:fs';
import { upstream } from './upstream.mjs';

export const MUNICIPALITIES = JSON.parse(fs.readFileSync(new URL('./municipalities.json', import.meta.url), 'utf8'));
const BY_ID = new Map(MUNICIPALITIES.map((m) => [m.id, m]));
export const DEFAULT_SITE = 'kobenhavn';
const TTL_MS = 6 * 3600_000;
const configs = new Map(); // id -> { at, config }

export class SiteError extends Error {
  constructor(msg) { super(msg); this.status = 502; }
}

export function municipality(id) {
  const m = BY_ID.get(id ?? DEFAULT_SITE);
  if (!m) { const e = new Error('Ukendt kommune'); e.status = 400; throw e; }
  return m;
}

// pull the JSON object that follows "dplCmsConfig": out of Next's RSC payload
function extractConfig(html) {
  const text = html.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
  const i = text.indexOf('"dplCmsConfig":');
  if (i < 0) return null;
  let start = text.indexOf('{', i), depth = 0;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (c === '"') { j++; while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; } continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, j + 1));
  }
  return null;
}

export async function site(id) {
  const m = municipality(id);
  const hit = configs.get(m.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site;
  const base = 'https://' + m.domain;
  const r = await upstream(base + '/', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OlbibGo)' } });
  const config = extractConfig(await r.text());
  if (!config?.loginUrls?.adgangsplatformen) throw new SiteError(`Kunne ikke læse opsætningen for ${m.label}`);
  const s = {
    id: m.id,
    label: m.label,
    base,
    libraryName: config.libraryInfo?.name ?? m.label,
    loginUrl: config.loginUrls.adgangsplatformen,
    logoutUrl: config.logoutUrls?.adgangsplatformen ?? null,
    digital: config.biblio?.enabled !== false,
    firebaseKey: config.biblio?.sdk?.firebaseApiKey ?? null,
    blacklistedBranches: new Set((config.blacklistedAvailabilityBranches ?? []).map((b) => b.replace(/^\D+-/, ''))),
  };
  configs.set(m.id, { at: Date.now(), site: s });
  return s;
}
