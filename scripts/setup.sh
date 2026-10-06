#!/bin/sh
# One command after cloning: installs every package, then proves the repo works.
#   sh scripts/setup.sh
set -e
cd "$(dirname "$0")/.."
for d in packages/* apps/*; do
  if [ -f "$d/package.json" ]; then
    echo "→ $d"; (cd "$d" && npm install --no-audit --no-fund --loglevel=error)
  fi
done
echo "→ checks"
npm test >/dev/null && echo "  tests: pass"
npm run typecheck >/dev/null && echo "  typecheck: pass"
npm run eval | tail -3
