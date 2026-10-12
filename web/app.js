// Website controller: the title card (the next boss, your stats, Play), the
// emulator, and the toolbar and touch controls. All game behaviour lives in the
// ROM; this file starts it with the day's seed, watches for the result, and
// keeps the stats (see daily.js).
import { Nostalgist } from './vendor/nostalgist.js';
import { loadGameFiles } from './game-files.js';
import { injectConfig, parseSeed } from './rom-config.js';
import { createGameLink, PHASE, RESULT } from './game-link.js';
import {
  today, gameSeed, gamesOn, loadStats, resultFor, currentStreaks,
  markBattleStarted, recordResult, settleAbandonedGame,
} from './daily.js';
import { bossForSeed } from './bosses.js';

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const screen = $('screen');
const ui = {
  play: $('play'),
  bossSprite: $('boss-sprite'),
  retry: $('retry'),
  sound: $('sound'),
  fullscreen: $('fullscreen'),
  wins: $('stat-wins'),
  losses: $('stat-losses'),
  winStreak: $('stat-win-streak'),
  dayStreak: $('stat-day-streak'),
  played: $('played'),
  playedResult: $('played-result'),
  playedNext: $('played-next'),
  practiceNote: $('practice-note'),
  loadingText: $('loading-text'),
  loadingDetail: $('loading-detail'),
  meter: $('meter'),
  errorText: $('error-text'),
};

// sessionStorage can throw when storage is blocked; the site works without it.
const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* not remembered */ } },
};

// ?seed=123 starts a practice run with that team, for testing: results
// aren't saved, there's no daily limit, and the game keeps dealing new teams.
const practiceSeed = parseSeed(new URLSearchParams(location.search).get('seed'));

let stats = settleAbandonedGame(loadStats());
let emu = null;
let readGame = null;
let pollTimer = null;
let runDate = null;
let battleSeen = false;
let recorded = false; // this game's result is in the stats
let muted = session.get('dailyred-muted') === '1';
let starting = false;
let titleDate = null;

// RetroArch opens a Web Audio context for each emulator and never closes it,
// so a restart would leave one running (and browsers cap how many a page can
// have). Track the contexts the emulator creates and close them on exit.
const audioContexts = [];
const NativeAudioContext = window.AudioContext;
if (NativeAudioContext) {
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      audioContexts.push(this);
    }
  };
}

function setState(state) {
  app.dataset.state = state;
  const playing = state === 'playing';
  ui.sound.disabled = !playing;
  ui.fullscreen.disabled = !playing || !document.fullscreenEnabled;
}

// --- Title card ------------------------------------------------------------------

function renderTitle() {
  titleDate = today();
  const { winStreak, dayStreak } = currentStreaks(stats, titleDate);
  ui.wins.textContent = stats.wins;
  ui.losses.textContent = stats.losses;
  ui.winStreak.textContent = winStreak;
  ui.dayStreak.textContent = dayStreak;

  // The boss of the next game (the same hash as the ROM's, see bosses.js),
  // and a line about the game just finished if there was one today.
  const games = gamesOn(stats, titleDate);
  const result = practiceSeed ? null : resultFor(stats, titleDate);
  const next = bossForSeed(practiceSeed ?? gameSeed(titleDate, games));
  ui.bossSprite.src = next.pic;
  ui.bossSprite.alt = next.name;
  ui.play.textContent = games > 0 && !practiceSeed ? 'Play again' : 'Play';
  ui.played.hidden = !result;
  ui.practiceNote.hidden = !practiceSeed;
  if (result) {
    const last = bossForSeed(gameSeed(titleDate, games - 1));
    ui.playedResult.textContent = result === 'won' ? `You beat ${last.name}!` : `${last.name} won.`;
    ui.playedNext.textContent = `Games today: ${games}. Next up: ${next.name}`;
  }
}

// At midnight a new day starts (new boss and team): redraw the card.
setInterval(() => {
  if (app.dataset.state === 'title' && titleDate !== today()) renderTitle();
}, 1000);

// --- Running the game --------------------------------------------------------------

const megabytes = (n) => (n / 1048576).toFixed(1);

function checkBrowser() {
  if (typeof WebAssembly !== 'object' || typeof DecompressionStream !== 'function') {
    throw new Error("This browser can't run the game. Use a recent version of Chrome, Edge, Firefox or Safari.");
  }
}

function stopEmulator() {
  clearInterval(pollTimer);
  pollTimer = null;
  readGame = null;
  if (emu) {
    try {
      emu.exit();
    } catch (err) {
      console.warn('Emulator exit failed', err);
    }
    emu = null;
  }
  for (const ctx of audioContexts.splice(0)) ctx.close().catch(() => {});
}

async function startRun() {
  if (starting) return;
  starting = true;
  try {
    checkBrowser();
    stopEmulator();
    setState('loading');
    ui.loadingText.textContent = 'Downloading the game';
    ui.loadingDetail.textContent = '';
    const files = await loadGameFiles((loaded, total) => {
      ui.meter.style.width = total ? `${Math.min(100, (loaded / total) * 100)}%` : '50%';
      ui.loadingDetail.textContent = total ? `${megabytes(loaded)} of ${megabytes(total)} MB` : `${megabytes(loaded)} MB`;
    });

    runDate = today();
    stats = loadStats(); // another tab may have played meanwhile
    const seed = practiceSeed ?? gameSeed(runDate, gamesOn(stats, runDate));
    const rom = practiceSeed
      ? injectConfig(files.rom, { seed })
      : injectConfig(files.rom, { seed, wins: stats.wins, battles: stats.wins + stats.losses, daily: true });

    ui.loadingText.textContent = 'Starting the emulator';
    ui.loadingDetail.textContent = '';
    ui.meter.style.width = '100%';

    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    screen.prepend(canvas);
    emu = await Nostalgist.launch({
      core: 'mgba',
      element: canvas,
      size: { width: 720, height: 480 }, // render at 3x; CSS scales it to fit
      rom: { fileName: 'dailyred.gba', fileContent: new Blob([rom]) },
      resolveCoreJs: () => files.coreJs,
      resolveCoreWasm: () => files.coreWasm,
      retroarchConfig: {
        audio_mute_enable: muted,
        // The site never makes save states itself; uncompressed ones let the
        // debugging tools in tests/ read the game's RAM.
        savestate_file_compression: false,
        savestate_thumbnail_enable: false,
      },
    });

    readGame = createGameLink(emu, seed);
    battleSeen = false;
    recorded = false;
    pollTimer = setInterval(watchGame, 500);
    setState('playing');
  } catch (err) {
    console.error(err);
    stopEmulator();
    // fetch() rejects with a TypeError when the network itself fails.
    const hint = err instanceof TypeError ? ' Check your connection and try again.' : '';
    ui.errorText.textContent = `${err?.message || err}${hint}`;
    setState('error');
  } finally {
    starting = false;
  }
}

// Follows the game's battle: once it starts the game counts as played, the
// result goes into the stats as soon as it's known, and when the game has
// finished its closing messages we go back to the title card.
function watchGame() {
  let status;
  try {
    status = readGame?.();
  } catch {
    return;
  }
  if (!status || practiceSeed) return;
  if (status.phase >= PHASE.BATTLE) {
    battleSeen = true;
    if (!recorded) markBattleStarted(stats, runDate);
  } else if (battleSeen && status.result === RESULT.NONE) {
    // The game restarted mid-battle: that's a loss, like leaving the page.
    recordResult(stats, runDate, false);
    recorded = true;
    endDailyGame(0);
    return;
  }
  if (status.result !== RESULT.NONE && !recorded) {
    recordResult(stats, runDate, status.result === RESULT.WON);
    recorded = true;
  }
  if (status.phase === PHASE.FINISHED) endDailyGame(1000);
}

function endDailyGame(delayMs) {
  clearInterval(pollTimer);
  pollTimer = null;
  setTimeout(() => {
    stopEmulator();
    renderTitle();
    setState('title');
  }, delayMs);
}

// --- Toolbar ---------------------------------------------------------------------

// Buttons keep focus after a click, and Enter is the game's Start button, so
// hand focus back to the page to avoid triggering the button again.
function onClick(button, handler) {
  button.addEventListener('click', () => {
    button.blur();
    handler();
  });
}

onClick(ui.play, startRun);
onClick(ui.retry, startRun);

onClick(ui.sound, () => {
  if (!emu) return;
  emu.sendCommand('MUTE');
  muted = !muted;
  session.set('dailyred-muted', muted ? '1' : '0');
  showMuted();
});

function showMuted() {
  ui.sound.textContent = muted ? 'Unmute' : 'Mute';
  ui.sound.setAttribute('aria-pressed', String(muted));
}

onClick(ui.fullscreen, () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('console').requestFullscreen().catch(() => {});
});

document.addEventListener('fullscreenchange', () => {
  ui.fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});

// Don't let arrow keys and space scroll the page while playing.
window.addEventListener('keydown', (event) => {
  if (app.dataset.state === 'playing' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
    event.preventDefault();
  }
});

// Pause when the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (!emu) return;
  if (document.hidden) emu.pause();
  else emu.resume();
});

// Browsers start audio suspended unless it begins during a click; the
// emulator starts after the download, so resume it on the next interaction.
function resumeAudio() {
  for (const ctx of audioContexts) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
}
window.addEventListener('pointerdown', resumeAudio);
window.addEventListener('keydown', resumeAudio);

// --- Touch controls ------------------------------------------------------------

for (const button of document.querySelectorAll('[data-button]')) {
  const release = () => {
    if (!button.classList.contains('is-down')) return;
    button.classList.remove('is-down');
    emu?.pressUp(button.dataset.button);
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add('is-down');
    emu?.pressDown(button.dataset.button);
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

// The d-pad follows the finger, so sliding from one direction to another works.
const dpad = document.querySelector('.dpad');
let heldDirection = null;

function setDirection(next) {
  if (next === heldDirection) return;
  if (heldDirection) emu?.pressUp(heldDirection);
  if (next) emu?.pressDown(next);
  heldDirection = next;
  dpad.dataset.dir = next ?? '';
}

function directionAt(event) {
  const box = dpad.getBoundingClientRect();
  const dx = event.clientX - (box.left + box.width / 2);
  const dy = event.clientY - (box.top + box.height / 2);
  if (Math.hypot(dx, dy) < box.width * 0.12) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

dpad.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  dpad.setPointerCapture(event.pointerId);
  setDirection(directionAt(event));
});
dpad.addEventListener('pointermove', (event) => {
  if (dpad.hasPointerCapture(event.pointerId)) setDirection(directionAt(event));
});
dpad.addEventListener('pointerup', () => setDirection(null));
dpad.addEventListener('pointercancel', () => setDirection(null));

// For debugging from the console and for the automated tests.
window.dailyRed = {
  get emulator() { return emu; },
  get stats() { return { ...stats }; },
};

renderTitle();
setState('title');
showMuted();
ui.fullscreen.hidden = !document.fullscreenEnabled; // e.g. iPhone Safari
