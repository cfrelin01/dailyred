#!/usr/bin/env bash
# Builds the modified FireRed ROM with the project-local toolchain
# (see scripts/setup-macos.sh or scripts/setup-linux.sh) and puts a gzipped copy in web/game/ for the website.
#
#   scripts/build-rom.sh            # normal build
#   scripts/build-rom.sh clean      # any extra args are passed to make
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"
GAME="$ROOT/pokefirered"

if [ ! -x "$TC/arm-none-eabi/bin/arm-none-eabi-gcc" ]; then
  echo "Toolchain missing. Run scripts/setup-macos.sh (macOS) or scripts/setup-linux.sh (Linux) first."; exit 1
fi

# gbagfx asks pkg-config for libpng; clang also honours these variables,
# which lets it find our static libpng without pkg-config/Homebrew.
export CPATH="$TC/libpng/include${CPATH:+:$CPATH}"
export LIBRARY_PATH="$TC/libpng/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
# Linux: setup-linux.sh also builds zlib locally (macOS has it in the SDK).
if [ -f "$TC/zlib/lib/libz.a" ]; then
  export CPATH="$TC/zlib/include:$CPATH"
  export LIBRARY_PATH="$TC/zlib/lib:$LIBRARY_PATH"
fi
# A no-op pkg-config so the tool Makefiles don't print "command not found".
export PATH="$ROOT/scripts/shims:$PATH"

JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

if [ "$#" -gt 0 ]; then
  make -C "$GAME" -j"$JOBS" TOOLCHAIN="$TC/arm-none-eabi" MODERN=1 "$@"
  exit 0
fi

make -C "$GAME" -j"$JOBS" TOOLCHAIN="$TC/arm-none-eabi" MODERN=1

ROM="$GAME/pokefirered_modern.gba"
# The website downloads a gzipped copy (16 MB -> ~5.5 MB, mostly 0xFF padding)
# and unpacks it in the browser, so it stays small on any static host.
mkdir -p "$ROOT/web/game"
rm -f "$ROOT/web/game/dailyred.gba"
gzip -9 -n -c "$ROM" > "$ROOT/web/game/dailyred.gba.gz"
# The bosses' battle sprites for the site's title card (from the decomp, like
# the ROM). File names follow the ids in web/bosses.js.
FRONT="$GAME/graphics/trainers/front_pics"
mkdir -p "$ROOT/web/game/bosses"
cp "$FRONT/red_front_pic.png"              "$ROOT/web/game/bosses/red.png"
cp "$FRONT/champion_rival_front_pic.png"   "$ROOT/web/game/bosses/blue.png"
cp "$FRONT/elite_four_lance_front_pic.png" "$ROOT/web/game/bosses/lance.png"
cp "$FRONT/champion_steven_front_pic.png"  "$ROOT/web/game/bosses/steven.png"
cp "$FRONT/leader_wallace_front_pic.png"   "$ROOT/web/game/bosses/wallace.png"
cp "$FRONT/elite_four_lorelei_front_pic.png" "$ROOT/web/game/bosses/lorelei.png"
cp "$FRONT/elite_four_bruno_front_pic.png" "$ROOT/web/game/bosses/bruno.png"
cp "$FRONT/elite_four_agatha_front_pic.png" "$ROOT/web/game/bosses/agatha.png"
echo
echo "Built $ROM"
echo "Website copy: web/game/dailyred.gba.gz ($(wc -c < "$ROOT/web/game/dailyred.gba.gz" | tr -d ' ') bytes)"
