// Olbib Go — alternate frontend for Biblo GO! (every municipality), built for old phones (iOS 16 Safari, PWA).
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  // triangle's centroid sits on x=12 so it reads as centred in a round button
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L9.2 4.1A.8.8 0 0 0 8 4.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4.5" width="4.5" height="15" rx="1.2"/><rect x="14" y="4.5" width="4.5" height="15" rx="1.2"/></svg>',
  ears: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="7" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.5"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/></svg>',
};

// ---------- api ----------
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { me = null; go('#/login'); throw new ApiError(401, 'Log ind igen'); }
  if (!r.ok) throw new ApiError(r.status, j.error || `Fejl (${r.status})`);
  return j;
}

// Report client-side problems to the server log (journalctl on box).
function report(kind, detail) {
  fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, detail: String(detail).slice(0, 500), ua: navigator.userAgent }) }).catch(() => {});
}
window.addEventListener('error', (e) => report('js', `${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => report('promise', e.reason?.message || e.reason));

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

const spinner = (label) => `<div class="loading"><span class="spin"></span>${label ? `<span>${esc(label)}</span>` : ''}</div>`;
// Put a button into a working state; returns a function that restores it.
function busy(btn, label) {
  const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${label ? ' ' + esc(label) : ''}`;
  return (newHtml) => { btn.disabled = false; btn.innerHTML = newHtml ?? html; };
}

// ---------- formatting ----------
const fmtDate = (d) => new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('da-DK', { day: 'numeric', month: 'long' });
const daysUntil = (d) => Math.ceil((new Date(d.length === 10 ? d + 'T23:59:59' : d) - Date.now()) / 864e5);
const fmtTime = (s) => {
  if (!isFinite(s)) return '–';
  s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
// square covers (audiobooks) get the .sq shape once the image tells us its size
window.sqCover = (img) => { if (Math.abs(img.naturalWidth - img.naturalHeight) < img.naturalWidth * 0.08) img.classList.add('sq'); };
const coverImg = (url, cls = 'cover', square = false) => url
  ? `<img class="${cls}${square ? ' sq' : ''}" src="${esc(url)}" alt="" loading="lazy" onload="sqCover(this)">`
  : `<div class="${cls} none${square ? ' sq' : ''}"></div>`;
const KIND = { audiobook: 'Lydbog', ebook: 'E-bog', podcast: 'Podcast' };
// One visual language for format everywhere: tomato + headphones = audio, pine + open book = e-book.
const kindOf = (s) => (/lydbog|audiobook|podcast/i.test(s) ? 'audio' : /e-bog|ebook/i.test(s) ? 'ebook' : null);
const kindChip = (label) => {
  const k = kindOf(label);
  const text = k === 'audio' ? 'Lydbog' : k === 'ebook' ? 'E-bog' : label === 'bog' ? 'Bog' : label;
  return `<span class="chip ${k ?? ''}">${k ? ICON[k === 'audio' ? 'ears' : 'open'] : ''}${esc(text)}</span>`;
};
const kindBadge = (kind) => {
  const k = kindOf(kind); if (!k) return '';
  return `<span class="badge ${k}" title="${k === 'audio' ? 'Lydbog' : 'E-bog'}">${ICON[k === 'audio' ? 'ears' : 'open']}</span>`;
};

// ---------- router ----------
let me; // undefined = unknown, null = logged out
let renderSeq = 0;
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };
function chrome({ title = null, back = false, tab = null, dock = true }) {
  $('#title').textContent = title ?? '';
  $('#title').hidden = !back;
  $('#brand').hidden = back;
  $('#back').hidden = !back;
  $('#dock').hidden = !me || !dock;
  document.body.classList.toggle('no-dock', !dock);
  document.querySelectorAll('#dock a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
}
$('#back').onclick = () => (history.length > 1 ? history.back() : go('#/'));

let meInfo = {}; // { name, library, goUrl, digital, site }
async function loadMe() {
  meInfo = await api('GET', '/me').catch(() => ({}));
  me = meInfo.loggedOut ? null : (meInfo.name ?? (meInfo.site ? 'dig' : null));
}

async function render() {
  const seq = ++renderSeq;
  const [, route, arg] = (location.hash || '#/').match(/^#\/([^/]*)\/?(.*)$/) || [];
  if (me === undefined) {
    view.innerHTML = spinner();
    await loadMe();
  }
  if (me === null && route !== 'login') return go('#/login');
  window.scrollTo(0, 0);
  // views call alive() after each await so a slow response never paints over a newer screen
  const alive = () => seq === renderSeq;
  try {
    if (route === 'login') return await viewLogin(alive);
    if (route === 'search') return await viewSearch(decodeURIComponent(arg || ''), alive);
    if (route === 'work') return await viewWork(decodeURIComponent(arg), alive);
    if (route === 'listen') return await viewListen(arg, alive);
    if (route === 'read') return viewRead();
    if (route === 'account') return viewAccount();
    return await viewLoans(alive);
  } catch (e) {
    if (e.status === 401 || !alive()) return;
    report('view', `${route}: ${e.message}`);
    view.innerHTML = `<p class="err">${esc(e.message)}</p><button class="btn" id="retry">Prøv igen</button>`;
    $('#retry').onclick = () => render();
  }
}
window.addEventListener('hashchange', render);

// ---------- views ----------
async function viewLogin(alive) {
  chrome({});
  const saved = localStorage.getItem('site') || '';
  view.innerHTML = `
    <div class="hello"><img src="/icon-180.png" alt=""><h2>Lydbøger fra biblioteket</h2><p>Lån og lyt til lydbøger fra Biblo GO! på en ældre telefon. Log ind med lånerkortet fra dit bibliotek.</p></div>
    <form class="card" autocomplete="on">
      <label for="site">Kommune</label>
      <div class="select-wrap"><select id="site" required disabled><option value="">Henter kommuner…</option></select><span class="spin" id="site-spin"></span></div>
      <label for="card">Lånernummer eller CPR</label>
      <input id="card" name="username" type="tel" inputmode="numeric" autocomplete="username" required>
      <label for="pin">Pinkode</label>
      <input id="pin" name="password" type="password" inputmode="numeric" autocomplete="current-password" required>
      <p class="err" id="err" hidden></p>
      <p style="margin:20px 0 0"><button class="btn go block" type="submit">Log ind</button></p>
      <p class="hint">Du bliver ved med at være logget ind på denne telefon. Olbib Go er ikke bibliotekets egen app.</p>
    </form>`;
  const sel = $('#site');
  try {
    const list = await api('GET', '/municipalities');
    if (!alive()) return;
    sel.innerHTML = '<option value="">Vælg kommune</option>' + list.map((m) => `<option value="${esc(m.id)}"${m.id === saved ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    sel.disabled = false;
  } catch (e) {
    sel.innerHTML = '<option value="">Kunne ikke hente kommuner</option>';
  }
  $('#site-spin').hidden = true;
  $('form', view).onsubmit = async (e) => {
    e.preventDefault();
    if (!sel.value) { $('#err').hidden = false; $('#err').textContent = 'Vælg din kommune.'; return; }
    const done = busy($('button', e.target), 'Logger ind');
    $('#err').hidden = true;
    try {
      await api('POST', '/login', { site: sel.value, card: $('#card').value, pin: $('#pin').value });
      localStorage.setItem('site', sel.value);
      await loadMe();
      go('#/');
    } catch (err) {
      $('#err').hidden = false; $('#err').textContent = err.message;
      done();
    }
  };
}

async function viewLoans(alive) {
  chrome({ tab: 'loans' });
  view.innerHTML = spinner('Henter dine lydbøger');
  const d = await api('GET', '/loans');
  if (!alive()) return;

  // Audiobooks are the point of the app: a two-column grid up top.
  const audio = d.digital.filter((l) => l.kind === 'audiobook');
  const grid = audio.map((l) => {
    const pos = Number(localStorage.getItem('pos:' + l.id) || 0);
    const pct = pos && l.duration ? Math.min(100, Math.round((pos / l.duration) * 100)) : null;
    return `<a class="book" href="#/listen/${l.id}">
      ${coverImg(l.cover, 'cover', true)}
      ${pct !== null ? `<div class="bar" aria-label="${pct} procent hørt"><i style="width:${pct}%"></i></div>` : ''}
      <div class="t">${esc(l.title)}</div>
      <div class="s">Til ${fmtDate(l.end)}</div>
    </a>`;
  }).join('');

  // Everything else lives in a collapsed list underneath: shown, but not the focus.
  const ebooks = d.digital.filter((l) => l.kind !== 'audiobook').map((l) => `<a class="row" href="#/read/${l.id}">
      ${coverImg(l.cover)}
      <div class="meta"><div class="t">${esc(l.title)}</div><div class="s">${esc(l.author || '')}</div>
      <div class="chips">${kindChip('e-bog')}<span class="chip">Til ${fmtDate(l.end)}</span></div></div>
    </a>`).join('');

  const physical = d.physical.map((l) => {
    const days = daysUntil(l.dueDate);
    const chip = days < 0 ? `<span class="chip hot">For sent, skulle afleveres ${fmtDate(l.dueDate)}</span>`
      : days <= 3 ? `<span class="chip sun">Afleveres ${days === 0 ? 'i dag' : fmtDate(l.dueDate)}</span>`
      : `<span class="chip">Afleveres ${fmtDate(l.dueDate)}</span>`;
    return `<div class="row">
      ${coverImg(l.work.cover)}
      <div class="meta"><div class="t">${esc(l.work.title)}</div><div class="s">${esc((l.work.creators || []).join(', '))}</div>
      <div class="chips">${chip}</div></div>
    </div>`;
  }).join('');

  const STATE = { readyForPickup: 'Klar til at hente', reserved: 'Reserveret', inTransit: 'På vej', interLibraryReservation: 'Bestilt fra andet bibliotek' };
  const resv = d.reservations.map((r) => `<div class="row">
      ${coverImg(r.work.cover)}
      <div class="meta"><div class="t">${esc(r.work.title)}</div>
      <div class="chips"><span class="chip ${r.state === 'readyForPickup' ? 'ok' : ''}">${STATE[r.state] ?? esc(r.state)}</span>
      ${r.numberInQueue ? `<span class="chip">Nr. ${r.numberInQueue} i køen</span>` : ''}
      ${r.pickupDeadline ? `<span class="chip sun">Hent senest ${fmtDate(r.pickupDeadline)}</span>` : ''}
      ${r.pickupNumber ? `<span class="chip">Hyldenr. ${esc(r.pickupNumber)}</span>` : ''}</div></div>
      <button class="btn small" data-cancel="${r.id}">Slet</button>
    </div>`).join('');

  const otherCount = d.digital.length - audio.length + d.physical.length + d.reservations.length;
  const anyLate = d.physical.some((l) => daysUntil(l.dueDate) <= 3) || d.reservations.some((r) => r.state === 'readyForPickup');
  view.innerHTML = `
    <h2>Dine lydbøger</h2>
    ${grid ? `<div class="grid">${grid}</div>`
      : '<div class="empty-box"><p>Du har ingen lydbøger lånt lige nu.</p><a class="btn audio" href="#/search">' + ICON.ears + 'Find en lydbog</a></div>'}
    ${otherCount ? `<details class="more" id="more"${localStorage.getItem('moreOpen') === '1' ? ' open' : ''}>
      <summary><span>Andre lån</span><span class="chip${anyLate ? ' sun' : ''}">${otherCount}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
      <p class="more-note">E-bøger og bøger kan hverken lånes eller fornyes her. Det gør du i GO.</p>
      ${ebooks ? `<h3>E-bøger</h3><div class="rows">${ebooks}</div>` : ''}
      ${physical ? `<h3>Bøger derhjemme</h3><div class="rows">${physical}</div>` : ''}
      ${resv ? `<h3>Reserveret</h3><div class="rows">${resv}</div>` : ''}
    </details>` : ''}
    ${d.fees ? `<h2>Gebyrer</h2><p class="err">Du skylder ${d.fees} kr.</p>` : ''}
`;
  $('#more')?.addEventListener('toggle', (e) => localStorage.setItem('moreOpen', e.target.open ? '1' : '0'));

  view.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Sikker?'; return; }
    const done = busy(b);
    try { await api('DELETE', '/reservations/' + b.dataset.cancel); toast('Reservering slettet'); viewLoans(alive); }
    catch (e) { toast(e.message); done('Slet'); }
  }));
}

const sortTypes = (types) => {
  const rank = (t) => (kindOf(t) === 'audio' ? 0 : kindOf(t) === 'ebook' ? 1 : 2);
  const seen = new Set();
  return [...types].sort((a, b) => rank(a) - rank(b)).filter((t) => { const k = kindOf(t) ?? t; if (seen.has(k)) return false; seen.add(k); return true; });
};
const FILTERS = [['audiobook', 'Lydbøger'], ['', 'Alt']];
// Search as you type: debounced, and only the newest query may paint results.
async function viewSearch(q, alive) {
  chrome({ tab: 'search' });
  view.innerHTML = `
    <form class="searchbar"><input type="search" id="q" placeholder="Søg efter en lydbog" value="${esc(q)}" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false"><span class="spin" id="qspin" hidden></span></form>
    <div class="filters" role="radiogroup" aria-label="Vis kun">${FILTERS.map(([k, label]) =>
      `<button type="button" role="radio" class="filter" data-type="${k}">${label}</button>`).join('')}</div>
    <div id="results"></div>`;
  const input = $('#q'); const results = $('#results'); const qspin = $('#qspin');
  let type = localStorage.getItem('searchFilter') ?? 'audiobook';
  const markFilters = () => view.querySelectorAll('.filter').forEach((b) => {
    b.classList.toggle('on', b.dataset.type === type); b.setAttribute('aria-checked', String(b.dataset.type === type));
  });
  markFilters();
  view.querySelectorAll('.filter').forEach((b) => (b.onclick = () => {
    type = b.dataset.type; localStorage.setItem('searchFilter', type); markFilters();
    const text = current; current = null; run(text ?? input.value);
  }));
  let seq = 0; let timer = null; let offset = 0; let current = '';

  const paint = (r, append) => {
    if (!append) {
      if (!r.works.length) { results.innerHTML = '<p class="empty">Ingen bøger matcher. Prøv et andet ord.</p>'; return; }
      results.innerHTML = `<p class="count">${r.hitcount} ${r.hitcount === 1 ? 'resultat' : 'resultater'}</p><div class="rows" id="hits"></div>`;
    }
    $('#hits').insertAdjacentHTML('beforeend', r.works.map((w) => `<a class="row" href="#/work/${encodeURIComponent(w.id)}">
      ${coverImg(w.cover)}<div class="meta"><div class="t">${esc(w.title)}</div><div class="s">${esc(w.creators.join(', '))}${w.year ? ', ' + esc(w.year) : ''}</div>
      <div class="chips">${sortTypes(w.types).map(kindChip).join('')}</div></div></a>`).join(''));
    offset += r.works.length;
    if (offset < r.hitcount && r.works.length) {
      results.insertAdjacentHTML('beforeend', '<p style="text-align:center;margin-top:18px"><button class="btn" id="more">Vis flere</button></p>');
      $('#more').onclick = async (e) => {
        const btn = e.currentTarget; const done = busy(btn, 'Henter'); const my = seq;
        try {
          const r2 = await api('GET', `/search?q=${encodeURIComponent(current)}&offset=${offset}&type=${type}`);
          if (my !== seq || !alive()) return;
          btn.parentElement.remove(); paint(r2, true);
        } catch (err) { toast(err.message); done(); }
      };
    }
  };

  const run = async (text) => {
    text = text.trim();
    if (text === current) return;
    current = text; offset = 0;
    const my = ++seq;
    history.replaceState(null, '', text ? '#/search/' + encodeURIComponent(text) : '#/search');
    if (text.length < 2) { results.innerHTML = ''; qspin.hidden = true; return; }
    if (!$('#hits')) results.innerHTML = spinner('Søger');
    qspin.hidden = false;
    try {
      const r = await api('GET', `/search?q=${encodeURIComponent(text)}&offset=0&type=${type}`);
      if (my !== seq || !alive()) return;
      paint(r, false);
    } catch (e) {
      if (my === seq && alive()) results.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    } finally {
      if (my === seq) qspin.hidden = true;
    }
  };

  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 350); };
  $('form', view).onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); input.blur(); run(input.value); };
  if (q) await run(q); else input.focus();
}

async function viewWork(id, alive) {
  chrome({ back: true });
  view.innerHTML = spinner('Henter bogen');
  const w = await api('GET', '/work/' + encodeURIComponent(id));
  if (!alive()) return;
  $('#title').textContent = w.title;
  const audio = w.digital.find((d) => d.kind === 'audiobook');
  const action = audio
    ? (audio.loan
      ? `<a class="btn block audio" href="#/listen/${audio.loan}">${ICON.ears}Lyt til lydbogen</a>`
      : `<button class="btn block audio" data-borrow="${esc(audio.isbn)}">${ICON.ears}Lån lydbogen</button>`)
    : `<p class="status">Den findes ikke som lydbog${meInfo.digital === false ? ' hos dit bibliotek' : ''}.</p>`;
  const also = [w.digital.some((d) => d.kind === 'ebook') && 'e-bog', w.physical.length && 'bog'].filter(Boolean);
  const alsoNote = also.length
    ? `<p class="status">Findes også som ${also.join(' og ')}. ${meInfo.goUrl ? `Den kan du låne i <a href="${esc(meInfo.goUrl)}/work/${encodeURIComponent(w.id)}" target="_blank" rel="noopener">GO</a>.` : 'Den kan du låne i GO.'}</p>`
    : '';
  view.innerHTML = `
    <div class="work-head">${coverImg(w.cover, 'cover big', w.digital.length === 1 && w.digital[0].kind === 'audiobook' && !w.physical.length)}
      <h2>${esc(w.title)}</h2>
      <div class="by">${esc(w.creators.join(', '))}${w.year ? ', ' + esc(w.year) : ''}</div>
      <div class="chips">${sortTypes(w.types).map(kindChip).join('')}${w.series ? `<span class="chip">${esc(w.series.title)} ${esc(w.series.numberInSeries || '')}</span>` : ''}${w.ages ? `<span class="chip sun">${esc(w.ages)} år</span>` : ''}</div>
    </div>
    <div class="actions">${action}${alsoNote}</div>
    ${w.abstract ? `<div class="abstract">${esc(w.abstract)}</div>` : ''}`;
  view.querySelectorAll('[data-borrow]').forEach((b) => (b.onclick = async () => {
    const done = busy(b, 'Låner');
    try {
      const r = await api('POST', '/borrow', { isbn: b.dataset.borrow });
      if (r.id) { toast('Lånt!'); go(`#/listen/${r.id}`); }
      else { toast(`Kunne ikke låne (${r.status})`); done(); }
    } catch (e) { toast(e.message); done(); }
  }));
}

function viewRead() {
  chrome({ back: true, title: 'E-bog' });
  view.innerHTML = `<div class="hello"><h2>Læs e-bogen i GO</h2>
    <p>Olbib Go er til lydbøger. E-bøger er kopibeskyttede og kan kun læses i bibliotekets egen læser.</p></div>
    ${meInfo.goUrl ? `<p style="margin-top:22px"><a class="btn go block" href="${esc(meInfo.goUrl)}/user/profile" target="_blank" rel="noopener">Åbn i GO</a></p>` : ''}`;
}

function viewAccount() {
  chrome({ tab: 'account' });
  view.innerHTML = `<div class="hello"><img src="/icon-180.png" alt=""><h2>${esc(me)}</h2><p>Logget ind med dit lånerkort${meInfo.library ? ` hos ${esc(meInfo.library)}` : ''}.</p></div>
    <p style="margin-top:22px"><button class="btn block" id="logout">Log ud</button></p>`;
  $('#logout').onclick = async (e) => { busy(e.currentTarget, 'Logger ud'); player.stop(); await api('POST', '/logout').catch(() => {}); me = null; meInfo = {}; go('#/login'); };
}

// ---------- audiobook player ----------
const audio = $('#audio');
// Safari (incl. iOS 16) plays HLS natively. Other browsers need hls.js, loaded lazily
// so the old iPhone never downloads it.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const SAFARI = /^((?!chrome|android|firefox).)*safari/i.test(navigator.userAgent);
const useHlsJs = !IOS && !SAFARI && !!window.MediaSource;
let hlsLoading = null;
const loadHlsJs = () => hlsLoading || (hlsLoading = new Promise((resolve, reject) => {
  const sc = document.createElement('script'); sc.src = '/vendor/hls.min.js';
  sc.onload = resolve; sc.onerror = () => { hlsLoading = null; reject(new Error('Kunne ikke hente afspilleren')); };
  document.head.appendChild(sc);
}));

// iOS only lets audio start inside the tap itself, so the playlist ticket is fetched
// ahead of time (when the player screen opens) and play() is called synchronously.
const player = {
  loan: null, // {id, title, author, cover}
  prepared: null, // {loanId, url, at}
  preparing: null,
  hls: null,
  sleepAt: null,
  saveTimer: null,
  prepare(loan) {
    if (this.ready(loan)) return Promise.resolve(this.prepared);
    if (this.preparing?.loanId === loan.id) return this.preparing.p;
    const p = Promise.all([api('POST', `/audio/${loan.id}/ticket`), useHlsJs ? loadHlsJs() : null])
      .then(([{ url }]) => (this.prepared = { loanId: loan.id, url, at: Date.now() }))
      .finally(() => { if (this.preparing?.p === p) this.preparing = null; updatePlayerView(); });
    this.preparing = { loanId: loan.id, p };
    return p;
  },
  ready(loan) { return this.prepared?.loanId === loan.id && Date.now() - this.prepared.at < 20 * 60_000; },
  // must be called synchronously from a tap
  start(loan) {
    if (this.loan) this.stop();
    this.loan = loan;
    localStorage.setItem('last', JSON.stringify(loan));
    const url = this.prepared.url; this.prepared = null;
    const pos = Number(localStorage.getItem('pos:' + loan.id) || 0);
    if (pos > 3) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = pos - 3; } catch {} }, { once: true });
    if (useHlsJs) {
      const hls = (this.hls = new window.Hls());
      hls.on(window.Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        report('hls', `${d.type} ${d.details} ${d.response?.code ?? ''}`);
        toast('Afspilningsfejl: ' + d.details);
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
    } else {
      audio.src = url;
    }
    audio.playbackRate = audio.defaultPlaybackRate = Number(localStorage.getItem('rate') || 1);
    audio.play().catch((e) => { report('play', e.name + ': ' + e.message); toast('Kunne ikke afspille: ' + e.message); });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: loan.title, artist: loan.author || '', artwork: loan.cover ? [{ src: new URL(loan.cover, location.href).href, sizes: '200x200', type: 'image/jpeg' }] : [],
      });
    }
    this.mini();
  },
  save() { if (this.loan && audio.currentTime > 0) localStorage.setItem('pos:' + this.loan.id, String(Math.floor(audio.currentTime))); },
  toggle() {
    if (audio.paused) audio.play().catch((e) => { report('play', e.name + ': ' + e.message); toast('Kunne ikke afspille: ' + e.message); });
    else audio.pause();
  },
  skip(s) { audio.currentTime = Math.max(0, Math.min((audio.duration || 1e9) - 1, audio.currentTime + s)); this.save(); },
  stop() {
    this.save(); audio.pause(); this.setSleep(null);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    audio.removeAttribute('src'); audio.load(); this.loan = null; this.mini();
  },
  // ---- sleep timer ----
  setSleep(min) {
    this.sleepAt = min ? Date.now() + min * 60_000 : null;
    clearInterval(this.sleepTick);
    if (this.sleepAt) this.sleepTick = setInterval(() => this.checkSleep(), 1000);
    this.mini(); updatePlayerView();
  },
  checkSleep() {
    if (!this.sleepAt) return;
    if (Date.now() >= this.sleepAt) {
      this.setSleep(null); audio.pause(); this.save();
      toast('Sov godt. Lydbogen holder pause.');
    } else { this.mini(); updatePlayerView(); }
  },
  sleepLeft() { return this.sleepAt ? fmtTime((this.sleepAt - Date.now()) / 1000) : null; },
  mini() {
    const on = !!this.loan && !location.hash.startsWith('#/listen');
    $('#mini').hidden = !on;
    document.body.classList.toggle('with-mini', on);
    if (!this.loan) return;
    $('#mini-title').textContent = this.loan.title;
    $('#mini-cover').src = this.loan.cover || '';
    $('#mini-time').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}${this.sleepAt ? `   Sover om ${this.sleepLeft()}` : ''}`;
    $('#mini-toggle').innerHTML = audio.paused ? ICON.play : ICON.pause;
    $('#mini-toggle').setAttribute('aria-label', audio.paused ? 'Afspil' : 'Pause');
  },
};
audio.addEventListener('timeupdate', () => { player.checkSleep(); player.mini(); updatePlayerView(); });
audio.addEventListener('play', () => { player.mini(); updatePlayerView(); clearInterval(player.saveTimer); player.saveTimer = setInterval(() => player.save(), 5000); });
audio.addEventListener('pause', () => { player.save(); clearInterval(player.saveTimer); player.mini(); updatePlayerView(); });
audio.addEventListener('waiting', () => updatePlayerView());
audio.addEventListener('playing', () => updatePlayerView());
audio.addEventListener('ended', () => { player.save(); updatePlayerView(); });
audio.addEventListener('error', () => {
  if (!player.loan) return;
  const err = audio.error;
  report('audio', `code=${err?.code} ${err?.message || ''} src=${audio.currentSrc.includes('/api/audio/') ? 'ticket' : audio.currentSrc.slice(0, 12)}`);
  // usually an expired ticket after a long pause: fetch a new one, then the next tap plays from the saved spot
  const loan = player.loan; player.save(); player.loan = null;
  if (player.hls) { player.hls.destroy(); player.hls = null; }
  audio.removeAttribute('src');
  player.mini(); updatePlayerView();
  player.prepare(loan).then(() => toast('Tryk på afspil igen')).catch((e) => toast(e.message));
});
window.addEventListener('pagehide', () => player.save());
document.addEventListener('visibilitychange', () => document.hidden && player.save());
$('#mini-toggle').onclick = () => (player.loan && audio.src ? player.toggle() : null);
$('#mini-open').onclick = () => player.loan && go('#/listen/' + player.loan.id);
window.addEventListener('hashchange', () => { player.mini(); $('#sheet').hidden = true; });  // dock state is reset by chrome()
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play());
  ms.setActionHandler('pause', () => audio.pause());
  try { ms.setActionHandler('seekbackward', () => player.skip(-30)); ms.setActionHandler('seekforward', () => player.skip(30)); } catch {}
}

const RATES = [0.75, 1, 1.25, 1.5];
const SLEEP_OPTS = [5, 10, 15, 30, 45, 60];
async function viewListen(id, alive) {
  chrome({ back: true, title: 'Lydbog', dock: false });
  let loan = player.loan?.id === id ? player.loan : null;
  if (!loan) {
    const last = JSON.parse(localStorage.getItem('last') || 'null');
    if (last?.id === id) loan = last;
    else {
      view.innerHTML = spinner('Henter lydbogen');
      const d = await api('GET', '/loans');
      if (!alive()) return;
      const l = d.digital.find((x) => x.id === id);
      if (!l) { view.innerHTML = '<p class="empty">Lånet er udløbet.</p>'; return; }
      loan = { id: l.id, title: l.title, author: l.author, cover: l.cover };
    }
  }
  $('#title').textContent = loan.title;
  view.innerHTML = `
    <div class="player" data-loan="${esc(loan.id)}">
      ${coverImg(loan.cover, 'cover big', true)}
      <h2>${esc(loan.title)}</h2><div class="by">${esc(loan.author || '')}</div>
      <div class="scrub"><input type="range" id="seek" min="0" max="1000" step="1" value="0" aria-label="Spol">
        <div class="times"><span id="cur">0:00</span><span id="left">–</span></div></div>
      <div class="controls">
        <button class="skip" id="back30" aria-label="30 sekunder tilbage">−30</button>
        <button class="play" id="play" aria-label="Afspil"></button>
        <button class="skip" id="fwd30" aria-label="30 sekunder frem">+30</button>
      </div>
      <div class="extras">
        <button class="btn small" id="rate">${ICON.gauge}<span>${audio.playbackRate || 1}×</span></button>
        <button class="btn small" id="sleep">${ICON.moon}<span>Sov</span></button>
      </div>
    </div>`;
  $('#play').onclick = () => {
    if (player.loan?.id === loan.id && audio.src) return player.toggle();
    if (player.ready(loan)) return player.start(loan);
    toast('Lydbogen hentes. Tryk igen om lidt.');
    player.prepare(loan).catch((e) => toast(e.message));
  };
  $('#back30').onclick = () => player.loan?.id === loan.id && player.skip(-30);
  $('#fwd30').onclick = () => player.loan?.id === loan.id && player.skip(30);
  $('#rate').onclick = () => {
    const next = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1;
    audio.playbackRate = audio.defaultPlaybackRate = next; localStorage.setItem('rate', String(next));
    $('#rate span').textContent = next + '×';
  };
  $('#sleep').onclick = openSleepSheet;
  const seek = $('#seek');
  seek.oninput = () => { seeking = true; $('#cur').textContent = fmtTime((seek.value / 1000) * audio.duration); seek.style.setProperty('--p', seek.value / 10 + '%'); };
  seek.onchange = () => {
    seeking = false;
    if (player.loan?.id === loan.id && isFinite(audio.duration)) { audio.currentTime = (seek.value / 1000) * audio.duration; player.save(); }
  };
  if (player.loan?.id !== loan.id) player.prepare(loan).catch((e) => toast(e.message));
  updatePlayerView();
}

function openSleepSheet() {
  const sheet = $('#sheet');
  sheet.innerHTML = `<h3>Stop afspilning om</h3>
    <div class="opts">${SLEEP_OPTS.map((m) => `<button class="btn" data-min="${m}">${m} min</button>`).join('')}</div>
    <div class="sheet-foot">${player.sleepAt ? '<button class="btn" data-min="0">Slå fra</button>' : ''}<button class="btn" id="sheet-close">Luk</button></div>`;
  const dockWas = $('#dock').hidden;
  sheet.hidden = false; $('#dock').hidden = true;
  const close = () => { sheet.hidden = true; $('#dock').hidden = dockWas; };
  sheet.querySelectorAll('[data-min]').forEach((b) => (b.onclick = () => {
    const m = Number(b.dataset.min);
    player.setSleep(m);
    close();
    toast(m ? `Stopper om ${m} min` : 'Søvntimer slået fra');
  }));
  $('#sheet-close').onclick = close;
}

let seeking = false;
function updatePlayerView() {
  const box = $('.player'); if (!box) return;
  const id = box.dataset.loan;
  const mine = player.loan?.id === id;
  const play = $('#play');
  const loadingNow = (mine && !audio.paused && audio.readyState < 3) || (!mine && player.preparing?.loanId === id);
  const state = loadingNow ? 'load' : mine && !audio.paused ? 'pause' : 'play';
  if (play.dataset.state !== state) {
    play.dataset.state = state;
    play.innerHTML = state === 'load' ? '<span class="spin"></span>' : state === 'pause' ? ICON.pause : ICON.play;
    play.setAttribute('aria-label', state === 'pause' ? 'Pause' : 'Afspil');
  }
  const cur = mine ? audio.currentTime : Number(localStorage.getItem('pos:' + id) || 0);
  const dur = mine ? audio.duration : NaN;
  $('#cur').textContent = fmtTime(cur);
  $('#left').textContent = isFinite(dur) ? '−' + fmtTime(dur - cur) : '–';
  if (!seeking && isFinite(dur)) { const p = (cur / dur) * 1000; $('#seek').value = String(p); $('#seek').style.setProperty('--p', p / 10 + '%'); }
  const sl = $('#sleep');
  sl.classList.toggle('sleeping', !!player.sleepAt);
  $('#sleep span').textContent = player.sleepAt ? player.sleepLeft() : 'Sov';
}

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
