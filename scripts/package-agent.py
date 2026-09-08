#!/usr/bin/env python3
"""Build a deterministic source-only download without local artifacts."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / "public" / "downloads" / "acs-pilot-agent.zip"
output.parent.mkdir(parents=True, exist_ok=True)
files = ["README.md", "acs_agent.py", "requirements.txt", "simulator.py", "selftest_browser.py", "test_agent.py"]
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo("acs-pilot-agent/" + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / "agent" / name).read_bytes())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(files)
print(f"Agente empacotado: {output.name} ({output.stat().st_size} bytes)")
