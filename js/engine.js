/*
 * Krillion engine: tiers, answer matching, depth zones, seeding and dive selection.
 * Pure logic with no DOM access, so it runs in the browser (window.Krillion)
 * and in Node (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Krillion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- tiers --

  const TIERS = [
    { id: 'plankton', name: 'Plankton', points: 10, emoji: '⬜', color: '#dcebf2',
      blurb: 'The answer the whole shoal gave.', pct: [9, 34] },
    { id: 'clever', name: 'Too Clever', points: 15, emoji: '🟧', color: '#ff9a3c',
      blurb: 'The "obscure" pick everybody reaches for.', pct: [3.5, 9] },
    { id: 'schooler', name: 'Schooler', points: 30, emoji: '🟦', color: '#3d8bff',
      blurb: 'Solid. Swimming with the school.', pct: [1.2, 3.4] },
    { id: 'rare', name: 'Rare', points: 60, emoji: '🟥', color: '#ff4d5e',
      blurb: 'Few divers got down here.', pct: [0.35, 1.1] },
    { id: 'deep', name: 'Deep Cut', points: 85, emoji: '🟪', color: '#a35cff',
      blurb: 'Down where the light runs out.', pct: [0.06, 0.3] },
    { id: 'krillion', name: 'One in a Krillion', points: 100, emoji: '🟨', color: '#ffd23f',
      blurb: 'Almost nobody on Earth found this.', pct: [0.004, 0.05] },
  ];
  const MISS = { id: 'miss', name: 'Out of Air', points: 0, emoji: '⬛', color: '#5d6a80',
    blurb: 'No answer before the air ran out.' };

  const METERS_PER_POINT = 10;
  const PROMPTS_PER_DIVE = 7;
  const SECONDS_PER_PROMPT = 25;
  const MAX_SCORE = PROMPTS_PER_DIVE * TIERS[TIERS.length - 1].points;

  // ---------------------------------------------------------------- zones --

  const ZONES = [
    { id: 'sunlight', name: 'Sunlight Zone', from: 0, to: 200 },
    { id: 'twilight', name: 'Twilight Zone', from: 200, to: 1000 },
    { id: 'midnight', name: 'Midnight Zone', from: 1000, to: 4000 },
    { id: 'abyssal', name: 'Abyssal Zone', from: 4000, to: 6000 },
    { id: 'hadal', name: 'Hadal Zone', from: 6000, to: 11000 },
  ];

  const LANDMARKS = [
    { m: 40, label: 'Recreational scuba limit' },
    { m: 332, label: 'Deepest scuba dive ever' },
    { m: 1000, label: 'Last trace of sunlight' },
    { m: 2250, label: 'Sperm whales hunt squid here' },
    { m: 3800, label: 'Wreck of the Titanic' },
    { m: 5000, label: 'The abyssal plain' },
    { m: 7000, label: 'A perfect daily dive' },
    { m: 8336, label: 'Deepest fish ever filmed' },
    { m: 10935, label: 'Challenger Deep' },
  ];

  // Sea colour stops (top/bottom of the viewport gradient) by depth in metres.
  const SEA = [
    { m: 0, top: [94, 205, 236], bot: [25, 122, 178] },
    { m: 200, top: [33, 128, 186], bot: [14, 76, 135] },
    { m: 1000, top: [14, 66, 120], bot: [7, 38, 82] },
    { m: 4000, top: [6, 26, 60], bot: [3, 13, 34] },
    { m: 6000, top: [3, 12, 32], bot: [1, 5, 16] },
    { m: 9000, top: [1, 4, 12], bot: [0, 1, 4] },
  ];

  function zoneFor(depth) {
    for (let i = ZONES.length - 1; i >= 0; i--) if (depth >= ZONES[i].from) return ZONES[i];
    return ZONES[0];
  }

  // Gauge position 0..1 where each zone gets an equal slice, so the thin
  // sunlight zone is as readable as the huge midnight zone.
  function gaugePos(depth) {
    const n = ZONES.length;
    for (let i = 0; i < n; i++) {
      const z = ZONES[i];
      if (depth < z.to || i === n - 1) {
        const t = Math.max(0, Math.min(1, (depth - z.from) / (z.to - z.from)));
        return (i + t) / n;
      }
    }
    return 1;
  }

  function seaColors(depth) {
    let a = SEA[0], b = SEA[SEA.length - 1];
    if (depth <= SEA[0].m) b = a;
    else if (depth >= b.m) a = b;
    else {
      for (let i = 0; i < SEA.length - 1; i++) {
        if (depth >= SEA[i].m && depth <= SEA[i + 1].m) { a = SEA[i]; b = SEA[i + 1]; break; }
      }
    }
    const t = a === b ? 0 : (depth - a.m) / (b.m - a.m);
    const mix = (x, y) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return { top: mix(a.top, b.top), bot: mix(a.bot, b.bot) };
  }

  // ------------------------------------------------------------- matching --

  // Filler words dropped for a second, looser key ("Mount Everest" ~ "Everest").
  const STOP = new Set(['the', 'a', 'an', 'of', 'mount', 'mt', 'river', 'lake', 'island',
    'islands', 'isle', 'saint', 'st', 'city']);

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/œ/g, 'oe')
      .replace(/&/g, ' and ')
      .replace(/['’‘`´]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function keysFor(s) {
    const n = normalize(s);
    if (!n) return [];
    const words = n.split(' ');
    const full = words.join('');
    const stripped = words.filter((w) => !STOP.has(w)).join('');
    return stripped && stripped !== full ? [full, stripped] : [full];
  }

  function variants(k) {
    const v = [k];
    if (k.length > 3 && k.endsWith('s')) v.push(k.slice(0, -1));
    if (k.length > 4 && k.endsWith('es')) v.push(k.slice(0, -2));
    if (k.length > 4 && k.endsWith('ies')) v.push(k.slice(0, -3) + 'y');
    return v;
  }

  // Optimal string alignment distance (Levenshtein + adjacent transpositions).
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const m = a.length, n = b.length;
    let prev2 = null, prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur; cur = new Array(n + 1);
    }
    return prev[n];
  }

  function fuzzyTolerance(len) {
    if (len >= 10) return 2;
    if (len >= 5) return 1;
    return 0;
  }

  function buildIndex(prompt) {
    const exact = new Map();
    const loose = new Map();
    const fullKeys = [];
    // Full keys first so a stripped key never shadows another answer's real name.
    for (const ans of prompt.answers) {
      for (const alias of ans.aliases) {
        const k = keysFor(alias)[0];
        if (k && !exact.has(k)) { exact.set(k, ans); fullKeys.push([k, ans]); }
      }
    }
    for (const ans of prompt.answers) {
      for (const alias of ans.aliases) {
        for (const k of keysFor(alias)) {
          if (!exact.has(k)) exact.set(k, ans);
          for (const v of variants(k)) if (!loose.has(v)) loose.set(v, ans);
        }
      }
    }
    // People prompts also accept a bare surname, as long as only one answer has it.
    if (prompt.surnames) {
      const owners = new Map();
      for (const ans of prompt.answers) {
        for (const alias of ans.aliases) {
          const words = normalize(alias).split(' ');
          if (words.length < 2) continue;
          const last = words[words.length - 1];
          if (last.length < 3) continue;
          if (!owners.has(last)) owners.set(last, new Set());
          owners.get(last).add(ans);
        }
      }
      for (const [last, set] of owners) {
        if (set.size === 1 && !exact.has(last) && !loose.has(last)) loose.set(last, set.values().next().value);
      }
    }
    return { exact, loose, fullKeys };
  }

  // Readings of the input to try, best first:
  //   options.cutAt "of":         "a murder of crows" -> "a murder"
  //   options.strip ["battle of"]: "battle of hastings" -> "hastings"
  function readings(prompt, input) {
    const n = normalize(input);
    const out = [];
    if (prompt.cutAt) {
      const i = n.indexOf(' ' + prompt.cutAt + ' ');
      if (i > 0) out.push(n.slice(0, i));
    }
    out.push(n);
    for (const s of prompt.strip || []) {
      if (n.startsWith(s + ' ')) out.push(n.slice(s.length + 1));
    }
    return out;
  }

  function match(prompt, input) {
    const tries = readings(prompt, input);
    for (const t of tries) {
      const m = matchCore(prompt, t, false);
      if (m) return m;
    }
    for (const t of tries) {
      const m = matchCore(prompt, t, true);
      if (m) return m;
    }
    return null;
  }

  function matchCore(prompt, input, fuzzy) {
    const ks = keysFor(input);
    if (!ks.length) return null;
    const idx = prompt._index || (prompt._index = buildIndex(prompt));
    for (const k of ks) if (idx.exact.has(k)) return { answer: idx.exact.get(k), fuzzy: false };
    for (const k of ks) {
      for (const v of variants(k)) {
        if (idx.exact.has(v)) return { answer: idx.exact.get(v), fuzzy: false };
        if (idx.loose.has(v)) return { answer: idx.loose.get(v), fuzzy: false };
      }
    }
    if (!fuzzy) return null;
    const k = ks[0];
    const tol = fuzzyTolerance(k.length);
    if (!tol) return null;
    let best = null, bestD = tol + 1;
    for (const [ek, ans] of idx.fullKeys) {
      if (ek[0] !== k[0] || fuzzyTolerance(ek.length) === 0) continue;
      const d = distance(k, ek, tol);
      if (d < bestD) { best = ans; bestD = d; if (d === 1) break; }
    }
    return best ? { answer: best, fuzzy: true } : null;
  }

  // ------------------------------------------------------------ autofill --

  const SUGGEST_MIN = 3;

  function buildSuggest(prompt) {
    const list = [];
    for (const ans of prompt.answers) {
      for (const alias of ans.aliases) {
        const norm = normalize(alias);
        if (norm) list.push({ ans, alias, key: norm.replace(/ /g, ''), spaced: ' ' + norm });
      }
    }
    return list;
  }

  // Lower is better. Prefix of the whole name, then the start of a later word
  // ("lund" -> "Norwegian Lundehund"), then a near-typo of a prefix or the name.
  function suggestScore(e, typed, typedKey, tol) {
    const tail = e.key.length / 1000;
    if (e.key.startsWith(typedKey)) return 1 + tail;
    if (e.spaced.includes(' ' + typed)) return 2 + tail;
    if (!tol || e.key[0] !== typedKey[0]) return Infinity;
    let d = tol + 1;
    for (let len = typedKey.length - 1; len <= typedKey.length + 1; len++) {
      if (len > 0 && len <= e.key.length) d = Math.min(d, distance(typedKey, e.key.slice(0, len), tol));
    }
    return d <= tol ? 3 + d + tail : Infinity;
  }

  /**
   * Answers that look like what the player is typing, for autofill. Returns up
   * to `limit` of { answer, text } where text is the alias to fill in. Nothing is
   * suggested under three letters or once the input already matches exactly.
   */
  function suggest(prompt, input, limit) {
    limit = limit || 4;
    const long = (t) => t.replace(/ /g, '').length >= SUGGEST_MIN;
    const tries = readings(prompt, input).filter(long);
    if (!tries.length) return [];
    if (tries.some((t) => matchCore(prompt, t, false))) return [];
    // Also try without filler words: "the river tha" -> "tha".
    for (const t of tries.slice()) {
      const bare = t.split(' ').filter((w) => !STOP.has(w)).join(' ');
      if (bare !== t && long(bare)) tries.push(bare);
    }
    const list = prompt._suggest || (prompt._suggest = buildSuggest(prompt));
    const best = new Map();
    for (const typed of tries) {
      const typedKey = typed.replace(/ /g, '');
      const tol = typedKey.length >= 7 ? 2 : typedKey.length >= 4 ? 1 : 0;
      for (const e of list) {
        const s = suggestScore(e, typed, typedKey, tol);
        const prev = best.get(e.ans);
        if (s < Infinity && (!prev || s < prev.score)) best.set(e.ans, { answer: e.ans, text: e.alias, score: s });
      }
    }
    let found = Array.from(best.values());
    // Typo guesses only when nothing actually starts with what was typed.
    if (found.some((f) => f.score < 3)) found = found.filter((f) => f.score < 3);
    return found
      .sort((a, b) => a.score - b.score || a.text.length - b.text.length)
      .slice(0, limit)
      .map(({ answer, text }) => ({ answer, text }));
  }

  // ------------------------------------------------------------- seeding --

  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
  }

  function rng(seed) {
    let a = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    rand = rand || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Share of divers who gave an answer. There is no live crowd in a static
  // clone, so this is a stable per-answer figure drawn from the tier's band.
  function rarityPct(prompt, answer) {
    const tier = TIERS[answer.tier];
    const u = (hashString(prompt.id + '|' + answer.name) % 100000) / 100000;
    const lo = Math.log(tier.pct[0]), hi = Math.log(tier.pct[1]);
    return Math.exp(lo + (hi - lo) * u);
  }

  function formatPct(p) {
    if (p >= 10) return Math.round(p) + '%';
    if (p >= 1) return p.toFixed(1) + '%';
    return Number(p.toPrecision(2)) + '%';
  }

  // ---------------------------------------------------------- prompt bank --

  const packs = [];
  const prompts = [];
  const byId = new Map();

  function slug(s) {
    return normalize(s).replace(/^name (a|an|the) /, '').replace(/ /g, '-').slice(0, 48);
  }

  function parseTier(str, tier) {
    if (!str) return [];
    return str.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
      const aliases = item.split('/').map((s) => s.trim()).filter(Boolean);
      return { name: aliases[0], aliases, tier };
    });
  }

  /**
   * Register a themed pack. Each row is:
   *   [question, note, plankton, tooClever, schooler, rare, deepCut, oneInAKrillion, options?]
   * Tier cells are comma-separated answers; "/" separates accepted aliases.
   * options.surnames: also accept an answer's unique last word ("Rublev").
   * options.cutAt: a joining word; input after it is optional ("pride of lions").
   * options.strip: leading words the input may carry ("battle of", "hms").
   */
  function addPack(meta, rows) {
    const pack = Object.assign({ prompts: [] }, meta);
    for (const row of rows) {
      const [q, note] = row;
      const opts = row[2 + TIERS.length] || {};
      const answers = [];
      for (let t = 0; t < TIERS.length; t++) answers.push(...parseTier(row[2 + t], t));
      let id = pack.id + '/' + slug(q);
      while (byId.has(id)) id += '-2';
      const prompt = { id, pack: pack.id, q, note: note || '', answers,
        surnames: !!opts.surnames, cutAt: opts.cutAt || null, strip: (opts.strip || []).map(normalize) };
      pack.prompts.push(prompt);
      prompts.push(prompt);
      byId.set(id, prompt);
    }
    packs.push(pack);
    return pack;
  }

  function topAnswers(prompt, minTier, count, rand) {
    const pool = prompt.answers.filter((a) => a.tier >= minTier);
    return shuffle(pool, rand).sort((a, b) => b.tier - a.tier).slice(0, count);
  }

  // ---------------------------------------------------------- daily dives --

  // Dive #1 was 16 July 2026; a new dive starts at midnight US Eastern time.
  const EPOCH = Date.UTC(2026, 6, 16);
  const DAY = 86400000;

  function easternParts(date) {
    date = date || new Date();
    try {
      const f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
      });
      const o = {};
      for (const p of f.formatToParts(date)) o[p.type] = p.value;
      return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
    } catch (e) {
      return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(),
        h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds() };
    }
  }

  function diveNumber(date) {
    const p = easternParts(date);
    return Math.max(1, Math.floor((Date.UTC(p.y, p.m - 1, p.d) - EPOCH) / DAY) + 1);
  }

  function diveDateLabel(n, opts) {
    const d = new Date(EPOCH + (n - 1) * DAY);
    return d.toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }, opts));
  }

  function msUntilNextDive(date) {
    date = date || new Date();
    const p = easternParts(date);
    return (86400 - (p.h * 3600 + p.mi * 60 + p.s)) * 1000 - date.getMilliseconds();
  }

  const permCache = new Map();
  function dailyPerm(cycle) {
    if (!permCache.has(cycle)) {
      const ordered = prompts.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      permCache.set(cycle, shuffle(ordered, rng('krillion-daily-cycle-' + cycle)));
    }
    return permCache.get(cycle);
  }

  // Walk one long seeded sequence of the whole bank, 7 prompts per day, so
  // consecutive daily dives don't repeat until the bank runs out.
  function dailyPrompts(n) {
    const N = prompts.length;
    const want = Math.min(PROMPTS_PER_DIVE, N);
    const out = [];
    const seen = new Set();
    let pos = (Math.max(1, n) - 1) * PROMPTS_PER_DIVE;
    while (out.length < want) {
      const p = dailyPerm(Math.floor(pos / N))[pos % N];
      if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
      pos++;
    }
    return out;
  }

  // Pick `count` prompts from `pool`, preferring ones not in `recent`.
  function pickFresh(pool, count, recent, rand) {
    const recentSet = new Set(recent || []);
    const fresh = shuffle(pool.filter((p) => !recentSet.has(p.id)), rand);
    if (fresh.length >= count) return fresh.slice(0, count);
    const stale = shuffle(pool.filter((p) => recentSet.has(p.id)), rand);
    return fresh.concat(stale).slice(0, count);
  }

  function formatDepth(m) {
    return Math.round(m).toLocaleString('en-US') + ' m';
  }

  return {
    TIERS, MISS, ZONES, LANDMARKS, METERS_PER_POINT, PROMPTS_PER_DIVE, SECONDS_PER_PROMPT, MAX_SCORE,
    zoneFor, gaugePos, seaColors,
    normalize, keysFor, distance, match, suggest,
    hashString, rng, shuffle, rarityPct, formatPct,
    packs, prompts, byId, addPack, topAnswers,
    easternParts, diveNumber, diveDateLabel, msUntilNextDive, dailyPrompts, pickFresh,
    formatDepth,
  };
});
