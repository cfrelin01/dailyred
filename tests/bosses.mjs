// Checks the bosses: the data in src/dailyred_boss.c (static), and that the ROM
// and the website pick the same boss for a seed (boots the real game).
//
//   node bosses.mjs                # static checks + 24 random seeds
//   node bosses.mjs --static       # static checks only (no browser)
//   node bosses.mjs 1 2 3          # static checks + these seeds
//
// Exits non-zero on any problem.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, webModule, startServer, launchBrowser, bootGame, waitFor, readGameStatus } from './lib.mjs';
import { SPECIES, ITEMS, MOVES, baseStatTotal } from './party.mjs';

// Boss strength, as the sum of base stats of the six Pokemon. RED is 2954; the
// bosses stay close to him so a day's difficulty depends on your team, not on
// who showed up.
const MIN_BOSS_BST = 2850;
const MAX_BOSS_BST = 3200;
const LAST_GEN3_SPECIES = 411; // SPECIES_CHIMECHO

const { BOSSES, bossIndexForRun } = await webModule('bosses.js');

const source = readFileSync(join(GAME_DIR, 'src/dailyred_boss.c'), 'utf8');
const speciesId = new Map([...SPECIES].map(([id, name]) => [name, id]));
const itemId = new Map([...ITEMS].map(([id, name]) => [name, id]));
const moveId = new Map([...MOVES].map(([id, name]) => [name, id]));

let problems = 0;
const fail = (msg) => { problems++; console.log(`  FAIL: ${msg}`); };

// gDailyRedBossParty_<Name>[...] = { MON(SPECIES_X, ITEM_Y, MOVE_A, ...), ... };
const parties = new Map();
for (const m of source.matchAll(/gDailyRedBossParty_(\w+)\[[^\]]*\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
  const mons = [...m[2].matchAll(/MON\(SPECIES_(\w+),\s*ITEM_(\w+),\s*MOVE_(\w+),\s*MOVE_(\w+),\s*MOVE_(\w+),\s*MOVE_(\w+)\)/g)]
    .map((x) => ({ species: x[1], item: x[2], moves: x.slice(3, 7) }));
  parties.set(m[1].toLowerCase(), mons);
}

// The order of sBosses is the boss number the ROM uses.
const table = [...source.matchAll(/\{\s*TRAINER_DAILYRED_(\w+),\s*OBJ_EVENT_GFX_\w+,\s*sEVs_(\w+)\s*\}/g)]
  .map((x) => ({ trainer: x[1].toLowerCase(), evs: x[2].toLowerCase() }));

console.log(`${table.length} bosses in dailyred_boss.c, ${BOSSES.length} in web/bosses.js.`);
if (table.length !== BOSSES.length) fail('the boss tables differ in length');

table.forEach((boss, i) => {
  const mons = parties.get(boss.trainer) ?? [];
  const total = mons.reduce((sum, mon) => sum + (baseStatTotal(speciesId.get(mon.species)) || 0), 0);
  console.log(`\n${i}  ${boss.trainer.toUpperCase()}  base stat total ${total}: ${mons.map((mon) => mon.species).join(', ')}`);
  if (BOSSES[i]?.id !== boss.trainer) fail(`boss ${i} is "${boss.trainer}" in the ROM but "${BOSSES[i]?.id}" in web/bosses.js`);
  if (boss.evs !== boss.trainer) fail(`boss ${i} uses the EV table sEVs_${boss.evs}`);
  if (mons.length !== 6) fail(`${boss.trainer} has ${mons.length} Pokemon, expected 6`);
  if (total < MIN_BOSS_BST || total > MAX_BOSS_BST) fail(`${boss.trainer} base stat total ${total} is outside ${MIN_BOSS_BST}-${MAX_BOSS_BST}`);
  for (const mon of mons) {
    const id = speciesId.get(mon.species);
    if (id === undefined || id > LAST_GEN3_SPECIES || /^(OLD_UNOWN|EGG)/.test(mon.species)) fail(`${boss.trainer}: ${mon.species} is not a Gen 1-3 species`);
    if (!itemId.has(mon.item)) fail(`${boss.trainer}: unknown item ${mon.item}`);
    for (const move of mon.moves) if (!moveId.has(move)) fail(`${boss.trainer}: unknown move ${move}`);
    if (new Set(mon.moves).size !== 4) fail(`${boss.trainer}: ${mon.species} repeats a move`);
  }
  // EVs: 6 rows of 6 numbers, each <= 255, total <= 510.
  const evBlock = source.match(new RegExp(`sEVs_${boss.evs}\\[[^\\]]*\\]\\[[^\\]]*\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`, "i"));
  const rows = evBlock ? [...evBlock[1].matchAll(/\{([^}]*)\}/g)].map((r) => r[1].split(',').map(Number)) : [];
  if (rows.length !== 6) fail(`${boss.trainer}: expected 6 EV rows, found ${rows.length}`);
  rows.forEach((row, n) => {
    if (row.length !== 6 || row.some((v) => !(v >= 0 && v <= 255)) || row.reduce((a, b) => a + b, 0) > 510) fail(`${boss.trainer}: bad EV row ${n}: ${row.join(',')}`);
  });
});

// --- The ROM and the website agree on the boss ------------------------------------
const args = process.argv.slice(2);
if (!args.includes('--static')) {
  const seeds = args.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 0xFFFFFFFF);
  while (seeds.length < 24 && !args.length) seeds.push(1 + Math.floor(Math.random() * 0xFFFFFFFE));
  const server = await startServer();
  const browser = await launchBrowser();
  const picked = new Map();
  const queue = [...seeds];
  await Promise.all(Array.from({ length: Math.min(4, seeds.length) }, async () => {
    while (queue.length) {
      const seed = queue.shift();
      const page = await browser.newPage();
      try {
        await bootGame(page, server.url, { seed });
        const { mem } = await waitFor(page, (s) => s.inOverworld, { what: `overworld for seed ${seed}`, timeoutMs: 30000 });
        picked.set(seed, readGameStatus(mem)?.boss);
      } finally {
        await page.close();
      }
    }
  }));
  await browser.close();
  server.close();
  console.log('\nSeed -> boss (ROM / website):');
  for (const seed of seeds) {
    const expected = bossIndexForRun(seed);
    const ok = picked.get(seed) === expected;
    console.log(`  ${String(seed).padStart(10)}  ${picked.get(seed)} / ${expected}  ${BOSSES[expected].name}${ok ? '' : '  MISMATCH'}`);
    if (!ok) fail(`seed ${seed}: the ROM picked boss ${picked.get(seed)}, the website expects ${expected}`);
  }
  console.log(`${new Set(picked.values()).size} different bosses in ${seeds.length} seeds.`);
}

console.log(problems ? `\n${problems} problem(s).` : '\nAll boss checks passed.');
process.exit(problems ? 1 : 0);
