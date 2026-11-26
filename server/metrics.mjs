// Anonymous counters: totals since start plus one bucket per minute for the last hour.
// Nothing here identifies a user: no ids, no IPs, no titles, no municipalities.
const started = Date.now();
const totals = {};
const minutes = []; // [{ t: minuteStartMs, ...counts }]
let inflightNow = 0, queuedNow = 0, inflightMax = 0, queuedMax = 0;

function bucket() {
  const t = Math.floor(Date.now() / 60_000) * 60_000;
  let b = minutes[minutes.length - 1];
  if (!b || b.t !== t) { b = { t }; minutes.push(b); while (minutes.length > 60) minutes.shift(); }
  return b;
}

export const metrics = {
  count(name, n = 1) {
    totals[name] = (totals[name] ?? 0) + n;
    const b = bucket(); b[name] = (b[name] ?? 0) + n;
  },
  inflight(active, queued) {
    inflightNow = active; queuedNow = queued;
    inflightMax = Math.max(inflightMax, active); queuedMax = Math.max(queuedMax, queued);
  },
  snapshot() {
    return {
      uptimeMinutes: Math.round((Date.now() - started) / 60_000),
      upstream: { inflight: inflightNow, queued: queuedNow, inflightMax, queuedMax },
      totals,
      lastHour: minutes.map(({ t, ...c }) => ({ minute: new Date(t).toISOString().slice(11, 16), ...c })),
    };
  },
};

// coarse route group for counting, never the id inside the path
export function routeGroup(pathname) {
  const m = pathname.match(/^\/api\/([a-z]+)/);
  return m ? m[1] : 'static';
}
