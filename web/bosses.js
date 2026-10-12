// The bosses and which one a seed picks. Entry `i` here is boss number `i` in
// pokefirered/src/dailyred_boss.c (the sBosses table): keep both lists in the
// same order. `pic` is the boss's battle sprite, copied out of the decomp by
// scripts/build-rom.sh into game/bosses/.

export const BOSSES = [
  { id: 'red',     name: 'RED',     pic: 'game/bosses/red.png' },
  { id: 'blue',    name: 'BLUE',    pic: 'game/bosses/blue.png' },
  { id: 'lance',   name: 'LANCE',   pic: 'game/bosses/lance.png' },
  { id: 'steven',  name: 'STEVEN',  pic: 'game/bosses/steven.png' },
  { id: 'wallace', name: 'WALLACE', pic: 'game/bosses/wallace.png' },
  { id: 'lorelei', name: 'LORELEI', pic: 'game/bosses/lorelei.png' },
  { id: 'bruno',   name: 'BRUNO',   pic: 'game/bosses/bruno.png' },
  { id: 'agatha',  name: 'AGATHA',  pic: 'game/bosses/agatha.png' },
];

// murmur3's 32-bit finalizer, the same few lines as BossIndexForRun in
// pokefirered/src/dailyred.c. Run 0 is the first (and, in the daily game, the
// only) battle of a boot; practice runs that start over use 1, 2, ...
export function bossIndexForRun(seed, run = 0) {
  let h = (seed ^ Math.imul(run, 0x9E3779B9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85EBCA6B) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % BOSSES.length;
}

export function bossForSeed(seed, run = 0) {
  return BOSSES[bossIndexForRun(seed, run)];
}
