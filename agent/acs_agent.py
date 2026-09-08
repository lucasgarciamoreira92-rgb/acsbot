#!/usr/bin/env python3
"""ACS Pilot local executor. Only explicitly packaged devices and selectors are used."""
from __future__ import annotations
import argparse
import base64
import contextlib
from datetime import datetime, timezone
import getpass
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = "0.2.0"
PACKAGE_AAD = b"acs-pilot/package/v1"

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

def decode(value):
    return base64.b64decode(value, validate=True)

def encode(value):
    return base64.b64encode(value).decode("ascii")

def read_json(path, limit=5_000_000):
    path = Path(path)
    if path.stat().st_size > limit:
        raise ValueError("Arquivo grande demais.")
    return json.loads(path.read_text(encoding="utf-8-sig"))

def unpack(envelope, key_text):
    if envelope.get("version") != 1 or envelope.get("algorithm") != "AES-256-GCM":
        raise ValueError("Formato de pacote não suportado.")
    key, nonce = decode(key_text.strip()), decode(envelope["nonce"])
    if len(key) != 32 or len(nonce) != 12:
        raise ValueError("Chave ou pacote inválido.")
    job = json.loads(AESGCM(key).decrypt(nonce, decode(envelope["ciphertext"]), PACKAGE_AAD))
    if job.get("version") != 1 or job.get("mode") not in ("validate", "provision"):
        raise ValueError("Versão de execução não suportada.")
    if not 1 <= len(job["devices"]) <= 100:
        raise ValueError("O pacote deve conter de 1 a 100 equipamentos.")
    if len({d["id"] for d in job["devices"]}) != len(job["devices"]):
        raise ValueError("Equipamentos duplicados.")
    return job

def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()

def sign_report(job, results):
    payload = json.dumps({"version": 1, "jobId": job["id"], "finishedAt": now(), "results": results}, ensure_ascii=False, separators=(",", ":")).encode()
    return {"jobId": job["id"], "payload": encode(payload), "signature": encode(hmac.digest(decode(job["resultKey"]), payload, "sha256"))}

def load_report(job, path):
    packet = read_json(path)
    payload = decode(packet["payload"])
    expected = hmac.digest(decode(job["resultKey"]), payload, "sha256")
    if packet.get("jobId") != job["id"] or not hmac.compare_digest(expected, decode(packet["signature"])):
        raise ValueError("O relatório não pertence a este pacote ou foi alterado.")
    result = json.loads(payload)
    if result["jobId"] != job["id"] or {r["deviceId"] for r in result["results"]} != {d["id"] for d in job["devices"]}:
        raise ValueError("Equipamentos do relatório não correspondem ao pacote.")
    return result["results"]

class ControlledError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)

class Control:
    def __init__(self):
        self.pause = threading.Event()
        self.stop = threading.Event()

    def wait(self, seconds=0):
        until = time.monotonic() + seconds
        while self.pause.is_set() or time.monotonic() < until:
            if self.stop.is_set():
                return False
            time.sleep(min(.2, max(.01, until-time.monotonic())) if not self.pause.is_set() else .2)
        return not self.stop.is_set()

def origin(url):
    u = urllib.parse.urlsplit(url)
    return (u.scheme, u.hostname, u.port or (443 if u.scheme in ("https", "wss") else 80))

def endpoint(device, model):
    ipaddress.IPv4Address(device["ip"])
    if model.get("scheme", "http") not in ("http", "https") or not 1 <= int(device["port"]) <= 65535:
        raise ValueError("Endereço do equipamento inválido.")
    return f'{model.get("scheme", "http")}://{device["ip"]}:{device["port"]}'

def relative(base, path):
    if not path.startswith("/") or path.startswith("//") or "\\" in path:
        raise ControlledError("profile_mismatch", "O roteiro contém um caminho fora do equipamento.")
    url = base + path
    if origin(url) != origin(base):
        raise ControlledError("profile_mismatch", "Destino diferente do equipamento selecionado.")
    return url

def report_values(values):
    """Keep query tokens and URL-embedded credentials out of reports."""
    safe = dict(values)
    try:
        u = urllib.parse.urlsplit(safe.get("url", ""))
        host = u.hostname or ""
        if ":" in host:
            host = "[" + host + "]"
        if u.port:
            host += ":" + str(u.port)
        safe["url"] = urllib.parse.urlunsplit((u.scheme, host, u.path, "", ""))[:500]
    except ValueError:
        safe["url"] = "[URL não exibida]"
    return safe

def one(scope, selector):
    if not selector:
        raise ControlledError("profile_mismatch", "O roteiro contém um campo obrigatório vazio.")
    field = scope.locator(selector)
    if field.count() != 1:
        raise ControlledError("profile_mismatch", "Um campo do roteiro está ausente ou corresponde a vários elementos.")
    return field

def text_value(scope, selector):
    node = one(scope, selector)
    return node.inner_text().strip()

def visible(scope, selector):
    return bool(selector and scope.locator(selector).count() == 1 and scope.locator(selector).is_visible())

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def nbi_last_inform(acs, acs_id):
    if acs.get("verifier") != "genieacs" or not acs_id or not acs.get("nbiUrl"):
        return None
    base = acs["nbiUrl"].rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return None
    query = urllib.parse.urlencode({"query": json.dumps({"_id": acs_id}), "projection": "_id,_lastInform"})
    req = urllib.request.Request(base + "/devices/?" + query, headers={"Accept": "application/json"})
    if acs.get("nbiToken"):
        req.add_header("Authorization", "Bearer " + acs["nbiToken"])
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(req, timeout=10) as response:
            data = json.loads(response.read(1_000_000))
        if isinstance(data, list) and len(data) == 1 and data[0].get("_id") == acs_id:
            stamp = data[0].get("_lastInform")
            if isinstance(stamp, str):
                return parse_time(stamp)
    except Exception:
        # Never expose URLs, authorization headers or an upstream error body.
        return None
    return None

class Executor:
    def __init__(self, browser, control=None, timeout=12_000, confirm_timeout=30):
        self.browser = browser
        self.control = control or Control()
        self.timeout = timeout
        self.confirm_timeout = confirm_timeout

    def execute(self, job, device):
        result = {"deviceId": device["id"], "status": "not_run", "message": "Não executado.", "attempts": 0}
        model = next(m for m in job["models"] if m["id"] == device["model"])
        group = next(g for g in job["groups"] if g["id"] == model["group"])
        acs = job["acs"]
        context = None
        save_sent = False
        try:
            if parse_time(job["expires"]) <= datetime.now(timezone.utc):
                raise ControlledError("not_run", "O pacote expirou. Gere um novo lote na plataforma.")
            if model.get("example") or device.get("example"):
                raise ControlledError("profile_mismatch", "Perfis ilustrativos não podem executar acessos reais.")
            base = endpoint(device, model)
            allowed = origin(base)
            attempts = min(int(group["attempts"]), len(group["entries"]), 5)
            if not 1 <= attempts <= 5:
                raise ControlledError("login_failed", "Nenhuma credencial disponível no pacote.")
            if job["mode"] == "provision":
                valid = device.get("validation", {})
                if valid.get("modelHash") != device["profileHash"] or valid.get("endpoint") != base or not valid.get("serial"):
                    raise ControlledError("profile_mismatch", "Validação anterior ausente ou incompatível com este roteiro.")
            page = None
            for index, credential in enumerate(group["entries"][:attempts]):
                if not self.control.wait():
                    return result
                if index and not self.control.wait(max(30, int(group["cooldown"]))):
                    return result
                if parse_time(job["expires"]) <= datetime.now(timezone.utc):
                    raise ControlledError("not_run", "O pacote expirou antes da próxima tentativa.")
                if context:
                    context.close()
                context = self.browser.new_context(ignore_https_errors=bool(model.get("allowSelfSigned", False)), service_workers="block", accept_downloads=False)
                context.set_default_timeout(self.timeout)
                def route(request_route):
                    if origin(request_route.request.url) == allowed:
                        request_route.continue_()
                    else:
                        request_route.abort()
                context.route("**/*", route)
                def socket_route(ws):
                    scheme, host, port = origin(ws.url)
                    if ("https" if scheme == "wss" else "http", host, port) == allowed:
                        ws.connect_to_server()
                    else:
                        ws.close()
                context.route_web_socket("**/*", socket_route)
                page = context.new_page()
                page.goto(relative(base, model["loginPath"]), wait_until="domcontentloaded")
                if visible(page, model.get("lockoutSelector")):
                    raise ControlledError("locked", "O equipamento informa bloqueio de login. Nenhuma nova tentativa.")
                one(page, model["userSelector"]).fill(credential["username"])
                one(page, model["passwordSelector"]).fill(credential["password"])
                result["attempts"] += 1
                one(page, model["submitSelector"]).click()
                deadline = time.monotonic() + self.timeout / 1000
                outcome = "unknown"
                while time.monotonic() < deadline:
                    if visible(page, model.get("lockoutSelector")):
                        raise ControlledError("locked", "Login bloqueado pelo equipamento. Tentativas interrompidas.")
                    if visible(page, model["successSelector"]):
                        outcome = "success"
                        break
                    if visible(page, model["failureSelector"]):
                        outcome = "failure"
                        break
                    page.wait_for_timeout(100)
                if outcome == "success":
                    result["credentialId"] = credential["id"]
                    break
                if outcome == "unknown":
                    raise ControlledError("unreachable", "Não foi possível distinguir sucesso de falha no login. Nenhuma outra senha foi tentada.")
                page = None
            if not page:
                raise ControlledError("login_failed", "Lista ou limite de tentativas esgotado. Sem repetição automática.")
            identity = text_value(page, model["identitySelector"])
            firmware = text_value(page, model["firmwareSelector"])
            serial = text_value(page, model["serialSelector"])
            if identity != model["identityText"] or firmware != model["firmware"] or not serial:
                raise ControlledError("profile_mismatch", "Modelo, firmware ou número de série não correspondem ao roteiro.")
            result["serial"] = serial
            if job["mode"] == "validate":
                result.update(status="validated", message="Acesso, modelo, firmware e número de série conferidos. Nenhuma configuração alterada.")
                return result
            if serial != device["validation"]["serial"]:
                raise ControlledError("profile_mismatch", "O número de série mudou desde a validação. Configuração interrompida.")
            page.goto(relative(base, model["acsPath"]), wait_until="domcontentloaded")
            for selector in model.get("navigation", []):
                one(page, selector).click()
            scope = page.frame_locator(model["frameSelector"]) if model.get("frameSelector") else page
            desired = {"url": str(acs["url"]), "username": str(acs["username"]), "interval": str(acs["interval"]), "enabled": bool(acs["enabled"]), "periodic": True}
            selectors = {"url": model["acsSelector"], "username": model.get("acsUsernameSelector", ""), "interval": model["intervalSelector"], "enabled": model["enabledSelector"], "periodic": model["periodicSelector"]}
            if not acs.get("enabled"):
                raise ControlledError("profile_mismatch", "O pacote não habilita TR-069.")
            if not selectors["username"] and desired["username"]:
                raise ControlledError("profile_mismatch", "Campo de autenticação do ACS ausente.")
            def read_values():
                values = {}
                for key, selector in selectors.items():
                    if not selector and key == "username":
                        continue
                    field = one(scope, selector)
                    values[key] = field.is_checked() if key in ("enabled", "periodic") else field.input_value()
                return values
            before = read_values()
            result["before"] = report_values(before)
            known_password_equal = one(scope, model["acsPasswordSelector"]).input_value() == acs["password"]
            already = all(before.get(k) == v for k, v in desired.items() if k in before) and known_password_equal
            prior_inform = nbi_last_inform(acs, device.get("acsId", ""))
            if not already:
                for key, selector in selectors.items():
                    if not selector:
                        continue
                    field = one(scope, selector)
                    if key in ("enabled", "periodic"):
                        field.set_checked(desired[key])
                    else:
                        field.fill(desired[key])
                one(scope, model["acsPasswordSelector"]).fill(acs["password"])
                # Set before sending: a timeout after this point has uncertain side effects.
                save_sent = True
                saved_at = datetime.now(timezone.utc)
                one(scope, model["saveSelector"]).click()
                page.wait_for_timeout(700)
                page.goto(relative(base, model["acsPath"]), wait_until="domcontentloaded")
                for selector in model.get("navigation", []):
                    one(page, selector).click()
                scope = page.frame_locator(model["frameSelector"]) if model.get("frameSelector") else page
            else:
                saved_at = datetime.now(timezone.utc)
            after = read_values()
            result["after"] = report_values(after)
            if any(after.get(k) != v for k, v in desired.items() if k in after):
                raise ControlledError("configuration_failed", "A releitura não confirmou todos os parâmetros. Revise o equipamento antes de repetir.")
            # Passwords are never captured in before/after or result messages.
            if acs.get("verifier") == "genieacs" and device.get("acsId"):
                deadline = time.monotonic() + self.confirm_timeout
                while time.monotonic() < deadline:
                    latest = nbi_last_inform(acs, device["acsId"])
                    if latest and latest >= saved_at and (prior_inform is None or latest > prior_inform):
                        result.update(status="confirmed", message="Parâmetros não secretos relidos e nova comunicação do equipamento observada no ACS.", acsConfirmedAt=latest.isoformat().replace("+00:00", "Z"))
                        return result
                    if not self.control.wait(3):
                        break
            result.update(status="configured_waiting_acs", message="Parâmetros já correspondiam ao destino; nenhuma gravação. Aguarde confirmação do ACS." if already else "Parâmetros não secretos gravados e relidos. A comunicação e a autenticação com o ACS ainda precisam ser confirmadas.")
        except ControlledError as error:
            result.update(status=error.status, message=error.message)
        except Exception:
            result.update(status="uncertain" if save_sent else "unreachable", message="A execução foi interrompida após solicitar a gravação. O estado pode ter mudado; confira antes de repetir." if save_sent else "Falha de acesso ou campo incompatível. Consulte o roteiro; nenhuma mensagem interna foi incluída no relatório.")
        finally:
            if context:
                with contextlib.suppress(Exception):
                    context.close()
        return result

@contextlib.contextmanager
def process_lock(path):
    # macOS/Linux advisory lock is released by the OS after crash/exit.
    import fcntl
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Este lote já está em execução nesta pasta.") from None
        yield
    finally:
        os.close(fd)

def run_job(job, browser, output, control, headed=False):
    del headed
    results = load_report(job, output) if Path(output).exists() else [{"deviceId": d["id"], "status": "not_run", "message": "Não executado.", "attempts": 0} for d in job["devices"]]
    engine = Executor(browser, control)
    for i, device in enumerate(job["devices"]):
        if results[i]["deviceId"] != device["id"]:
            raise ValueError("A ordem do relatório foi alterada.")
        if results[i]["status"] != "not_run":
            continue
        if not control.wait() or parse_time(job["expires"]) <= datetime.now(timezone.utc):
            break
        # Persist an uncertain marker BEFORE interaction. A crashed attempt cannot
        # be automatically replayed and accidentally consume another login/save.
        results[i] = {"deviceId": device["id"], "status": "uncertain", "message": "Execução iniciada sem resultado final. Confira o equipamento antes de repetir.", "attempts": 0}
        atomic_json(output, sign_report(job, results))
        results[i] = engine.execute(job, device)
        atomic_json(output, sign_report(job, results))
        print(f'[{i+1}/{len(results)}] {device["name"]}: {results[i]["status"]}', flush=True)
    atomic_json(output, sign_report(job, results))
    return results

def keyboard(control):
    for line in sys.stdin:
        command = line.strip().lower()
        if command == "p":
            control.pause.set()
            print("Pausa solicitada. A gravação em andamento será concluída antes de parar.", flush=True)
        elif command == "r":
            control.pause.clear()
            print("Execução retomada.", flush=True)
        elif command == "q":
            control.stop.set()
            control.pause.clear()
            print("Encerramento solicitado; o equipamento em andamento será concluído.", flush=True)
            break

def main():
    parser = argparse.ArgumentParser(description="ACS Pilot — agente local para macOS e Linux")
    parser.add_argument("package", nargs="?", help="Pacote .acspkg exportado da plataforma")
    parser.add_argument("--output", help="Relatório .json; se existir, retoma só os não executados")
    parser.add_argument("--show-browser", action="store_true", help="Exibir o navegador durante o piloto")
    parser.add_argument("--version", action="version", version=VERSION)
    args = parser.parse_args()
    if not args.package:
        parser.error("Informe o pacote .acspkg")
    try:
        envelope = read_json(args.package)
        key = getpass.getpass("Chave do pacote (não aparece ao digitar): ")
        job = unpack(envelope, key)
        del key
        if parse_time(job["expires"]) <= datetime.now(timezone.utc):
            raise ValueError("Pacote expirado. Gere outro na plataforma.")
        output = Path(args.output or f'acs-resultado-{job["id"]}.json').resolve()
        print(f'ACS Pilot {VERSION} | {job["mode"]} | {len(job["devices"])} equipamentos')
        print("p + Enter: pausar | r + Enter: retomar | q + Enter: encerrar após o equipamento atual")
        control = Control()
        signal.signal(signal.SIGINT, lambda *_: control.stop.set())
        signal.signal(signal.SIGTERM, lambda *_: control.stop.set())
        if sys.stdin.isatty():
            threading.Thread(target=keyboard, args=(control,), daemon=True).start()
        from playwright.sync_api import sync_playwright
        with process_lock(str(output) + ".lock"), sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.show_browser)
            try:
                run_job(job, browser, output, control)
            finally:
                browser.close()
        print("Relatório salvo:", output)
        print("Importe esse arquivo em Agente local na plataforma.")
    except Exception as error:
        if isinstance(error, ValueError):
            print("Erro:", str(error), file=sys.stderr)
        else:
            print("Não foi possível executar. Confira a chave, o pacote e a instalação do navegador. Nenhuma credencial foi exibida.", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
