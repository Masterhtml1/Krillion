/* Krillion UI: screens, dive flow, depth visuals, persistence. */
(function () {
  'use strict';

  const K = window.Krillion;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------- storage --

  const STORE_KEY = 'krillion:v1';
  const DEFAULT_STORE = () => ({
    daily: {},      // diveNo -> { results: [...], inFlight: index|null, done: bool }
    archive: {},    // diveNo -> best { score, depth, emoji }
    recent: [],     // prompt ids played recently, to avoid repeats outside the daily
    records: { endlessDepth: 0, endlessPrompts: 0, unlimitedBest: 0, unlimitedPlayed: 0, endlessPlayed: 0 },
    packBest: {},   // packId -> best depth
    seenHelp: false,
  });

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && typeof raw === 'object') {
        const d = DEFAULT_STORE();
        return Object.assign(d, raw, { records: Object.assign(d.records, raw.records || {}) });
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return DEFAULT_STORE();
  }
  let store = loadStore();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ }
  }

  function rememberRecent(id) {
    store.recent = store.recent.filter((x) => x !== id);
    store.recent.push(id);
    const cap = Math.floor(K.prompts.length * 0.7);
    if (store.recent.length > cap) store.recent = store.recent.slice(-cap);
  }

  // ------------------------------------------------------------- helpers --

  const tierOf = (t) => (t >= 0 ? K.TIERS[t] : K.MISS);
  const packOf = (id) => K.packs.find((p) => p.id === id);
  const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function animateNumber(el, from, to, ms, fmt) {
    if (reduceMotion || ms <= 0 || from === to) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }

  const QUIPS = {
    plankton: ['Plankton. The whole shoal said that one.', 'Safe, sunny and very, very shallow.', 'Everyone and their krill said that.'],
    clever: ['Too Clever! Everyone thought they were the only one.', 'The "rare" pick that wasn\'t. Classic.', 'Half the ocean had the same clever idea.'],
    schooler: ['Swimming with the school. Respectable.', 'A solid answer. The light is starting to dim.', 'Not common, not rare. Good honest krill work.'],
    rare: ['Ooh, rare. You\'re sinking nicely.', 'Few divers made it down here.', 'Now we\'re getting somewhere dark.'],
    deep: ['Deep cut! The anglerfish are watching.', 'You\'ve left the sunlight far behind.', 'That one goes in the dive log.'],
    krillion: ['ONE IN A KRILLION. The trench salutes you.', 'Nobody says that. Nobody except you.', 'Absolute abyss-level answer.'],
    miss: ['Out of air on that one.', 'Bubbles... and nothing. Next!', 'The current got you. Shake it off.'],
  };

  // ------------------------------------------------------------ sea / fx --

  const fx = { depth: 0, boost: 0, parts: [], w: 0, h: 0, dpr: 1, last: 0 };
  const canvas = $('#particles');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    fx.dpr = Math.min(2, window.devicePixelRatio || 1);
    fx.w = window.innerWidth; fx.h = window.innerHeight;
    canvas.width = fx.w * fx.dpr; canvas.height = fx.h * fx.dpr;
    ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
    const want = Math.round(Math.min(140, (fx.w * fx.h) / 9000));
    while (fx.parts.length < want) fx.parts.push(spawn(true));
    fx.parts.length = want;
  }

  function spawn(anywhere) {
    const r = Math.random();
    const type = r < 0.32 ? 'bubble' : r < 0.82 ? 'snow' : 'glow';
    return {
      type,
      x: Math.random() * fx.w,
      y: anywhere ? Math.random() * fx.h : (type === 'snow' ? -10 : fx.h + 10),
      r: type === 'bubble' ? 1.5 + Math.random() * 4 : type === 'snow' ? 0.6 + Math.random() * 1.6 : 1.2 + Math.random() * 2.2,
      v: type === 'bubble' ? 18 + Math.random() * 40 : 4 + Math.random() * 10,
      sway: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.5 ? 180 : 150 + Math.random() * 60,
    };
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function frame(now) {
    const dt = Math.min(0.05, (now - (fx.last || now)) / 1000);
    fx.last = now;
    fx.boost *= Math.pow(0.12, dt);
    ctx.clearRect(0, 0, fx.w, fx.h);
    const d = fx.depth;
    const alpha = {
      bubble: Math.max(0.22, 1 - d / 2500),
      snow: clamp01((d - 120) / 1400) * 0.85,
      glow: clamp01((d - 800) / 2200),
    };
    for (let i = 0; i < fx.parts.length; i++) {
      const p = fx.parts[i];
      p.sway += dt * 1.3;
      const rise = fx.boost * (0.6 + p.r / 5);
      if (p.type === 'bubble') p.y -= (p.v + rise) * dt;
      else p.y += (p.v - rise) * dt;
      p.x += Math.sin(p.sway) * dt * (p.type === 'bubble' ? 10 : 4);
      if (p.y < -20 || p.y > fx.h + 20) { fx.parts[i] = spawn(false); if (fx.boost > 30) fx.parts[i].y = fx.h + 10; continue; }
      const a = alpha[p.type];
      if (a <= 0.01) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      if (p.type === 'bubble') {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * a) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (p.type === 'snow') {
        ctx.fillStyle = 'rgba(220,235,255,' + (0.55 * a) + ')';
        ctx.fill();
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(p.sway * 1.7);
        ctx.shadowBlur = 12;
        ctx.shadowColor = 'hsla(' + p.hue + ',100%,65%,' + a + ')';
        ctx.fillStyle = 'hsla(' + p.hue + ',100%,70%,' + (a * (0.35 + 0.65 * pulse)) + ')';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  let shownDepth = 0;
  function setDepth(depth, opts) {
    opts = opts || {};
    const prev = shownDepth;
    shownDepth = depth;
    fx.depth = depth;
    const c = K.seaColors(depth);
    root.style.setProperty('--sea-top', 'rgb(' + c.top.join(',') + ')');
    root.style.setProperty('--sea-bot', 'rgb(' + c.bot.join(',') + ')');
    root.style.setProperty('--rays', String(clamp01(1 - depth / 900)));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', 'rgb(' + c.top.join(',') + ')');
    const gauge = $('#gauge');
    gauge.style.setProperty('--g', String(K.gaugePos(depth)));
    animateNumber($('.gauge-depth'), prev, depth, opts.animate ? 1400 : 0, K.formatDepth);
    $('.gauge-zone').textContent = K.zoneFor(depth).name;
    if (opts.animate && depth > prev && !reduceMotion) fx.boost = Math.min(420, 90 + (depth - prev) / 3);
  }

  function buildGauge() {
    $('.gauge-zones').innerHTML = K.ZONES.map((z) => '<span title="' + esc(z.name) + '"></span>').join('');
  }

  // ------------------------------------------------------------- screens --

  let current = 'home';
  function show(name) {
    current = name;
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    const diving = name === 'dive' || name === 'results';
    $('#gauge').hidden = !diving;
    document.body.classList.toggle('diving', diving);
    if (!diving) { stopTimer(); setDepth(0); }
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // ---------------------------------------------------------------- home --

  function tickCountdowns() {
    const txt = fmtCountdown(K.msUntilNextDive());
    document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = txt; });
    const today = K.diveNumber();
    if (today !== renderedToday && current === 'home') renderHome();
  }
  let renderedToday = 0;

  function dailyEntry(n) { return store.daily[n]; }
  function resultsScore(results) { return results.reduce((s, r) => s + r.points, 0); }
  function resultsEmoji(results) { return results.map((r) => tierOf(r.tier).emoji).join(''); }

  function renderHome() {
    const n = K.diveNumber();
    renderedToday = n;
    $('#home-dive-label').textContent = 'Daily Dive #' + n;
    $('#home-dive-date').textContent = K.diveDateLabel(n, { weekday: 'long', month: 'long', day: 'numeric', year: undefined });
    const e = dailyEntry(n);
    const body = $('#home-daily-body');
    if (e && e.done) {
      const score = resultsScore(e.results);
      body.innerHTML =
        '<div class="daily-done">' +
          '<div class="done-line"><span class="done-depth">' + K.formatDepth(score * K.METERS_PER_POINT) + '</span>' +
          '<span class="done-emoji">' + resultsEmoji(e.results) + '</span></div>' +
          '<div class="done-next">' + score + ' / ' + K.MAX_SCORE + ' points · Next dive in <b data-countdown>' + fmtCountdown(K.msUntilNextDive()) + '</b></div>' +
          '<div class="daily-actions"><button class="btn btn-primary" data-action="daily-results">See results</button>' +
          '<button class="btn" data-action="daily-share">Share</button></div>' +
        '</div>';
    } else if (e && e.results.length) {
      body.innerHTML = '<button class="btn btn-primary btn-wide" data-action="daily">Continue dive · ' +
        e.results.length + ' / ' + K.PROMPTS_PER_DIVE + ' done</button>';
    } else {
      body.innerHTML = '<button class="btn btn-primary btn-wide" data-action="daily">Start today\'s dive ↓</button>';
    }
    $('#home-pack-count').textContent = K.packs.length + ' packs · ' + K.prompts.length + ' prompts';
  }

  // --------------------------------------------------------------- packs --

  function renderPacks() {
    $('#pack-grid').innerHTML = K.packs.map((p) => {
      const best = store.packBest[p.id];
      return '<button class="pack-card" data-pack="' + esc(p.id) + '">' +
        '<span class="pe">' + p.emoji + '</span>' +
        '<span class="pn">' + esc(p.name) + '</span>' +
        '<span class="pd">' + esc(p.blurb) + '</span>' +
        '<span class="pc">' + p.prompts.length + ' prompts</span>' +
        (best ? '<span class="pb">Best: ' + K.formatDepth(best) + '</span>' : '') +
        '</button>';
    }).join('');
  }

  // ------------------------------------------------------------- archive --

  function renderArchive() {
    const today = K.diveNumber();
    const tiles = [];
    for (let n = today; n >= 1; n--) {
      const e = store.daily[n];
      const a = store.archive[n];
      let status = '<span class="as unplayed">' + (n === today ? 'Today · Play' : 'Play') + '</span>';
      if (e && e.done) status = '<span class="as">' + K.formatDepth(resultsScore(e.results) * K.METERS_PER_POINT) + '</span>';
      else if (a) status = '<span class="as">' + K.formatDepth(a.depth) + ' <small>(replay)</small></span>';
      tiles.push('<button class="arch' + (n === today ? ' today' : '') + '" data-archive="' + n + '">' +
        '<span class="an">#' + n + '</span><span class="ad">' + K.diveDateLabel(n) + '</span>' + status + '</button>');
    }
    $('#archive-grid').innerHTML = tiles.join('');
  }

  // ---------------------------------------------------------------- dive --

  let dive = null;
  let timerRaf = null;

  function newDive(mode, opts) {
    opts = opts || {};
    const d = {
      mode, prompts: [], idx: 0, results: [], depth: 0, tanks: 3,
      phase: 'answer', tries: 0, revealAt: 0,
      diveNo: opts.diveNo || null, packId: opts.packId || null,
    };
    if (mode === 'daily' || mode === 'archive') {
      d.prompts = K.dailyPrompts(d.diveNo);
      d.label = (mode === 'daily' ? 'Daily Dive #' : 'Archive Dive #') + d.diveNo;
    } else if (mode === 'unlimited') {
      d.prompts = K.pickFresh(K.prompts, K.PROMPTS_PER_DIVE, store.recent);
      d.label = 'Unlimited Dive';
    } else if (mode === 'pack') {
      const pack = packOf(d.packId);
      d.prompts = K.pickFresh(pack.prompts, K.PROMPTS_PER_DIVE, store.recent);
      d.label = pack.name + ' Pack';
    } else if (mode === 'endless') {
      d.prompts = K.pickFresh(K.prompts, K.prompts.length, store.recent);
      d.label = 'Endless Dive';
    }
    return d;
  }

  function startDaily() {
    const n = K.diveNumber();
    const e = store.daily[n] || (store.daily[n] = { results: [], inFlight: null, done: false });
    if (e.done) { showDailyResults(); return; }
    dive = newDive('daily', { diveNo: n });
    // Leaving mid-prompt (reload, closing the tab) costs that prompt.
    if (e.inFlight != null && e.inFlight === e.results.length && e.inFlight < dive.prompts.length) {
      const p = dive.prompts[e.inFlight];
      e.results.push({ id: p.id, input: '', answer: null, tier: -1, points: 0 });
      e.inFlight = null;
      save();
      toast('You surfaced mid-prompt, so that one ran out of air.');
    }
    dive.results = e.results.slice();
    dive.idx = dive.results.length;
    dive.depth = resultsScore(dive.results) * K.METERS_PER_POINT;
    beginDive();
  }

  function startMode(mode, opts) {
    dive = newDive(mode, opts);
    beginDive();
  }

  function beginDive() {
    show('dive');
    setDepth(dive.depth);
    $('#dive-mode').textContent = dive.label;
    $('#dive-tanks').hidden = dive.mode !== 'endless';
    $('#dive-progress').hidden = dive.mode === 'endless';
    renderProgress();
    renderTanks();
    if (dive.idx >= dive.prompts.length && dive.mode !== 'endless') { finishDive(); return; }
    startPrompt();
  }

  function renderProgress() {
    if (dive.mode === 'endless') return;
    const dots = [];
    for (let i = 0; i < dive.prompts.length; i++) {
      const r = dive.results[i];
      const style = r ? ' style="background:' + tierOf(r.tier).color + '"' : '';
      const cls = 'dot' + (!r && i === dive.idx ? ' current' : '');
      dots.push('<span class="' + cls + '"' + style + '></span>');
    }
    $('#dive-progress').innerHTML = dots.join('');
  }

  function renderTanks(note) {
    if (dive.mode !== 'endless') return;
    let html = '';
    for (let i = 0; i < 3; i++) html += '<span class="tank' + (i < dive.tanks ? '' : ' empty') + '"></span>';
    html += '<span class="label">' + (note || (dive.tanks === 1 ? '1 air tank left' : dive.tanks + ' air tanks')) + '</span>';
    $('#dive-tanks').innerHTML = html;
  }

  function currentPrompt() {
    if (dive.mode === 'endless' && dive.idx >= dive.prompts.length) {
      dive.prompts = dive.prompts.concat(K.shuffle(K.prompts));
    }
    return dive.prompts[dive.idx];
  }

  function startPrompt() {
    const p = currentPrompt();
    dive.phase = 'answer';
    dive.tries = 0;
    const pack = packOf(p.pack);
    $('#dive-count').textContent = dive.mode === 'endless'
      ? 'Prompt ' + (dive.idx + 1)
      : 'Prompt ' + (dive.idx + 1) + ' / ' + dive.prompts.length;
    $('#prompt-pack').textContent = pack ? pack.emoji + ' ' + pack.name : '';
    $('#prompt-text').textContent = p.q;
    $('#prompt-note').textContent = p.note ? '(' + p.note + ')' : '';
    const input = $('#answer-input');
    input.value = '';
    input.disabled = false;
    $('#answer-form').hidden = false;
    $('#btn-surface').parentElement.hidden = false;
    $('.air').hidden = false;
    $('#feedback').textContent = '';
    $('#feedback').className = 'feedback';
    $('#reveal').hidden = true;
    renderProgress();
    if (dive.mode === 'daily') {
      const e = store.daily[dive.diveNo];
      e.inFlight = dive.idx;
      save();
    }
    startTimer(K.SECONDS_PER_PROMPT);
    // Avoid popping the keyboard on touch devices before the prompt is read.
    setTimeout(() => { if (dive && dive.phase === 'answer') input.focus({ preventScroll: true }); }, 60);
  }

  function startTimer(secs) {
    stopTimer();
    const total = secs * 1000;
    const end = performance.now() + total;
    const air = $('.air'), fill = $('#air-fill'), label = $('#air-secs');
    air.classList.remove('low', 'critical');
    const tick = () => {
      const left = end - performance.now();
      fill.style.transform = 'scaleX(' + Math.max(0, left / total) + ')';
      label.textContent = Math.max(0, Math.ceil(left / 1000)) + 's';
      air.classList.toggle('low', left <= 10000 && left > 5000);
      air.classList.toggle('critical', left <= 5000);
      if (left <= 0) { timerRaf = null; lockIn(null, { timeout: true }); return; }
      timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = null;
  }

  function submitAnswer() {
    if (!dive || dive.phase !== 'answer') return;
    const input = $('#answer-input');
    const val = input.value.trim();
    const fb = $('#feedback');
    if (!val) { fb.textContent = 'Type an answer first.'; fb.className = 'feedback'; return; }
    const p = currentPrompt();
    const m = K.match(p, val);
    if (!m) {
      dive.tries++;
      fb.innerHTML = '"' + esc(val) + '" isn\'t on the list. Keep trying!' +
        (dive.tries > 1 ? ' <span class="tries">(' + dive.tries + ' misses)</span>' : '');
      fb.className = 'feedback bad';
      const form = $('#answer-form');
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      input.select();
      return;
    }
    lockIn(m.answer, { input: val, fuzzy: m.fuzzy });
  }

  function lockIn(answer, opts) {
    if (!dive || dive.phase !== 'answer') return;
    opts = opts || {};
    stopTimer();
    dive.phase = 'reveal';
    dive.revealAt = performance.now();
    const p = currentPrompt();
    const tierIdx = answer ? answer.tier : -1;
    const tier = tierOf(tierIdx);
    const points = tier.points;
    const result = { id: p.id, input: opts.input || $('#answer-input').value.trim(), answer: answer ? answer.name : null, tier: tierIdx, points };
    dive.results.push(result);
    const prevDepth = dive.depth;
    dive.depth += points * K.METERS_PER_POINT;
    rememberRecent(p.id);

    let tankNote = '';
    if (dive.mode === 'endless') {
      if (tierIdx < 0) { dive.tanks--; tankNote = 'Lost an air tank!'; }
      else if (tierIdx >= 4 && dive.tanks < 3) { dive.tanks++; tankNote = 'Air tank refilled!'; }
    }

    if (dive.mode === 'daily') {
      const e = store.daily[dive.diveNo];
      e.results = dive.results.slice();
      e.inFlight = null;
    }
    save();

    // Reveal panel
    $('#answer-input').disabled = true;
    $('#answer-form').hidden = true;
    $('#btn-surface').parentElement.hidden = true;
    $('.air').hidden = true;
    const fb = $('#feedback');
    fb.textContent = opts.timeout ? 'Time\'s up!' : '';
    fb.className = 'feedback' + (opts.timeout ? ' bad' : '');

    const badge = $('#reveal-badge');
    badge.style.setProperty('--tier', tier.color);
    badge.className = 'reveal-badge ' + tier.id;
    $('#reveal-tier').textContent = tier.name;
    $('#reveal-answer').innerHTML = answer
      ? esc(answer.name) + (opts.fuzzy || K.normalize(opts.input) !== K.normalize(answer.name)
          ? '<span class="fuzzy">you typed "' + esc(opts.input) + '"</span>' : '')
      : (result.input ? '<span class="fuzzy">"' + esc(result.input) + '" wasn\'t on the list</span>' : 'No answer');
    animateNumber($('#reveal-points'), 0, points, 700, (v) => '+' + Math.round(v));
    animateNumber($('#reveal-meters'), 0, points * K.METERS_PER_POINT, 900, (v) => '+' + fmtNum(v) + ' m');
    $('#reveal-pct').textContent = answer ? K.formatPct(K.rarityPct(p, answer)) : '–';
    $('#reveal-quip').textContent = pick(QUIPS[tier.id]);

    // After a miss, show a ladder of answers from shallow to deep; otherwise only deeper ones.
    const deeper = answer
      ? K.topAnswers(p, Math.min(answer.tier + 1, 5), 4).filter((a) => a !== answer)
      : [0, 2, 4, 5].map((t) => K.shuffle(p.answers.filter((a) => a.tier === t))[0]).filter(Boolean);
    $('#reveal-chips').innerHTML = deeper.map((a) =>
      '<span class="chip" style="--tier:' + K.TIERS[a.tier].color + '">' + esc(a.name) +
      ' <small>' + K.TIERS[a.tier].name + '</small></span>').join('');
    $('.reveal-more .eyebrow').textContent = !answer ? 'Answers that would have counted'
      : answer.tier === 5 ? 'Other One in a Krillion finds' : 'Deeper answers on the list';
    $('.reveal-more').hidden = deeper.length === 0;

    const last = dive.mode === 'endless' ? dive.tanks <= 0 : dive.idx + 1 >= dive.prompts.length;
    $('#btn-next').textContent = last ? (dive.mode === 'endless' ? 'Surface: see results' : 'See results') : 'Next prompt →';
    $('#reveal').hidden = false;
    renderProgress();
    renderTanks(tankNote);
    setDepth(dive.depth, { animate: dive.depth !== prevDepth });
    setTimeout(() => $('#btn-next').focus({ preventScroll: true }), 50);
  }

  function nextPrompt() {
    if (!dive || dive.phase !== 'reveal') return;
    if (performance.now() - dive.revealAt < 350) return;
    dive.idx++;
    const over = dive.mode === 'endless' ? dive.tanks <= 0 : dive.idx >= dive.prompts.length;
    if (over) finishDive();
    else startPrompt();
  }

  // ------------------------------------------------------------- results --

  function finishDive() {
    stopTimer();
    dive.phase = 'done';
    const score = resultsScore(dive.results);
    const depth = score * K.METERS_PER_POINT;
    const r = store.records;
    if (dive.mode === 'daily') {
      const e = store.daily[dive.diveNo];
      e.results = dive.results.slice();
      e.done = true;
      e.inFlight = null;
    } else if (dive.mode === 'archive') {
      const prev = store.archive[dive.diveNo];
      if (!prev || depth > prev.depth) store.archive[dive.diveNo] = { score, depth, emoji: resultsEmoji(dive.results) };
    } else if (dive.mode === 'unlimited') {
      r.unlimitedPlayed++;
      r.unlimitedBest = Math.max(r.unlimitedBest, depth);
    } else if (dive.mode === 'pack') {
      store.packBest[dive.packId] = Math.max(store.packBest[dive.packId] || 0, depth);
    } else if (dive.mode === 'endless') {
      r.endlessPlayed++;
      r.endlessDepth = Math.max(r.endlessDepth, depth);
      r.endlessPrompts = Math.max(r.endlessPrompts, dive.results.length);
    }
    save();
    renderResults(dive);
  }

  function landmarkFor(depth) {
    let lm = null;
    for (const l of K.LANDMARKS) if (depth >= l.m) lm = l;
    if (!lm) return 'Still splashing about near the surface.';
    if (lm.m === 7000) return 'Perfect dive! You reached the trench floor.';
    return 'Deeper than: ' + lm.label.charAt(0).toLowerCase() + lm.label.slice(1) + ' (' + fmtNum(lm.m) + ' m)';
  }

  function shareText(d) {
    const score = resultsScore(d.results);
    const depth = score * K.METERS_PER_POINT;
    const zone = K.zoneFor(depth).name;
    let head;
    if (d.mode === 'daily') head = 'Krillion #' + d.diveNo + ' 🦐';
    else if (d.mode === 'archive') head = 'Krillion #' + d.diveNo + ' (archive) 🦐';
    else if (d.mode === 'endless') head = 'Krillion Endless Dive 🦐';
    else if (d.mode === 'pack') head = 'Krillion · ' + packOf(d.packId).name + ' Pack 🦐';
    else head = 'Krillion Unlimited ∞ 🦐';
    let emoji = resultsEmoji(d.results);
    if (d.mode === 'endless') {
      const all = Array.from(emoji);
      emoji = all.slice(0, 35).join('') + (all.length > 35 ? '…' : '');
    }
    const scoreLine = d.mode === 'endless'
      ? score + ' pts · ' + d.results.length + ' prompts'
      : score + '/' + d.prompts.length * 100;
    const lines = [head, K.formatDepth(depth) + ' · ' + zone, emoji, scoreLine];
    if (/^https?:/.test(location.protocol)) lines.push(location.origin + location.pathname);
    return lines.join('\n');
  }

  async function share(d) {
    const text = shareText(d);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Result copied. Paste it anywhere!');
    } catch (e) {
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else toast('Couldn\'t copy. Your browser blocked the clipboard.');
    }
  }

  let resultsDive = null;
  function renderResults(d) {
    resultsDive = d;
    show('results');
    const score = resultsScore(d.results);
    const depth = score * K.METERS_PER_POINT;
    setDepth(depth);
    const titles = {
      daily: 'Daily Dive #' + d.diveNo + ' complete',
      archive: 'Archive Dive #' + d.diveNo + ' complete',
      unlimited: 'Unlimited Dive complete',
      pack: (d.packId && packOf(d.packId) ? packOf(d.packId).name + ' Pack' : 'Pack') + ' complete',
      endless: 'Endless Dive: out of air',
    };
    $('#res-title').textContent = titles[d.mode];
    animateNumber($('#res-depth'), 0, depth, 1600, K.formatDepth);
    $('#res-zone').textContent = K.zoneFor(depth).name;
    $('#res-score').textContent = d.mode === 'endless'
      ? score + ' points · ' + d.results.length + ' prompts survived'
      : score + ' / ' + d.prompts.length * 100 + ' points';
    $('#res-landmark').textContent = landmarkFor(depth);
    $('#res-emoji').textContent = resultsEmoji(d.results);

    const again = $('#btn-again');
    again.textContent = { daily: 'Play Unlimited ∞', archive: 'Back to archive', unlimited: 'Dive again ∞', pack: 'Another ' + (packOf(d.packId) || {}).name + ' dive', endless: 'Dive again' }[d.mode];

    const next = $('#res-next');
    next.hidden = d.mode !== 'daily';
    if (d.mode === 'daily') $('#res-countdown').textContent = fmtCountdown(K.msUntilNextDive());

    $('#res-list').innerHTML = d.results.map((r, i) => {
      const p = K.byId.get(r.id);
      const t = tierOf(r.tier);
      const best = p ? K.topAnswers(p, 5, 1, K.rng(p.id))[0] : null;
      const ans = r.answer
        ? esc(r.answer) + '<span class="tier-name">' + t.name + '</span>'
        : (r.input ? '<s>' + esc(r.input) + '</s>' : 'No answer') + '<span class="tier-name">' + t.name + '</span>';
      return '<li class="res-item ' + t.id + '" style="--tier:' + t.color + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="q">' + esc(p ? p.q + (p.note ? ' (' + p.note + ')' : '') : r.id) + '</span>' +
        '<span class="pts">' + r.points + '</span>' +
        '<span class="a">' + ans + '</span>' +
        (best && best.name !== r.answer ? '<span class="best">One in a Krillion: ' + esc(best.name) + '</span>' : '') +
        '</li>';
    }).join('');
  }

  function showDailyResults() {
    const n = K.diveNumber();
    const e = store.daily[n];
    if (!e) return;
    renderResults({ mode: 'daily', diveNo: n, prompts: K.dailyPrompts(n), results: e.results });
  }

  // --------------------------------------------------------------- stats --

  function dailyStats() {
    const done = Object.keys(store.daily).map(Number).filter((n) => store.daily[n].done).sort((a, b) => a - b);
    const set = new Set(done);
    let best = 0, run = 0, prev = null;
    for (const n of done) { run = prev === n - 1 ? run + 1 : 1; best = Math.max(best, run); prev = n; }
    const today = K.diveNumber();
    let cur = 0;
    for (let n = set.has(today) ? today : today - 1; set.has(n); n--) cur++;
    const depths = done.map((n) => resultsScore(store.daily[n].results) * K.METERS_PER_POINT);
    const tiers = new Array(K.TIERS.length + 1).fill(0);
    for (const n of done) for (const r of store.daily[n].results) tiers[r.tier < 0 ? K.TIERS.length : r.tier]++;
    return {
      played: done.length, streak: cur, bestStreak: best,
      avg: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
      best: depths.length ? Math.max.apply(null, depths) : 0,
      tiers,
    };
  }

  function renderStats() {
    const s = dailyStats();
    const stat = (v, l) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>';
    $('#stat-row').innerHTML = stat(s.played, 'Daily dives') + stat(s.streak, 'Streak') + stat(s.bestStreak, 'Best streak') +
      stat(fmtNum(s.avg) + 'm', 'Avg depth') + stat(fmtNum(s.best) + 'm', 'Best depth');
    const max = Math.max(1, Math.max.apply(null, s.tiers));
    const rows = K.TIERS.map((t, i) => ({ t, c: s.tiers[i] })).reverse().concat([{ t: K.MISS, c: s.tiers[K.TIERS.length] }]);
    $('#tier-bars').innerHTML = rows.map(({ t, c }) =>
      '<div class="tier-bar" style="--tier:' + t.color + '"><span class="tl">' + t.emoji + ' ' + t.name + '</span>' +
      '<span class="tt"><span class="tf" style="display:block;width:' + (c / max * 100) + '%"></span></span><span class="tc">' + c + '</span></div>').join('');
    const r = store.records;
    $('#record-row').innerHTML = stat(fmtNum(r.endlessDepth) + 'm', 'Endless best') + stat(r.endlessPrompts, 'Endless prompts') +
      stat(r.unlimitedPlayed, 'Unlimited dives') + stat(fmtNum(r.unlimitedBest) + 'm', 'Unlimited best');
  }

  function renderHelp() {
    $('#tier-table').innerHTML = K.TIERS.slice().reverse().map((t) =>
      '<tr style="--tier:' + t.color + '"><td>' + t.emoji + '</td><td><div class="tn">' + t.name + '</div><div class="tb">' + esc(t.blurb) + '</div></td>' +
      '<td class="tp">' + t.points + ' pts<br><span class="tb">' + fmtNum(t.points * K.METERS_PER_POINT) + ' m</span></td></tr>').join('') +
      '<tr style="--tier:#8a96a8"><td>' + K.MISS.emoji + '</td><td><div class="tn">Miss</div><div class="tb">Time ran out or you gave up.</div></td><td class="tp">0 pts</td></tr>';
  }

  // -------------------------------------------------------------- events --

  function confirmLeave() {
    if (!dive || dive.phase !== 'answer' || current !== 'dive') return true;
    const msg = dive.mode === 'daily'
      ? 'Leave mid-prompt? This prompt will count as a miss.'
      : 'Leave this dive? Your progress in it will be lost.';
    if (!window.confirm(msg)) return false;
    // A daily prompt left mid-way stays "in flight" and is scored as a miss on return.
    stopTimer();
    dive = null;
    return true;
  }

  function go(where) {
    if (!confirmLeave()) return;
    if (where === 'home') { renderHome(); show('home'); }
    else if (where === 'packs') { renderPacks(); show('packs'); }
    else if (where === 'archive') { renderArchive(); show('archive'); }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.dataset.mode) { startMode(t.dataset.mode); return; }
    if (t.dataset.pack) { startMode('pack', { packId: t.dataset.pack }); return; }
    if (t.dataset.archive) {
      const n = Number(t.dataset.archive);
      if (n === K.diveNumber() && !(store.daily[n] && store.daily[n].done)) startDaily();
      else startMode('archive', { diveNo: n });
      return;
    }
    const a = t.dataset.action;
    if (a === 'daily') startDaily();
    else if (a === 'daily-results') showDailyResults();
    else if (a === 'daily-share') {
      const n = K.diveNumber();
      share({ mode: 'daily', diveNo: n, prompts: K.dailyPrompts(n), results: store.daily[n].results });
    }
  });

  $('#answer-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitAnswer(); });
  $('#btn-surface').addEventListener('click', () => lockIn(null));
  $('#btn-next').addEventListener('click', nextPrompt);
  $('#btn-share').addEventListener('click', () => resultsDive && share(resultsDive));
  $('#btn-again').addEventListener('click', () => {
    const d = resultsDive;
    if (!d) return;
    if (d.mode === 'daily' || d.mode === 'unlimited') startMode('unlimited');
    else if (d.mode === 'archive') go('archive');
    else if (d.mode === 'pack') startMode('pack', { packId: d.packId });
    else if (d.mode === 'endless') startMode('endless');
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && current === 'dive' && dive && dive.phase === 'reveal' && !document.querySelector('dialog[open]')) {
      ev.preventDefault();
      nextPrompt();
    }
  });

  $('#btn-help').addEventListener('click', () => { renderHelp(); $('#modal-help').showModal(); });
  $('#btn-stats').addEventListener('click', () => { renderStats(); $('#modal-stats').showModal(); });
  $('#btn-reset').addEventListener('click', () => {
    if (!window.confirm('Erase every dive, streak and record on this device?')) return;
    store = DEFAULT_STORE();
    store.seenHelp = true;
    save();
    $('#modal-stats').close();
    dive = null;
    renderHome();
    show('home');
    toast('Progress reset.');
  });
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  });

  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------- boot --

  buildGauge();
  resizeCanvas();
  requestAnimationFrame(frame);
  renderHome();
  show('home');
  setInterval(tickCountdowns, 1000);
  if (!store.seenHelp) {
    store.seenHelp = true;
    save();
    renderHelp();
    setTimeout(() => $('#modal-help').showModal(), 400);
  }

  // Exposed for automated tests and the console.
  window.KrillionApp = { get dive() { return dive; }, store: () => store, startMode, startDaily };
})();
