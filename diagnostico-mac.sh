#!/usr/bin/env bash
# M0: somente leitura; não instala, inicia serviços ou acessa roteadores.
set -eu
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este diagnóstico deve ser executado no Mac onde o ACSBot será usado."
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 não encontrado. Envie este resultado e um print de Sobre Este Mac."
  exit 2
fi
exec python3 - <<'PY'
import datetime
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys

root = pathlib.Path.cwd()
pending = []

def run(args, timeout=6):
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, timeout=timeout)
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        return -1, ""

def show(label, value):
    # Relatório curto: sem saída bruta de erros, ambiente, caminhos ou credenciais.
    clean = " ".join(str(value).split())
    clean = "".join(c for c in clean if c.isprintable())
    print("{}: {}".format(label, clean[:220] or "não identificado"), flush=True)

def value(args):
    code, output = run(args)
    return output if code == 0 else "não identificado"

print("ACSBot — diagnóstico M0 (somente leitura)", flush=True)
show("Data UTC", datetime.datetime.now(datetime.timezone.utc).isoformat())
show("macOS", value(["/usr/bin/sw_vers", "-productVersion"]))
show("Modelo Mac", value(["/usr/sbin/sysctl", "-n", "hw.model"]))
show("Processador", value(["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"]))
show("Arquitetura do processo", platform.machine())
show("Suporte ARM64", value(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"]))
show("Execução via Rosetta", "sim" if value(["/usr/sbin/sysctl", "-n", "sysctl.proc_translated"]) == "1" else "não detectada")
memory = value(["/usr/sbin/sysctl", "-n", "hw.memsize"])
show("Memória RAM", "{:.1f} GiB".format(int(memory) / 1024**3) if memory.isdigit() else memory)
show("Espaço livre no disco do projeto", "{:.1f} GiB".format(shutil.disk_usage(root).free / 1024**3))

print("\nBase e dependências", flush=True)
show("Commit local", value(["git", "rev-parse", "HEAD"]))
code, status = run(["git", "status", "--porcelain"])
show("Alterações locais", "sim; preservar antes de atualizar" if code == 0 and status else ("nenhuma" if code == 0 else "não identificado"))
show("Python do diagnóstico", platform.python_version())
agent_python = root / "agent/.venv/bin/python"
agent_cmd = str(agent_python) if agent_python.is_file() else sys.executable
code, version = run([agent_cmd, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"])
show("Python disponível para o agente", version if code == 0 else "indisponível")
if code != 0 or tuple(int(n) for n in version.split(".")) < (3, 11):
    pending.append("Preparar Python 3.11 ou superior para o agente.")

node = shutil.which("node")
for prefix in ("/opt/homebrew/opt/node@22/bin", "/usr/local/opt/node@22/bin"):
    if node:
        code, version = run([node, "-p", "process.versions.node"])
        if code == 0 and re.fullmatch(r"\d+\.\d+\.\d+", version) and tuple(map(int, version.split("."))) >= (22, 13, 0):
            break
    candidate = pathlib.Path(prefix) / "node"
    if candidate.is_file():
        node = str(candidate)
if node:
    code, version = run([node, "-p", "process.versions.node"])
    show("Node disponível para o painel", version if code == 0 else "indisponível")
    if code != 0 or not re.fullmatch(r"\d+\.\d+\.\d+", version) or tuple(map(int, version.split("."))) < (22, 13, 0):
        pending.append("Preparar Node.js compatível com o painel (mínimo atual: 22.13).")
else:
    show("Node disponível para o painel", "não encontrado")
    pending.append("Preparar Node.js e npm para o painel.")
show("npm no PATH", value(["npm", "--version"]))
code, browser = run([agent_cmd, "-c", "from pathlib import Path; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print('presente' if Path(p.chromium.executable_path).is_file() else 'ausente'); p.stop()"])
show("Chromium do Playwright", browser if code == 0 else "dependência não disponível neste Python")

print("\nDocker local", flush=True)
desktop = pathlib.Path("/Applications/Docker.app").exists() or (pathlib.Path.home() / "Applications/Docker.app").exists()
show("Docker Desktop", "aplicativo encontrado" if desktop else "aplicativo não encontrado nos locais usuais")
docker = shutil.which("docker")
if not docker and pathlib.Path("/Applications/Docker.app/Contents/Resources/bin/docker").is_file():
    docker = "/Applications/Docker.app/Contents/Resources/bin/docker"
if not docker:
    show("Docker CLI", "não encontrado")
    pending.append("Instalar ou localizar o Docker Desktop e seu comando docker.")
else:
    show("Docker CLI", value([docker, "--version"]))
    code, compose = run([docker, "compose", "version", "--short"])
    show("Docker Compose", compose if code == 0 else "indisponível")
    if code != 0:
        pending.append("Disponibilizar Docker Compose.")
    # Identifica o destino efetivo sem conectar a um daemon remoto.
    context = os.environ.get("DOCKER_CONTEXT")
    endpoint = os.environ.get("DOCKER_HOST") if not context else None
    if endpoint is None:
        args = [docker, "context", "inspect"] + ([context] if context else [])
        code, endpoint = run(args + ["--format", "{{.Endpoints.docker.Host}}"])
        if code != 0:
            endpoint = ""
    if not endpoint.startswith("unix://"):
        show("Docker Engine", "destino remoto ou não identificado; conexão não realizada")
        pending.append("Selecionar um Docker Engine local para este projeto.")
    else:
        code, info = run([docker, "info", "--format", '{{json .}}'], timeout=10)
        try:
            data = json.loads(info) if code == 0 else None
        except ValueError:
            data = None
        if isinstance(data, dict) and data.get("ServerVersion"):
            show("Docker Engine local", data["ServerVersion"])
            show("Arquitetura do Engine", data.get("Architecture", "não identificado"))
            allocated = data.get("MemTotal")
            if isinstance(allocated, (int, float)):
                show("Memória disponibilizada ao Engine", "{:.1f} GiB".format(allocated / 1024**3))
        else:
            show("Docker Engine local", "sem resposta; verifique se o Docker está aberto")
            pending.append("Iniciar ou verificar o Docker Engine local.")

print("\nRede e portas locais", flush=True)
code, route = run(["/sbin/route", "-n", "get", "default"])
match = re.search(r"^\s*interface:\s*(\S+)", route, re.MULTILINE) if code == 0 else None
if match:
    interface = match.group(1)
    show("Interface da rota padrão", interface)
    show("IPv4 nessa interface", value(["/usr/sbin/ipconfig", "getifaddr", interface]))
else:
    show("Rota padrão", "não identificada")
print("O IP acima é uma referência; a rota da rede de gerência/VPN ainda será conferida.", flush=True)
for port, service in ((8787, "painel"), (7547, "CWMP"), (7557, "NBI"), (3000, "UI GenieACS"), (7567, "arquivos opcional")):
    code, listeners = run(["/usr/sbin/lsof", "-nP", "-iTCP:{}".format(port), "-sTCP:LISTEN", "-t"])
    state = "ocupada; identificar o serviço antes do M1" if listeners and code == 0 else ("nenhum listener visível" if code == 1 else "não foi possível verificar")
    show("Porta {} ({})".format(port, service), state)
print("Portas: observação sem sudo; ausência de listener visível não garante disponibilidade.", flush=True)

db = root / ".acs-local/data/acsbot.sqlite"
key = root / ".acs-local/data/vault.key"
show("Banco local", "presente (conteúdo não lido)" if db.exists() else "ainda não encontrado")
show("Chave local", "presente (conteúdo não lido)" if key.exists() else "ainda não encontrada")
if db.exists() and not key.exists():
    pending.append("Banco existente sem chave: recuperar a chave original antes de iniciar o painel.")

print("\nPendências para fechar M0", flush=True)
for item in pending:
    print("- " + item, flush=True)
print("- Informar fabricante/modelo/firmware do primeiro equipamento e sua porta web.")
print("- Confirmar acesso pelo Mac e definir IP reservado/DNS alcançável pelos equipamentos.")
print("- Conferir suporte do macOS e fixar versões/imagens após analisar este relatório.")
print("M0 EM ANDAMENTO. Este relatório não valida comunicação TR-069 nem instala o GenieACS.")
PY
