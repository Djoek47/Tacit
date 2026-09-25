#!/bin/sh
# Assemble a single-file page: head + body + inlined SDK bundle + app script.
# usage: scripts/page.sh <dir> [head] [body] [bundle]
set -e
d=$1; h=${2:-head.html}; b=${3:-body.html}; js=${4:-$d/aiuic.bundle.js}
{ cat "$d/$h" "$d/$b"; printf '<script>\n'; cat "$js"; printf '\n</script>\n'; cat "$d/app.js"; } > "$d/index.html"
