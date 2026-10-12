// The games and the player's stats, saved in this browser (localStorage).
//
// Everyone gets the same sequence of games on the same calendar day (in their
// own time zone, like Wordle): game 1 is the day's challenge, and you can keep
// playing; game 2, 3... each have their own team and boss, the same for
// everyone. Every game counts in the stats.

const STORAGE_KEY = 'dailyred-stats';

// A date in the player's time zone, e.g. "2026-10-11".
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`); // midday, so DST changes can't skip a day
  d.setDate(d.getDate() + days);
  return today(d);
}

// The day's team seed: a hash (FNV-1a) of the date, never 0.
export function dailySeed(date) {
  let hash = 0x811c9dc5;
  for (const ch of `dailyred:${date}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

// How many games were finished on `date`.
export function gamesOn(stats, date) {
  return stats.gamesDate === date ? stats.games : 0;
}

// The seed of game number `game` (0 = the first) on `date`. Game 0 uses the
// plain daily seed, so the first game of a day is the same as it always was.
export function gameSeed(date, game) {
  return game === 0 ? dailySeed(date) : dailySeed(`${date}#${game}`);
}

export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

// --- Stats ------------------------------------------------------------------
//   wins, losses     all-time, every game counts
//   winStreak        games won in a row
//   dayStreak        days played in a row
//   lastPlayed       date of the last finished game, lastResult 'won'/'lost'
//   gamesDate, games how many games were finished on that date
//   pending          date of a battle that started but hasn't finished

const EMPTY = { wins: 0, losses: 0, winStreak: 0, dayStreak: 0, lastPlayed: null, lastResult: null, gamesDate: null, games: 0, pending: null };

let memoryCopy = null; // used when localStorage is blocked

export function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...EMPTY, ...saved };
  } catch {
    return { ...EMPTY, ...memoryCopy };
  }
}

function save(stats) {
  memoryCopy = { ...stats };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked (e.g. some private modes): stats last until the page closes.
  }
}

// The last game's result ('won' / 'lost') if one was finished on `date`, else null.
export function resultFor(stats, date) {
  return stats.lastPlayed === date ? stats.lastResult : null;
}

// Streaks as they stand on `date`: missing a day breaks them.
export function currentStreaks(stats, date) {
  const alive = stats.lastPlayed === date || stats.lastPlayed === addDays(date, -1);
  return { winStreak: alive ? stats.winStreak : 0, dayStreak: alive ? stats.dayStreak : 0 };
}

// From the moment the boss's battle starts the game counts as played, so
// leaving mid-battle counts as a loss (see settleAbandonedGame).
export function markBattleStarted(stats, date) {
  if (stats.pending === date) return;
  stats.pending = date;
  save(stats);
}

// Records the result of the game whose battle was marked started. Safe to call
// again for the same game: only the first call after markBattleStarted counts.
export function recordResult(stats, date, won) {
  if (stats.pending !== date) return;
  const sameDay = stats.lastPlayed === date;
  const consecutive = stats.lastPlayed === addDays(date, -1);
  if (!sameDay) stats.dayStreak = consecutive ? stats.dayStreak + 1 : 1;
  if (won) {
    stats.wins++;
    stats.winStreak = (sameDay || consecutive) && stats.lastResult === 'won' ? stats.winStreak + 1 : 1;
  } else {
    stats.losses++;
    stats.winStreak = 0;
  }
  stats.games = gamesOn(stats, date) + 1;
  stats.gamesDate = date;
  stats.lastPlayed = date;
  stats.lastResult = won ? 'won' : 'lost';
  stats.pending = null;
  save(stats);
}

// A battle that started but never finished (tab closed, page reloaded) is a loss.
export function settleAbandonedGame(stats) {
  if (stats.pending) recordResult(stats, stats.pending, false);
  return stats;
}
