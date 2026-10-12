# Daily Red

A daily Pokémon battle in the browser, like Wordle: you press **Play**, get
six random level 100 Pokémon from Generations 1–3 (everyone gets the same
team for the same game of the day), and climb to the boss at the top of the
mountain. The boss changes every game, drawn from RED, BLUE, LANCE, STEVEN,
WALLACE, LORELEI, BRUNO and AGATHA. Game 1 of each day is the day's challenge;
you can keep playing, and games 2, 3... each have their own team and boss,
again the same for everyone. Every game counts. Your wins, losses, win streak
and daily play streak are kept in your browser.

Every battle runs on the original Pokémon FireRed engine: the game is the
[pret/pokefirered](https://github.com/pret/pokefirered) decompilation with a
small set of source changes, built into a GBA ROM and played in the browser
through the mGBA emulator compiled to WebAssembly. Nothing about battles is
reimplemented in JavaScript.

- [Quick start (macOS and Linux)](#quick-start-macos-and-linux)
- [How it works](#how-it-works)
- [Team generation](#team-generation)
- [The bosses](#the-bosses)
- [Development workflow](#development-workflow)
- [Testing and debugging](#testing-and-debugging)
- [Running it locally](#running-it-locally)
- [Copyright and licenses](#copyright-and-licenses)
- [Known limitations](#known-limitations)

## Quick start (macOS and Linux)

You need Node.js 18+ and git, plus the Xcode Command Line Tools
(`xcode-select --install`) on macOS or a C/C++ compiler, `make` and `curl` on
Linux (WSL included). No Homebrew, no `sudo`, and **no ROM**: the decompilation
builds the whole game from source.

```sh
scripts/setup-macos.sh      # (or scripts/setup-linux.sh) ARM cross-compiler + libpng into .toolchain/ (~1 GB, one time)
scripts/get-pokefirered.sh  # pret/pokefirered at a pinned commit + patches/
scripts/fetch-vendor.sh     # emulator, emulator core and font into web/vendor/
scripts/build-rom.sh        # builds the ROM, writes web/game/dailyred.gba.gz
node scripts/serve.mjs      # open http://localhost:8080
```

`setup-macos.sh` picks the right compiler for Intel or Apple Silicon Macs.
`setup-linux.sh` does the same for x86_64 or aarch64 Linux, and also builds
zlib next to libpng so no `-dev` packages are needed.

## How it works

```
pret/pokefirered @ 037335f + patches/  ──make modern──▶  pokefirered_modern.gba
                                                              │ gzip (16 MB → 5.5 MB)
web/ (static files)                                           ▼
  index.html + app.js ── fetch ──▶ game/dailyred.gba.gz, vendor/mgba_libretro.wasm
        │  writes the day's seed + your record into the ROM bytes (rom-config.js)
        ▼
  Nostalgist.js ──▶ RetroArch + mGBA core (WebAssembly) ──▶ <canvas>
        ▲
        └─ game-link.js reads the battle's status from the game's RAM
           → daily.js updates your stats in localStorage
```

**Why an emulator instead of compiling the C to WebAssembly:** the decomp is
written for GBA hardware (video, DMA, interrupts, the m4a sound engine,
ARM/Thumb assembly). Running the real ROM in mGBA keeps the battle engine,
animations and sound exactly as shipped, with no porting work. mGBA has a
built-in BIOS replacement, so no BIOS file is needed either.

**Why Nostalgist + RetroArch's mGBA core:** it accepts the ROM as raw bytes
(needed for the config below), exposes button presses and the emulator's
memory to JavaScript, and doesn't need `SharedArrayBuffer`, so a plain static
file server works without special headers. Everything loads from `web/vendor/`.

### The daily game

- **The day's team:** the seed is a hash of today's date in the player's own
  time zone (`dailySeed` in `web/daily.js`), so everyone gets the same team
  on the same calendar day, like Wordle.
- **Site → game:** the ROM contains a small struct, `gDailyRedRomConfig`: the
  magic bytes `DAILYRED-CONF-V2`, then the seed, the player's wins and battles
  so far, and a "daily" flag. Before booting, `web/rom-config.js` finds the
  magic bytes in the downloaded ROM and fills them in; no addresses are
  hard-coded on either side. The game uses the record for its "Record: x
  win(s) in x battle(s)" message.
- **Game → site:** the game keeps a status block in RAM (`sStatus` in
  `src/dailyred.c`): the magic `DAILYRED-STATUS1`, the seed, a phase (exploring
  / battle / result / finished) and a result (won / lost). `web/game-link.js`
  finds it in the emulator's WebAssembly memory (the magic followed by the
  seed it injected) and reads it twice a second.
- **Any number of games a day:** each game is one battle. It counts as played
  as soon as the boss's battle starts; closing or reloading the page
  mid-battle counts as a loss (so a reload can't be used to re-roll). The
  result is saved the moment it's known. After the closing messages the game
  fades to black and holds; the site then closes it and shows the result of
  that game and who is next. Game `n` of a day uses the seed of the date
  plus `#n` (`gameSeed` in `web/daily.js`; game 1 uses the plain date), so the
  boss and team of the next game are fixed in advance. Before the battle you
  can reload freely: it's the same team.
- **Stats** (`web/daily.js`, localStorage key `dailyred-stats`): wins, losses,
  win streak (games won in a row) and day streak (days played in a row).
  Missing a day resets both streaks.
- **Without the website** (seed 0, e.g. the ROM in a desktop emulator): the
  normal intro and title screen appear, pressing Start seeds the game the way
  vanilla FireRed does, and after each battle a new team arrives.
- **`?seed=1234`** in the URL starts a practice run for testing: that seed's
  team, no daily limit, nothing saved, and a new team after each battle. It
  isn't shown anywhere in the UI.

### Game flow and the files involved

| Step | Code |
|---|---|
| Copyright screen → straight in (seed set) | `src/intro.c` → `CB2_DailyRed_StartFromCopyright` (`src/dailyred.c`) |
| Title screen → straight in (no seed) | `src/title_screen.c` → `CB2_DailyRed_StartFromTitle` |
| New game data: LEAF (FireRed's female player), fast text | `StartNewGame` in `src/dailyred.c`, then vanilla `CB2_NewGame` |
| Team + warp to the summit instead of the bedroom | `src/new_game.c` → `DailyRed_InitNewGame` |
| The summit: an open peak with no exits; stairs up to RED, who faces the drop | `data/maps/DailyRed_Summit/`, `data/layouts/DailyRed_Summit/` |
| Snow on the summit (fixes FireRed's unused snow weather, whose flakes never came back) | `src/field_weather_effects.c` |
| Talking to RED → battle → "You defeated RED!" / "Your team was wiped out…" → record → "Play again tomorrow!" / "Try again tomorrow." → fade out | `data/maps/DailyRed_Summit/scripts.inc` and `text.inc`; the `DailyRed_On*` specials in `src/dailyred.c` |
| Mountain battle background on the summit | `BattleSetup_GetTerrainId` in `src/battle_setup.c` |
| No free switch when RED's Pokémon faints: Battle Style starts on SET and is locked in Options | `StartNewGame` in `src/dailyred.c`, `src/option_menu.c` |
| The bosses as trainers | `TRAINER_DAILYRED_*` in `include/constants/opponents.h`, `src/data/trainers.h`, `src/dailyred_boss.c` |
| Menus: POKéMON / OPTION / EXIT; party: SUMMARY / SWITCH / CANCEL | `src/start_menu.c`, `src/party_menu.c`; window height for short menus in `src/new_menu_helpers.c` |
| RED's overworld sprite, in its own palette slot so it doesn't clash with LEAF's | `OBJ_EVENT_GFX_DAILYRED_RED` in `include/constants/event_objects.h`, `src/data/object_events/` |

The battle itself is a standard FireRed trainer battle. The map script uses
`trainerbattle_earlyrival` with `RIVAL_BATTLE_HEAL_AFTER`, the mode FireRed
uses for the rival fight in Oak's lab, so losing doesn't white out. The script
then reads `VAR_RESULT`, updates a win/battle counter, calls the
`DailyRed_StartNextRun` special (new team) and warps back to the start tile,
which also resets RED.

Every vanilla file that was changed has a `Daily Red:` comment at the change:

```sh
grep -rn "Daily Red" pokefirered/src pokefirered/include pokefirered/data
```

The summit layout is a copy of Navel Rock's summit (the peak where Ho-Oh
appears) with the arrival ladder removed. RED stands on the tip at (9, 11)
facing north, out over the drop, and turns around when you talk to him. The project uses pokefirered's `modern` target (GCC 14),
not the byte-matching `agbcc` build, so it doesn't reproduce the retail ROM.

## Team generation

`pokefirered/src/dailyred_team.c` builds each team with the decomp's own data
(`gLevelUpLearnsets`, `CanMonLearnTMHM`, the TM/HM move table,
`CreateMon`, `CalculateMonStats`):

- **Species:** 6 different Pokémon from all 386 of Generations 1–3 whose
  **base stat totals add up to at least 2750** (`MIN_TEAM_BASE_STAT_TOTAL`).
  **Legendaries are a 1-in-8 roll** (`LEGENDARY_TEAM_ODDS`): 1 team in 8 gets
  exactly one legendary or mythical Pokémon, in a random party slot, and the
  other 7 get none. The generator then redraws the rest of the team until it
  meets the minimum, so every qualifying team is equally likely. Per-species
  rules live in `IsEligibleSpecies`, e.g. add "fully evolved only" there.

  Why a minimum: RED's team totals 2954 (see below). A fully random team
  averages about 2430, and two thirds of them include a Pokémon under 300,
  which made most runs hopeless. A team can still include one weak Pokémon if
  the rest make up for it.

  Why legendaries are a separate roll: they average 613 against 393 for
  everything else, so a stat minimum on its own mostly gets met by drawing
  one. With a 2750 minimum alone, 70% of teams had a legendary and 20% had two
  or more.

  How the minimum sets the difficulty: with the IVs and EVs below, a team's
  actual in-battle stat total is almost exactly 2 × its base stat total +
  2580, and RED's is 8555. So each minimum gives:

  | Minimum | Typical team vs RED | Weakest possible | Teams stronger than RED |
  |---|---|---|---|
  | 2600 | 94% | 91% | about 1 in 45 |
  | 2650 | 95% | 92% | about 1 in 34 |
  | 2700 | 96% | 93% | about 1 in 25 |
  | **2750** | **97%** | **94%** | **about 1 in 17** |

  (Odds from simulating 80,000 teams.) Measured in the real ROM at 2700 over
  80 runs (before the bosses' IVs were lowered to 26, which makes them a little weaker than these figures): typical team 95% of RED's stats, range 93–101%, 1 team stronger
  than RED. RED also has hand-picked moves, chosen held items (his Pikachu's
  Light Ball doubles its Sp. Atk) and the strongest trainer AI, so he stays
  the favourite.

- **Moves:** up to 4 different moves picked uniformly from everything the
  species can learn **by level-up (any level) or TM/HM**. One rule on top: if
  none of the four can deal damage and the species has any damaging move, one
  pick is swapped for a damaging move. Species with fewer than 4 learnable moves
  (Ditto, Unown, Magikarp, Smeargle…) get all of them.
- **Stats:** level 100, random personality (so random nature, gender, ability
  and the usual 1/8192 shiny chance), and trained close to RED's level:
  - **IVs** random from 25 to 31 in every stat (`MIN_TEAM_IV`); the bosses' are 26 (`BOSS_IV` in `src/dailyred_boss.c`).
  - **EVs** 252 into each of its two highest base stats and the last 6 into
    HP, or into its third-best stat if HP is one of the two
    (`AssignFocusedEVs`). Attack and Sp. Atk only count if one of its attacks
    uses them (in Gen 3 a move's type decides which), so a Gyarados with only
    Surf and Ice Beam doesn't waste points on Attack. Fast Pokémon end up as
    fast as RED's; slow walls put their points into bulk instead.

  The player is the original trainer, so everything obeys, and Pokémon are
  marked as event Pokémon so Mew and Deoxys obey too.
- **Held items:** each Pokémon holds one, picked uniformly from a pool of
  generally useful battle items (`sBattleItems`: Leftovers, Choice Band,
  Quick Claw, Lum Berry, pinch berries…) plus the 10% type booster for each
  type it actually attacks with (Charcoal only if it has a Fire attack, and
  so on). There are still no bag items.
- **Safety:** each Pokémon is validated (level, HP, at least one move, no
  duplicate moves, PP). If a Pokémon somehow failed 10 times, the game would
  use FireRed's own default level-100 moveset for it rather than hand over
  something broken.

Trade-offs in this first version: the move picker ignores move tutors and egg
moves (add them in `GetLearnableMoves`), and it's deliberately not
competitive. Splash, Water Sport or three status moves plus one attack are all
possible. Items are picked without looking at the moveset beyond type
boosters, so a Choice Band can land on a Pokémon that mostly uses status
moves, and species-specific items (Light Ball, Thick Club…) aren't in the pool.
The generator uses its own RNG state, separate from the game's `Random()`, so
teams depend only on the seed.

## The bosses

Each run's boss comes from the seed, so everyone gets the same boss on the same
day. The choice is `BossIndexForRun` in `pokefirered/src/dailyred.c` (murmur3's
32-bit finalizer on the seed, modulo the number of bosses); the website
repeats the same few lines in `web/bosses.js` to show today's boss on the title
card without reading the ROM. A practice run that starts over (no daily limit)
takes the next boss in that sequence.

| # | Boss | Team (base stat total) |
|---|---|---|
| 0 | RED | Pikachu, Espeon, Snorlax, Venusaur, Charizard, Blastoise (2954) |
| 1 | BLUE | Pidgeot, Alakazam, Rhydon, Gyarados, Exeggutor, Arcanine (3059) |
| 2 | LANCE | Gyarados, Charizard, Aerodactyl, Dragonair, Altaria, Dragonite (3099) |
| 3 | STEVEN | Skarmory, Claydol, Aggron, Cradily, Armaldo, Metagross (3085) |
| 4 | WALLACE | Milotic, Walrein, Ludicolo, Whiscash, Seaking, Starmie (2988) |
| 5 | LORELEI | Dewgong, Cloyster, Slowbro, Jynx, Lapras, Glalie (2960) |
| 6 | BRUNO | Steelix, Hitmonlee, Hitmonchan, Hariyama, Machamp, Blaziken (2929) |
| 7 | AGATHA | Gengar, Crobat, Muk, Banette, Arbok, Gengar (2928) |

Edit **`pokefirered/src/dailyred_boss.c`**: species, level, IVs, held item and
moves use FireRed's normal `TrainerMonItemCustomMoves` format, plus an EV
table per boss. All teams are level 100 with IVs of 26, held items and full
EV spreads. RED's is his Mt. Silver team from HeartGold/SoulSilver; the others
are inspired by the same champions and Elite Four across the Kanto and Hoenn
games. Movesets are adapted to Gen 3 moves, and only Gen 1–3 species are used.
Base stat totals stay close to RED's 2954 (`tests/bosses.mjs` enforces
2850–3200) so a day's difficulty mostly depends on your team. The stronger
bosses (LANCE, STEVEN, BLUE) are about 4-5% above RED, so expect those days to be
a bit harder than the original. With your team's IVs (25–31) and focused EVs,
both sides get about the same out of their base stats; natures for the bosses
come from FireRed's fixed name-based formula and aren't configurable.

The bosses use the trainer AI without `AI_SCRIPT_TRY_TO_FAINT` (the original RED had it), which makes them a bit less eager to go for a KO. Each boss has a trainer entry (`[TRAINER_DAILYRED_*]` in
`pokefirered/src/data/trainers.h`, ids in `include/constants/opponents.h`)
with his name, trainer class, battle sprite and AI flags; the class decides the
battle music and transition, as for the original trainers. The summit map
script always names `TRAINER_DAILYRED_RED`, and `StartTrainerBattle`
(`src/battle_setup.c`) swaps in the run's boss. FireRed trainers have no EVs,
so a hook in `CreateNPCTrainerParty` (`src/battle_main.c`) applies the boss's
EV table. The boss's overworld sprite on the summit is set per run through
`VAR_OBJ_GFX_ID_0`; STEVEN and WALLACE have no overworld sprite in FireRed, so
they borrow a similar-looking one.

**Adding a boss:** add a trainer id (and bump `NUM_TRAINERS`) in
`include/constants/opponents.h`, an entry in `src/data/trainers.h`, a party
and EV table plus a row in `sBosses` in `src/dailyred_boss.c`, an `extern` in
`include/dailyred.h` (raise `DAILYRED_NUM_BOSSES`), the same boss at the same
position in `BOSSES` in `web/bosses.js`, and his battle sprite in
`scripts/build-rom.sh`. Adding or reordering bosses changes which boss each
seed gets. `cd tests && npm run bosses` checks the data, the order and that the
ROM and website agree.

## Development workflow

1. Edit files in `pokefirered/` (a git checkout of pret's repo).
2. `scripts/build-rom.sh` (incremental builds take a few seconds).
3. Reload the page. `scripts/serve.mjs` sends `Cache-Control: no-cache`.
4. When you're happy, run `scripts/save-patch.sh` and commit
   `patches/pokefirered-dailyred.patch`.

`pokefirered/`, `.toolchain/`, `web/vendor/` and `web/game/` are not tracked
(see `.gitignore`); a clean checkout recreates them with the scripts above.
`git -C pokefirered diff` shows all game changes against upstream.

To play the ROM outside the browser, open
`pokefirered/pokefirered_modern.gba` in mGBA or any GBA emulator. Without an
injected seed it boots to the title screen; press Start.

The website has no build step: plain HTML, CSS and ES modules in `web/`.

## Testing and debugging

The tests boot the real ROM in headless Chrome through the same emulator the
website uses, press buttons, and read game RAM out of emulator save states
(mGBA's state contains a raw copy of RAM).

```sh
cd tests
npm install        # playwright-core only; it drives your installed Google Chrome
npm run smoke      # the game loop (~3 min)
npm run site       # the website on desktop and phone (~1 min)
npm run teams -- 1 2 3            # print + validate the teams for these seeds
npm run teams -- --random 40      # 40 random seeds
```

`npm run smoke` checks that:
- each seed's team is valid: 6 different real Gen 1–3 species with a combined
  base stat total of at least 2750 and at most one legendary, level 100, full
  HP, IVs 25–31, EVs exactly as `AssignFocusedEVs` would place them (checked
  by an independent JavaScript copy of the rule), an item from the pool (type boosters only with a
  matching attack), and every move learnable by the species. The
  learnable-move check parses the decomp's data files in JavaScript, so it's
  independent of the C generator.
- the same seed gives the same team, and different seeds give different ones.
- the player starts at the foot of the stairs, RED faces away from them (and
  again after every run), and talking to RED starts a trainer battle on the
  mountain background.
- battle style is SET from the start, the Options menu can't change it, and
  when one of RED's Pokémon is knocked out he sends the next one with no
  "Will LEAF change POKéMON?" prompt.
- RED's in-battle party is the configured team with IVs, items and EVs.
- a win and a loss are each handled: no white-out, counters updated, and a new
  valid team afterwards.
- the daily game starts from the website's record, reports the battle start,
  the result and the end, counts the battle in its record message, and
  ignores input once it's over (no second battle).
- without a seed, the title screen appears and Start leads into the game.

The win and loss are forced by editing HP values in a save state, which makes
them quick and deterministic. Screenshots of every step are saved in
`tests/output/`.

`npm run site` plays the game over five faked days (Playwright's clock):
a fresh visitor, a win (stats, "Play again", survives a reload), the same
team in a second browser that day, a second game the same day (new team and
boss, counted), a loss the next day,
leaving mid-battle (counts as a loss), a missed day (streaks reset), and a
practice run (`?seed=`, not recorded). It also checks the 3× (720×480)
screen, the boss's sprite, the phone layout and touch d-pad, and the download-error
screen with "Try again".

**Checking by hand:** open `http://localhost:8080/?seed=42` for a practice run
(nothing saved, no daily limit). To reset your daily stats, run
`localStorage.removeItem('dailyred-stats')` in the browser console.

**In the browser console:** `dailyRed.emulator` is the running Nostalgist
instance and `dailyRed.stats` shows your saved stats.

## Running it locally

Daily Red is meant to be played on your own computer. After the quick start,
`web/` holds the whole site (about 9 MB), and `node scripts/serve.mjs` serves
it at http://localhost:8080:

```
web/index.html  app.js  daily.js  game-link.js  game-files.js  rom-config.js  style.css  favicon.svg  licenses.txt
web/vendor/     emulator (3.4 MB) + font
web/game/       dailyred.gba.gz (5.5 MB), built on your machine
```

To use another port, pass it: `node scripts/serve.mjs 3000`. Your stats are
saved in the browser for that address, so keep using the same port to keep
your streaks. After rebuilding the ROM (`scripts/build-rom.sh`), reload the
page.

## Copyright and licenses

Daily Red is a free, unofficial fan project. It isn't affiliated with or
endorsed by Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company.
Pokémon and all related names, characters and game content are © Nintendo,
Creatures Inc. and GAME FREAK inc.

This repository contains Daily Red's own work: the changes in `patches/`, the
website and the tests. It doesn't include pret/pokefirered or a built ROM; the
scripts fetch the decompilation from pret's repository and build locally.

The emulator core is GPL-3.0 (RetroArch) and MPL-2.0 (mGBA). `web/licenses.txt`
lists all third-party components with links to their source, and the page
footer links to it.

## Known limitations

- **Movement:** running shoes and the bike are off on the summit; it's only
  a few steps to the top.
- **Stats live in the browser:** clearing site data resets them, they don't
  follow you to another device or browser, and anyone can edit their own
  localStorage. That's fine for a casual daily game; there's no server.
- **Time zones:** the day changes at local midnight, so players in different
  time zones get each team at different times (as with Wordle).
- **Soft reset** (A+B+Start+Select) is turned off in the daily game, so a
  losing battle can't be restarted. (If the game ever restarts mid-battle
  anyway, the site counts it as a loss.)
- **Audio** can't be checked by the headless tests. Browsers start audio
  suspended unless it begins during a click, so the game resumes it on the
  next key press or tap.
- **Tested environment:** macOS and Linux (WSL) with Google Chrome/Chromium
  (headless, desktop and phone emulation). Not yet tried on Safari, Firefox or real phones.
- The L/R buttons still open FireRed's built-in help, which describes the
  normal game.

## Project layout

```
patches/pokefirered-dailyred.patch   all changes to pret/pokefirered
scripts/setup-macos.sh               toolchain (xPack arm-none-eabi-gcc 14.2.1 + libpng)
scripts/setup-linux.sh               the same for Linux (also builds zlib)
scripts/get-pokefirered.sh           pinned upstream checkout + patch
scripts/save-patch.sh                pokefirered/ changes → patches/
scripts/build-rom.sh                 make modern → web/game/dailyred.gba.gz
scripts/fetch-vendor.sh              Nostalgist, mGBA core, font (pinned, checksummed)
scripts/serve.mjs                    local static server
web/                                 the website
tests/                               headless browser tests and the teams tool
```

Inside `pokefirered/`, the Daily Red code is `include/dailyred.h`,
`include/constants/dailyred.h`, `src/dailyred.c` (game flow and seed),
`src/dailyred_team.c` (team generator), `src/dailyred_boss.c` (the bosses' teams), and
`data/maps/DailyRed_Summit/` plus `data/layouts/DailyRed_Summit/` (the map).
