// Loads the engine and every pack listed in index.html into one Krillion instance.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadKrillion() {
  const Krillion = require(path.join(ROOT, 'js/engine.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const packFiles = [...html.matchAll(/<script src="(js\/packs\/[^"]+)"/g)].map((m) => m[1]);
  const ctx = vm.createContext({ Krillion });
  for (const f of packFiles) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return { Krillion, packFiles };
}

module.exports = { loadKrillion, ROOT };
