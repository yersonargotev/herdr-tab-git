#!/bin/sh
# Entrypoint for every hook in herdr-plugin.toml. Herdr spawns argv directly
# (no shell), so this launcher exists to find a real Node.js binary even on
# machines where node is only available through a version manager like nvm.
set -eu

dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

node_bin="${HERDR_TAB_GIT_NODE:-}"
if [ -z "$node_bin" ] && command -v node >/dev/null 2>&1; then
  node_bin=node
fi
if [ -z "$node_bin" ]; then
  for cand in "$HOME"/.nvm/versions/node/*/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$cand" ] && node_bin="$cand"
  done
fi
if [ -z "$node_bin" ]; then
  echo "herdr-tab-git: no node binary found; set HERDR_TAB_GIT_NODE" >&2
  exit 1
fi

exec "$node_bin" "$dir/tab-git.js" "$@"
