const test = require('node:test');
const assert = require('node:assert/strict');
const { loadKrillion } = require('./load');

const { Krillion: K, packFiles } = loadKrillion();
const promptFor = (fragment) => K.prompts.find((p) => p.q.includes(fragment));
const answerName = (p, input) => {
  const m = K.match(p, input);
  return m ? m.answer.name : null;
};

test('every pack script in index.html loads', () => {
  assert.equal(K.packs.length, packFiles.length);
  assert.ok(K.prompts.length >= 100, 'expected a 100+ prompt bank, got ' + K.prompts.length);
});

test('prompt ids are unique and stable slugs', () => {
  const ids = new Set(K.prompts.map((p) => p.id));
  assert.equal(ids.size, K.prompts.length);
  for (const p of K.prompts) assert.match(p.id, /^[a-z]+\/[a-z0-9-]+$/);
});

test('every prompt has common answers and a full ladder of tiers', () => {
  for (const p of K.prompts) {
    const tiers = new Set(p.answers.map((a) => a.tier));
    assert.ok(tiers.has(0), p.id + ' has no Plankton answers');
    assert.ok(tiers.size >= 4, p.id + ' only uses ' + tiers.size + ' tiers');
  }
});

test('no answer key is claimed by two different answers in one prompt', () => {
  for (const p of K.prompts) {
    const seen = new Map();
    for (const a of p.answers) {
      for (const alias of a.aliases) {
        const k = K.keysFor(alias)[0];
        assert.ok(k, p.id + ': empty alias in "' + a.name + '"');
        const prev = seen.get(k);
        assert.ok(!prev || prev === a, p.id + ': "' + alias + '" collides with "' + (prev && prev.name) + '"');
        seen.set(k, a);
      }
    }
  }
});

test('every alias matches its own answer', () => {
  for (const p of K.prompts) {
    for (const a of p.answers) {
      for (const alias of a.aliases) {
        const m = K.match(p, alias);
        assert.ok(m && m.answer === a, p.id + ': "' + alias + '" matched ' + (m && m.answer.name));
      }
    }
  }
});

test('answer text has no leftover editing notes', () => {
  for (const p of K.prompts) {
    for (const a of p.answers) {
      for (const alias of a.aliases) assert.doesNotMatch(alias, /\? no\b|\bdup\b|\bTODO\b/, p.id + ': ' + alias);
    }
  }
});

test('matching ignores case, accents, punctuation, articles and plurals', () => {
  const cheese = promptFor('type of cheese');
  assert.equal(answerName(cheese, '  GRUYÈRE '), 'Gruyere');
  assert.equal(answerName(cheese, 'a brie'), 'Brie');
  const fruit = promptFor('Name a fruit');
  assert.equal(answerName(fruit, 'Strawberries'), 'Strawberry');
  assert.equal(answerName(fruit, 'cherries'), 'Cherry');
  const river = promptFor('Name a river');
  assert.equal(answerName(river, 'The River Thames'), 'Thames');
  const states = promptFor('US state capital');
  assert.equal(answerName(states, 'St. Paul'), 'Saint Paul');
});

test('small typos are forgiven, wrong answers are not', () => {
  const europe = promptFor('country in Europe');
  assert.equal(answerName(europe, 'Swizerland'), 'Switzerland');
  assert.equal(answerName(europe, 'Australia'), null);
  assert.equal(answerName(europe, 'Japan'), null);
  const m = K.match(europe, 'Portugl');
  assert.ok(m && m.fuzzy);
});

test('surname, cut-at and strip options', () => {
  const tennis = promptFor('tennis player');
  assert.equal(answerName(tennis, 'Rublev'), 'Andrey Rublev');
  assert.equal(answerName(tennis, 'Williams'), null, 'ambiguous surname must not match');
  const groups = promptFor('collective noun');
  assert.equal(answerName(groups, 'a murder of crows'), 'Murder');
  const battles = promptFor('famous battle');
  assert.equal(answerName(battles, 'Battle of Hastings'), 'Hastings');
  const ships = promptFor('famous ship');
  assert.equal(answerName(ships, 'HMS Victory'), 'Victory');
});

test('tiers score 10/15/30/60/85/100 and 10 m per point', () => {
  assert.deepEqual(K.TIERS.map((t) => t.points), [10, 15, 30, 60, 85, 100]);
  assert.equal(K.METERS_PER_POINT, 10);
  assert.equal(K.MAX_SCORE, 700);
  assert.equal(K.SECONDS_PER_PROMPT, 25);
});

test('rarity percentages stay inside their tier band', () => {
  for (const p of K.prompts.slice(0, 20)) {
    for (const a of p.answers) {
      const pct = K.rarityPct(p, a);
      const [lo, hi] = K.TIERS[a.tier].pct;
      assert.ok(pct >= lo && pct <= hi, p.id + ' ' + a.name + ' ' + pct);
      assert.equal(pct, K.rarityPct(p, a), 'stable across calls');
    }
  }
});

test('dive numbers follow US Eastern midnight', () => {
  assert.equal(K.diveNumber(new Date('2026-07-16T12:00:00Z')), 1);
  assert.equal(K.diveNumber(new Date('2026-10-20T16:00:00Z')), 97);
  // 03:59 UTC is still the previous evening in New York (EDT, UTC-4).
  assert.equal(K.diveNumber(new Date('2026-10-21T03:59:00Z')), 97);
  assert.equal(K.diveNumber(new Date('2026-10-21T04:01:00Z')), 98);
  const left = K.msUntilNextDive(new Date('2026-10-21T03:00:00Z'));
  assert.ok(left > 59 * 60e3 && left <= 60 * 60e3, String(left));
});

test('daily dives are deterministic, distinct and rotate', () => {
  const a = K.dailyPrompts(97).map((p) => p.id);
  assert.deepEqual(a, K.dailyPrompts(97).map((p) => p.id));
  assert.equal(new Set(a).size, 7);
  const b = K.dailyPrompts(98).map((p) => p.id);
  assert.equal(a.filter((id) => b.includes(id)).length, 0);
  // Over the first two weeks no prompt repeats while the bank lasts.
  const seen = new Set();
  const days = Math.floor(K.prompts.length / 7);
  for (let n = 1; n <= days; n++) for (const p of K.dailyPrompts(n)) seen.add(p.id);
  assert.equal(seen.size, days * 7);
});

test('pickFresh prefers prompts that were not played recently', () => {
  const recent = K.prompts.slice(0, K.prompts.length - 7).map((p) => p.id);
  const picked = K.pickFresh(K.prompts, 7, recent, K.rng('t'));
  assert.equal(picked.length, 7);
  for (const p of picked) assert.ok(!recent.includes(p.id));
});

test('zones and gauge positions', () => {
  assert.equal(K.zoneFor(0).id, 'sunlight');
  assert.equal(K.zoneFor(200).id, 'twilight');
  assert.equal(K.zoneFor(3800).id, 'midnight');
  assert.equal(K.zoneFor(4500).id, 'abyssal');
  assert.equal(K.zoneFor(7000).id, 'hadal');
  assert.equal(K.gaugePos(0), 0);
  assert.equal(K.gaugePos(200), 0.2);
  assert.ok(K.gaugePos(20000) <= 1);
});

test('autofill suggests answers that look like the input', () => {
  const europe = promptFor('country in Europe');
  const texts = (p, s) => K.suggest(p, s).map((x) => x.text);
  assert.deepEqual(K.suggest(europe, 'sw'), [], 'nothing under three letters');
  assert.ok(texts(europe, 'swi').includes('Switzerland'));
  assert.ok(texts(europe, 'swizt').includes('Switzerland'), 'typo in the prefix');
  assert.ok(texts(europe, 'north').includes('North Macedonia'));
  assert.deepEqual(K.suggest(europe, 'Switzerland'), [], 'an exact answer needs no autofill');
  assert.ok(K.suggest(europe, 'a').length === 0 && K.suggest(europe, 'zzzzzz').length === 0);
  const tennis = promptFor('tennis player');
  assert.ok(texts(tennis, 'rubl').includes('Andrey Rublev'), 'start of a later word');
  const river = promptFor('Name a river');
  assert.ok(texts(river, 'the river tha').includes('Thames'), 'filler words ignored');
});

test('autofill returns at most four distinct answers, each one accepted', () => {
  for (const p of K.prompts) {
    for (const probe of ['the', 'sta', 'mar', 'cha', 'bla']) {
      const got = K.suggest(p, probe);
      assert.ok(got.length <= 4);
      assert.equal(new Set(got.map((s) => s.answer)).size, got.length, p.id + ' duplicate answers for ' + probe);
      for (const s of got) {
        const m = K.match(p, s.text);
        assert.ok(m && m.answer === s.answer, p.id + ': filling "' + s.text + '" must count as that answer');
      }
    }
  }
});
