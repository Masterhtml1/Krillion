#!/usr/bin/env node
// Validate one or more pack files on their own, without loading the rest of the bank:
//   node tests/check-pack.js js/packs/food.js [js/packs/music.js ...]
// Exits non-zero on errors (clashing aliases, aliases that don't match their own answer).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tests/check-pack.js <pack.js> [...]');
  process.exit(2);
}

const K = require(path.join(__dirname, '..', 'js', 'engine.js'));
const ctx = vm.createContext({ Krillion: K });
for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });

let errors = 0;
let warnings = 0;
for (const p of K.prompts) {
  const seen = new Map();
  for (const a of p.answers) {
    for (const alias of a.aliases) {
      const k = K.keysFor(alias)[0];
      if (!k) { console.log('ERROR empty alias', p.id, JSON.stringify(a.name)); errors++; continue; }
      const prev = seen.get(k);
      if (prev && prev !== a) {
        console.log('ERROR clash', p.id, JSON.stringify(alias), '(' + K.TIERS[a.tier].id + ') vs', JSON.stringify(prev.name), '(' + K.TIERS[prev.tier].id + ')');
        errors++;
      } else seen.set(k, a);
      if (k.length <= 2 && a.aliases.length > 1) { console.log('warn  short alias', p.id, JSON.stringify(alias), 'of', JSON.stringify(a.name)); warnings++; }
    }
  }
  for (const a of p.answers) {
    for (const alias of a.aliases) {
      const m = K.match(p, alias);
      if (!m || m.answer !== a) {
        console.log('ERROR self-miss', p.id, JSON.stringify(alias), '->', m ? JSON.stringify(m.answer.name) : 'no match');
        errors++;
      }
    }
  }
  const counts = K.TIERS.map((t, i) => p.answers.filter((a) => a.tier === i).length);
  if (!counts[0]) { console.log('ERROR no plankton answers', p.id); errors++; }
  console.log(String(p.answers.length).padStart(5), counts.join('/').padEnd(22), p.id);
}
console.log(K.prompts.length + ' prompts, ' + K.prompts.reduce((s, p) => s + p.answers.length, 0) + ' answers, ' + errors + ' errors, ' + warnings + ' warnings');
process.exit(errors ? 1 : 0);
