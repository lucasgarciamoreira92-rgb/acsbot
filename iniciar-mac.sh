#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077

valid_node() {
  command -v node >/dev/null 2>&1 && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' >/dev/null 2>&1
}
if ! valid_node; then
  for prefix in /opt/homebrew/opt/node@22/bin /usr/local/opt/node@22/bin; do
    if [ -x "$prefix/node" ]; then export PATH="$prefix:$PATH"; break; fi
  done
fi
if ! valid_node; then
  if command -v brew >/dev/null 2>&1; then
    echo "Instalando Node.js para executar o painel neste Mac…"
    brew install node@22
    export PATH="$(brew --prefix node@22)/bin:$PATH"
  else
    echo "O painel precisa de Node.js 22.13 ou superior."
    echo "Instale a versão LTS em https://nodejs.org/ e execute este comando novamente."
    exit 1
  fi
fi
if ! valid_node || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js ou npm não está disponível. Reabra o Terminal após instalar."
  exit 1
fi
mkdir -p .acs-local
signature="$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto"); console.log(crypto.createHash("sha256").update(fs.readFileSync("package-lock.json")).update(fs.readFileSync("package.json")).digest("hex"))')"
installed="$(cat .acs-local/install.signature 2>/dev/null || true)"
if [ ! -d node_modules/vite ] || [ "$signature" != "$installed" ]; then
  echo "Instalando as dependências do painel…"
  npm ci
  printf '%s' "$signature" > .acs-local/install.signature
fi
node local/build.mjs
exec node local/server.mjs
