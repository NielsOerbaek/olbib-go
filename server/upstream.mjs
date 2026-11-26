// Every request to the library services goes through here, so we can
//  - cap how many run at once (all users share one IP towards the libraries), and
//  - count traffic without logging anything about who did what.
import { metrics } from './metrics.mjs';

const MAX_CONCURRENT = Number(process.env.LYD_UPSTREAM_CONCURRENCY ?? 12);
const MAX_QUEUE = Number(process.env.LYD_UPSTREAM_QUEUE ?? 200);
const QUEUE_TIMEOUT_MS = 20_000;

export class BusyError extends Error {
  constructor() { super('Der er travlt lige nu. Prøv igen om lidt.'); this.status = 503; }
}

let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENT) { active++; metrics.inflight(active, waiting.length); return Promise.resolve(); }
  if (waiting.length >= MAX_QUEUE) { metrics.count('upstream_rejected'); return Promise.reject(new BusyError()); }
  metrics.count('upstream_queued');
  return new Promise((resolve, reject) => {
    const entry = { resolve, timer: null };
    entry.timer = setTimeout(() => {
      const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1);
      metrics.count('upstream_rejected'); reject(new BusyError());
    }, QUEUE_TIMEOUT_MS);
    waiting.push(entry);
    metrics.inflight(active, waiting.length);
  });
}

function release() {
  const next = waiting.shift();
  if (next) { clearTimeout(next.timer); next.resolve(); } else active--;
  metrics.inflight(active, waiting.length);
}

// fetch() with the cap applied for the whole request, body included.
// Returns a Response whose body is already buffered.
export async function upstream(url, opts = {}) {
  await acquire();
  metrics.count('upstream_requests');
  try {
    const r = await fetch(url, opts);
    const body = Buffer.from(await r.arrayBuffer());
    if (r.status === 429) metrics.count('upstream_429');
    else if (r.status >= 500) metrics.count('upstream_5xx');
    const headers = new Headers(r.headers);
    const out = new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status, statusText: r.statusText, headers });
    Object.defineProperty(out, 'url', { value: r.url });
    return out;
  } catch (e) {
    metrics.count('upstream_network_errors');
    throw e;
  } finally {
    release();
  }
}
