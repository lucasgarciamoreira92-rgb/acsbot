"""Contract tests. FakeBrowser emulates the required Playwright API; no browser QA."""
import copy
from datetime import datetime, timezone, timedelta
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import acs_agent as agent

class InstantControl(agent.Control):
    def __init__(self):
        super().__init__()
        self.waits = []
    def wait(self, seconds=0):
        self.waits.append(seconds)
        return not self.stop.is_set()

class FakeField:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector
    def count(self):
        return 0 if self.selector == "#missing" else 2 if self.selector == "#ambiguous" else 1
    def is_visible(self):
        return {"#success": self.page.authenticated, "#failure": self.page.failed, "#locked": self.page.browser.locked}.get(self.selector, True)
    def fill(self, value):
        self.page.values[self.selector] = value
    def click(self):
        if self.selector == "#login":
            self.page.browser.logins += 1
            self.page.authenticated = self.page.values.get("#password") == "correct-test-password"
            self.page.failed = not self.page.authenticated
            if self.page.browser.ambiguous_login:
                self.page.authenticated = self.page.failed = False
        if self.selector == "#save":
            self.page.browser.saves += 1
            if self.page.browser.fail_after_save:
                raise RuntimeError("Internal diagnostic that must not be exposed")
            if not self.page.browser.reject_save:
                self.page.browser.config.update(self.page.values)
    def inner_text(self):
        return {"#model": "LAB ROUTER", "#firmware": self.page.browser.firmware, "#serial": self.page.browser.serial}.get(self.selector, "")
    def input_value(self):
        return self.page.values.get(self.selector, "")
    def is_checked(self):
        return bool(self.page.values.get(self.selector, False))
    def set_checked(self, value):
        self.fill(value)

class FakePage:
    def __init__(self, browser):
        self.browser = browser
        self.authenticated = self.failed = False
        self.values = dict(browser.config)
    def locator(self, selector): return FakeField(self, selector)
    def goto(self, url, **kwargs):
        self.url = url
        if url.endswith("/acs"):
            self.values = dict(self.browser.config)
    def wait_for_timeout(self, amount): pass
    def frame_locator(self, selector): return self

class FakeContext:
    def __init__(self, browser): self.browser = browser
    def set_default_timeout(self, timeout): pass
    def route(self, pattern, callback): self.browser.route = callback
    def route_web_socket(self, pattern, callback): pass
    def new_page(self): return FakePage(self.browser)
    def close(self): pass

class FakeBrowser:
    def __init__(self):
        self.logins = self.saves = 0
        self.locked = self.ambiguous_login = self.fail_after_save = self.reject_save = False
        self.firmware, self.serial = "1.0", "LAB-001"
        self.config = {"#acs": "https://old.invalid/cwmp", "#acs-user": "old", "#acs-pass": "old", "#interval": "60", "#enabled": False, "#periodic": False}
    def new_context(self, **kwargs):
        assert kwargs["service_workers"] == "block"
        assert kwargs["accept_downloads"] is False
        return FakeContext(self)

def fixture():
    model = {"id": "model-lab", "name": "LAB ROUTER", "firmware": "1.0", "group": "group-lab", "scheme": "http", "loginPath": "/", "acsPath": "/acs", "userSelector": "#user", "passwordSelector": "#password", "submitSelector": "#login", "successSelector": "#success", "failureSelector": "#failure", "lockoutSelector": "#locked", "identitySelector": "#model", "identityText": "LAB ROUTER", "firmwareSelector": "#firmware", "serialSelector": "#serial", "acsSelector": "#acs", "acsUsernameSelector": "#acs-user", "acsPasswordSelector": "#acs-pass", "enabledSelector": "#enabled", "periodicSelector": "#periodic", "intervalSelector": "#interval", "saveSelector": "#save"}
    device = {"id": "device-lab", "name": "CPE-TEST", "ip": "127.0.0.1", "port": 80, "model": model["id"], "profileHash": "test-hash", "validation": {"serial": "LAB-001", "modelHash": "test-hash", "endpoint": "http://127.0.0.1:80"}}
    group = {"id": "group-lab", "attempts": 2, "cooldown": 60, "entries": [{"id": "cred-1", "username": "operator", "password": "correct-test-password"}]}
    return {"version": 1, "id": "lab-job", "mode": "validate", "expires": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "resultKey": agent.encode(b"r" * 32), "models": [model], "devices": [device], "groups": [group], "acs": {"url": "https://new.invalid/cwmp", "username": "new", "password": "ACS-test-secret", "enabled": True, "interval": 300, "verifier": "manual"}}

class AgentTests(unittest.TestCase):
    def setUp(self):
        self.job = fixture()
        self.browser = FakeBrowser()
        self.control = InstantControl()
        self.engine = agent.Executor(self.browser, self.control, timeout=20, confirm_timeout=.01)
    def run_device(self): return self.engine.execute(self.job, self.job["devices"][0])
    def test_read_only_validation(self):
        r = self.run_device()
        self.assertEqual(r["status"], "validated")
        self.assertEqual(self.browser.saves, 0)
        self.assertEqual(r["serial"], "LAB-001")
    def test_credentials_order_and_delay(self):
        self.job["groups"][0]["entries"].insert(0, {"id": "bad", "username": "operator", "password": "wrong"})
        self.assertEqual(self.run_device()["credentialId"], "cred-1")
        self.assertEqual(self.browser.logins, 2)
        self.assertIn(60, self.control.waits)
    def test_max_attempts(self):
        self.job["groups"][0]["attempts"] = 1
        self.job["groups"][0]["entries"].insert(0, {"id": "bad", "username": "operator", "password": "wrong"})
        self.assertEqual(self.run_device()["status"], "login_failed")
        self.assertEqual(self.browser.logins, 1)
    def test_lockout_stops_without_login(self):
        self.browser.locked = True
        self.assertEqual(self.run_device()["status"], "locked")
        self.assertEqual(self.browser.logins, 0)
    def test_ambiguous_auth_does_not_retry(self):
        self.browser.ambiguous_login = True
        self.assertEqual(self.run_device()["status"], "unreachable")
        self.assertEqual(self.browser.logins, 1)
    def test_firmware_mismatch(self):
        self.browser.firmware = "2.0"
        self.assertEqual(self.run_device()["status"], "profile_mismatch")
        self.assertEqual(self.browser.saves, 0)
    def test_serial_change_blocks_save(self):
        self.job["mode"] = "provision"
        self.browser.serial = "OTHER-DEVICE"
        self.assertEqual(self.run_device()["status"], "profile_mismatch")
        self.assertEqual(self.browser.saves, 0)
    def test_save_and_readback_without_secret_report(self):
        self.job["mode"] = "provision"
        r = self.run_device()
        self.assertEqual(r["status"], "configured_waiting_acs")
        self.assertEqual(self.browser.config["#acs"], self.job["acs"]["url"])
        self.assertEqual(self.browser.saves, 1)
        self.assertNotIn("ACS-test-secret", json.dumps(r))
        self.assertNotIn("correct-test-password", json.dumps(r))
    def test_idempotence(self):
        self.job["mode"] = "provision"
        self.run_device()
        r = self.run_device()
        self.assertEqual(self.browser.saves, 1)
        self.assertEqual(r["status"], "configured_waiting_acs")
    def test_url_tokens_are_excluded_from_report(self):
        self.job["mode"] = "provision"
        self.job["acs"]["url"] = "https://acs.invalid/cwmp?token=query-secret#fragment-secret"
        self.browser.config["#acs"] = "https://operator:embedded-secret@old.invalid/cwmp"
        r = self.run_device()
        self.assertEqual(r["status"], "configured_waiting_acs")
        self.assertEqual(self.browser.config["#acs"], self.job["acs"]["url"])
        for secret in ("query-secret", "fragment-secret", "embedded-secret"):
            self.assertNotIn(secret, json.dumps(r))
    def test_after_save_uncertainty(self):
        self.job["mode"] = "provision"
        self.browser.fail_after_save = True
        self.assertEqual(self.run_device()["status"], "uncertain")
        self.assertEqual(self.browser.saves, 1)
    def test_readback_mismatch(self):
        self.job["mode"] = "provision"
        self.browser.reject_save = True
        self.assertEqual(self.run_device()["status"], "configuration_failed")
    def test_incomplete_profile(self):
        self.job["models"][0]["userSelector"] = "#ambiguous"
        self.assertEqual(self.run_device()["status"], "profile_mismatch")
        self.assertEqual(self.browser.logins, 0)
    def test_authenticated_report_tamper(self):
        r = self.run_device()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "result.json"
            packet = agent.sign_report(self.job, [r])
            agent.atomic_json(path, packet)
            self.assertEqual(agent.load_report(self.job, path)[0]["status"], "validated")
            packet["payload"] = agent.encode(b"tampered")
            agent.atomic_json(path, packet)
            with self.assertRaises(ValueError): agent.load_report(self.job, path)
    def test_expired_job(self):
        self.job["expires"] = "2020-01-01T00:00:00Z"
        self.assertEqual(self.run_device()["status"], "not_run")
        self.assertEqual(self.browser.logins, 0)
    def test_network_scope(self):
        self.run_device()
        class RequestRoute:
            request = type("Request", (), {"url": "https://outside.invalid/leak"})()
            def abort(self): self.aborted = True
            def continue_(self): self.aborted = False
        route = RequestRoute()
        self.browser.route(route)
        self.assertTrue(route.aborted)
    def test_resume_does_not_repeat_completed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "result.json"
            agent.run_job(self.job, self.browser, path, self.control)
            count = self.browser.logins
            agent.run_job(self.job, self.browser, path, self.control)
            self.assertEqual(self.browser.logins, count)
    def test_crash_marker_prevents_automatic_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "result.json"
            result = {"deviceId": "device-lab", "status": "uncertain", "message": "Processo interrompido", "attempts": 1}
            agent.atomic_json(path, agent.sign_report(self.job, [result]))
            agent.run_job(self.job, self.browser, path, self.control)
            self.assertEqual(self.browser.logins, 0)

if __name__ == "__main__":
    unittest.main()
