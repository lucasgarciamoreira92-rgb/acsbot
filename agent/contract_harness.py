"""Internal integration harness: encrypt/decrypt + executor contract + result signature."""
import json
import sys
from acs_agent import unpack, Executor, sign_report
from test_agent import FakeBrowser, InstantControl
packet = json.load(sys.stdin)
job = unpack(packet["envelope"], packet["unlockKey"])
browser = FakeBrowser()
engine = Executor(browser, InstantControl(), timeout=20, confirm_timeout=.01)
results = [engine.execute(job, d) for d in job["devices"]]
json.dump({"report": sign_report(job, results), "saves": browser.saves, "logins": browser.logins}, sys.stdout)
