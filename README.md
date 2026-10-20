# 🦐 Krillion

A browser trivia game where **rare answers sink you deeper**. It recreates the Krillion daily dive and adds unlimited play.

Every prompt asks for one answer, like *"Name a country with the letter D in its name"*. Common answers barely get you wet. Answers almost nobody thinks of send your krill into the trench.

## How to play

- A **Daily Dive** is **7 prompts**, the same for everyone on the same day. A new dive starts at midnight US Eastern time (dive #1 was 16 July 2026).
- You get **25 seconds of air** per prompt. If an answer isn't on the list, keep trying until the clock runs out.
- **Autofill:** after 3 letters, up to four accepted answers that look like what you're typing appear under the box. That includes names that start with your letters, names with a later word that starts with them ("lund" → Norwegian Lundehund), and near-typos. Tap a suggestion or press <kbd>Tab</kbd> to fill it in. <kbd>↑</kbd>/<kbd>↓</kbd> then <kbd>Enter</kbd> fills and submits. Suggestions never show the tier. You can turn autofill off under **How to play → Settings**.
- Each accepted answer falls into one of six rarity tiers:

  | Tier | Points | Depth |
  | --- | --- | --- |
  | 🟨 One in a Krillion | 100 | 1,000 m |
  | 🟪 Deep Cut | 85 | 850 m |
  | 🟥 Rare | 60 | 600 m |
  | 🟦 Schooler | 30 | 300 m |
  | 🟧 Too Clever (the "obscure" pick everybody reaches for) | 15 | 150 m |
  | ⬜ Plankton | 10 | 100 m |
  | ⬛ Out of air | 0 | 0 m |

- Every point sinks you **10 metres**. A perfect dive is 700 points, which is 7,000 m in the Hadal zone. The sea gets darker as you pass the Sunlight, Twilight, Midnight, Abyssal and Hadal zones.
- At the end you get a shareable result:

  ```
  Krillion #97 🦐
  5,000 m · Abyssal Zone
  🟨⬛⬛🟨🟨🟨🟨
  500/700
  ```

## Unlimited play

The original game gives you one dive a day. This version has more:

| Mode | What it is |
| --- | --- |
| **Daily Dive** | The shared 7-prompt dive. It tracks streaks and stats. |
| **Unlimited Dive ∞** | A fresh random set of 7 prompts, as often as you like. It avoids prompts you've played recently. |
| **Endless Dive** | No prompt limit. You start with 3 air tanks. A miss costs a tank, and a Deep Cut or One in a Krillion refills one. |
| **Themed Packs** | 7-prompt dives from one topic: Geography, Food & Drink, Animals, Movies & TV, Music, Sports, Science & Nature, Words & Language, Everyday Things, History & People, and Games & Pop Culture. |
| **Dive Archive** | Replay any past daily dive for free. Replays don't affect your streak. |

The bank has **104 prompts** and about **15,000 accepted answers**.

## Running it

The game is plain static HTML, CSS and JS, with no build step and no dependencies.

```bash
# open directly
open index.html

# or serve it (handy for clipboard sharing, which needs http/https)
npm start            # python3 -m http.server 8080
```

You can host it on any static host, such as GitHub Pages, Netlify or Cloudflare Pages.

## Tests

```bash
npm test
```

The tests check every prompt in the bank and the game logic. Each prompt must have a full ladder of tiers, no clashing aliases, and every alias must match its own answer. The tests also cover answer matching (typos, plurals, accents, surnames), the dive-number and midnight-ET rollover, and daily rotation.

## Adding prompts

Prompts live in `js/packs/*.js`. Each row has this shape:

```js
['Name a fruit', 'like an apple',
  'Apple, Banana, Orange',            // Plankton
  'Tomato, Avocado',                  // Too Clever
  'Lime, Raspberry, Kumquat',         // Schooler
  'Rambutan, Mangosteen',             // Rare
  'Cupuacu, Marula',                  // Deep Cut
  'Gac, Hala fruit',                  // One in a Krillion
  { surnames: true }],                // optional matching options
```

- Separate answers with `,`. Use `/` between aliases of the same answer, for example `Kiwi/Kiwifruit`. Names can't contain a comma. If a name really has a slash in it, write it with the fraction slash `⁄`, as in `AC⁄DC/ACDC`.
- Check one pack on its own with `node tests/check-pack.js js/packs/food.js`. It prints per-tier counts and flags clashing or unmatched aliases.
- Matching ignores case, accents, punctuation, a leading "the/a/an" and plurals, and it forgives small typos.
- These options are available:
  - `surnames` accepts a unique last name, so "Rublev" matches "Andrey Rublev".
  - `cutAt: 'of'` accepts phrases like "a murder of crows" for "Murder".
  - `strip: ['battle of']` accepts "Battle of Hastings" for "Hastings".

To add a new pack, create a file that calls `Krillion.addPack(...)` and add a `<script>` tag for it in `index.html`. The tests load the same list of packs.

## Notes

- This is a fan-made recreation and is not affiliated with krillion.io. The live game ranks answers by how many players typed them. With no server, this version uses curated tiers, and the "% of divers said it" figure is a stable simulated number inside each tier's range.
- Progress, streaks and records are saved in your browser's `localStorage`.
