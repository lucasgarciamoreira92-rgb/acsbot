#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/agent"

agent_python=""
for candidate in python3 python3.14 python3.13 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    agent_python="$candidate"
    break
  fi
done
if [ -z "$agent_python" ]; then
  echo "Instale Python 3.11 ou superior e execute novamente."
  echo "https://www.python.org/downloads/macos/"
  exit 1
fi
if [ ! -d .venv ]; then
  "$agent_python" -m venv .venv
fi
if ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "O ambiente agent/.venv existente não é compatível; revise-o antes de continuar."
  exit 1
fi
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest test_agent.py
echo "Abrindo o navegador para testar apenas o simulador em 127.0.0.1."
.venv/bin/python selftest_browser.py --show-browser
