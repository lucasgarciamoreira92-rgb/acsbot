#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
project_root="$PWD"
package_path="${1:-}"
if [ -z "$package_path" ]; then
  if command -v osascript >/dev/null 2>&1; then
    package_path="$(osascript -e 'POSIX path of (choose file with prompt "Selecione o pacote .acspkg baixado no ACS Pilot")')"
  else
    read -r -p "Caminho completo do pacote .acspkg: " package_path
  fi
fi
if [ ! -f "$package_path" ]; then echo "Pacote não encontrado: $package_path"; exit 1; fi
package_path="$(cd "$(dirname "$package_path")" && pwd)/$(basename "$package_path")"
if [ ! -x agent/.venv/bin/python ]; then
  agent_python=""
  for candidate in python3 python3.14 python3.13 python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then agent_python="$candidate"; break; fi
  done
  if [ -z "$agent_python" ]; then echo "Instale Python 3.11 ou superior para executar o agente."; exit 1; fi
  "$agent_python" -m venv agent/.venv
fi
if ! agent/.venv/bin/python -c 'import playwright.sync_api, cryptography' >/dev/null 2>&1; then
  agent/.venv/bin/python -m pip install -r agent/requirements.txt
fi
agent/.venv/bin/python -m playwright install chromium
mkdir -p .acs-local/results
chmod 700 .acs-local/results
cd .acs-local/results
exec "$project_root/agent/.venv/bin/python" "$project_root/agent/acs_agent.py" "$package_path" --show-browser
