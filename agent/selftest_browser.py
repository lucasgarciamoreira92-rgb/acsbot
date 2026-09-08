#!/usr/bin/env python3
"""Optional actual-browser smoke test against the bundled loopback simulator."""
import argparse
from datetime import datetime, timezone, timedelta
import secrets
import threading
from acs_agent import Executor, encode
from simulator import make_server, model_profile, LAB_USER, LAB_PASSWORD

def main():
    parser = argparse.ArgumentParser(description="Teste local com navegador real e roteador simulado")
    parser.add_argument("--show-browser", action="store_true")
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright
    server = make_server(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    model = model_profile()
    device = {"id": "device-lab", "name": "LAB-001", "ip": "127.0.0.1", "port": server.server_port, "model": model["id"], "profileHash": "local-lab-profile"}
    job = {"version": 1, "id": "local-browser-selftest", "mode": "validate", "expires": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
           "resultKey": encode(secrets.token_bytes(32)), "devices": [device], "models": [model],
           "groups": [{"id": model["group"], "attempts": 1, "cooldown": 30, "entries": [{"id": "lab-credential", "username": LAB_USER, "password": LAB_PASSWORD}]}],
           "acs": {"url": "http://127.0.0.1:7547/cwmp", "username": "lab", "password": "lab-acs-secret", "interval": 300, "enabled": True, "verifier": "manual"}}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=not args.show_browser)
            try:
                engine = Executor(browser)
                validation = engine.execute(job, device)
                assert validation["status"] == "validated", validation
                assert server.saves == 0, "Validação gravou configuração"
                device["validation"] = {"serial": validation["serial"], "modelHash": device["profileHash"], "endpoint": f"http://127.0.0.1:{server.server_port}"}
                job["mode"] = "provision"
                result = engine.execute(job, device)
                assert result["status"] == "configured_waiting_acs", result
                assert server.saves == 1 and server.config["acs-pass"] == "lab-acs-secret"
                again = engine.execute(job, device)
                assert again["status"] == "configured_waiting_acs", again
                assert server.saves == 1, "Repetiu uma gravação desnecessária"
                print("PASSOU: navegador real, login, identidade, validação sem gravação, configuração, releitura e repetição sem nova gravação.")
                print("Escopo: simulador em 127.0.0.1. Isso não valida firmware real nem comunicação CWMP.")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

if __name__ == "__main__":
    main()
