#!/usr/bin/env python3
"""Local form-based lab router. Listens only on loopback; never runs CWMP."""
import argparse
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

LAB_USER = "operator"
LAB_PASSWORD = "correct-test-password"

def model_profile():
    return {
        "id": "model-lab", "brand": "ACS Pilot Lab", "name": "LAB ROUTER",
        "type": "Roteador", "firmware": "1.0", "group": "group-lab", "ready": True,
        "scheme": "http", "allowSelfSigned": False, "loginPath": "/", "acsPath": "/acs",
        "userSelector": "#user", "passwordSelector": "#password", "submitSelector": "#login",
        "successSelector": "#success", "failureSelector": "#failure", "lockoutSelector": "#locked",
        "identitySelector": "#model", "identityText": "LAB ROUTER", "firmwareSelector": "#firmware",
        "serialSelector": "#serial", "acsSelector": "#acs", "acsUsernameSelector": "#acs-user",
        "acsPasswordSelector": "#acs-pass", "enabledSelector": "#enabled",
        "periodicSelector": "#periodic", "intervalSelector": "#interval", "saveSelector": "#save",
        "frameSelector": "", "navigation": [],
    }

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def authenticated(self):
        return "acs_lab_session=lab-only" in self.headers.get("Cookie", "").split("; ")

    def page(self, content):
        body = ("<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>ACS Pilot Lab</title>"
                "<style>body{font:16px system-ui;max-width:600px;margin:60px auto;background:#eef5f3}"
                "main{padding:32px;background:white;border-radius:18px}label{display:block;margin:14px 0}"
                "input{padding:8px}button{padding:10px 20px}small{color:#536760}</style>"
                "<main><h1>Roteador de laboratório</h1><small>Simulador local · nenhuma comunicação CWMP</small>"
                + content + "</main></html>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, path, cookie=False):
        self.send_response(303)
        self.send_header("Location", path)
        if cookie:
            self.send_header("Set-Cookie", "acs_lab_session=lab-only; HttpOnly; SameSite=Strict; Path=/")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        route = urlsplit(self.path)
        if route.path not in ("/", "/acs"):
            self.send_error(404)
            return
        if not self.authenticated():
            error = "<p id='failure'>Credencial inválida</p>" if route.query == "failed=1" else ""
            self.page(error + "<form method='post' action='/login'>"
                      "<label>Usuário <input id='user' name='user' autocomplete='username'></label>"
                      "<label>Senha <input id='password' name='password' type='password' autocomplete='current-password'></label>"
                      "<button id='login'>Entrar</button></form>")
            return
        identity = "<p id='success'>Autenticado</p><p>Modelo: <b id='model'>LAB ROUTER</b></p><p>Firmware: <b id='firmware'>1.0</b></p><p>Série: <b id='serial'>LAB-001</b></p>"
        if route.path == "/":
            self.page(identity + "<a href='/acs'>Configuração ACS</a>")
            return
        fields = ""
        for key, label in (("acs", "URL ACS"), ("acs-user", "Usuário ACS"), ("acs-pass", "Senha ACS"), ("interval", "Intervalo")):
            value = escape(str(self.server.config[key]), quote=True)
            kind = "password" if key == "acs-pass" else "text"
            fields += f"<label>{label} <input id='{key}' name='{key}' type='{kind}' value='{value}'></label>"
        for key, label in (("enabled", "TR-069"), ("periodic", "Inform periódico")):
            checked = "checked" if self.server.config[key] else ""
            fields += f"<label><input id='{key}' name='{key}' type='checkbox' {checked}> {label}</label>"
        self.page(identity + "<form method='post' action='/save'>" + fields + "<button id='save'>Salvar</button></form>")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 16_384:
            self.send_error(413)
            return
        data = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True)
        value = lambda key: data.get(key, [""])[0]
        if self.path == "/login":
            self.server.logins += 1
            ok = value("user") == LAB_USER and value("password") == LAB_PASSWORD
            self.redirect("/" if ok else "/?failed=1", cookie=ok)
        elif self.path == "/save" and self.authenticated():
            self.server.saves += 1
            for key in ("acs", "acs-user", "acs-pass", "interval"):
                self.server.config[key] = value(key)
            for key in ("enabled", "periodic"):
                self.server.config[key] = key in data
            self.redirect("/acs")
        else:
            self.send_error(403)

def make_server(port=8765):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.config = {"acs": "http://127.0.0.1:7547/cwmp", "acs-user": "", "acs-pass": "", "interval": "60", "enabled": False, "periodic": False}
    server.logins = server.saves = 0
    return server

def main():
    parser = argparse.ArgumentParser(description="Simulador local do ACS Pilot")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--export-model", default="modelo-laboratorio.json")
    args = parser.parse_args()
    Path(args.export_model).write_text(json.dumps(model_profile(), indent=2, ensure_ascii=False), encoding="utf-8")
    with make_server(args.port) as server:
        print(f"Simulador: http://127.0.0.1:{server.server_port}", flush=True)
        print(f"Credencial fictícia: {LAB_USER} / {LAB_PASSWORD}", flush=True)
        print(f"Roteiro JSON: {args.export_model} | Ctrl+C para encerrar", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    main()
