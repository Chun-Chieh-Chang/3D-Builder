#!/usr/bin/env python3
"""Run all geometry golden / regression checks (PRODUCTIZATION_PLAN §13)."""
import subprocess
import sys
from pathlib import Path

REGRESSION_DIR = Path(__file__).resolve().parent
SCRIPTS = [
    "geometry_check.py",
    "lbracket_benchmark.py",
    "roundtrip_check.py",
    "test_incremental_rebuild.py",
    "export_validation.py",
]


def main() -> int:
    print("=== 3D-Builder Golden Test Suite ===\n")
    failed = 0
    for name in SCRIPTS:
        script = REGRESSION_DIR / name
        if not script.exists():
            print(f"[SKIP] Missing script: {name}")
            continue
        print(f"--- Running {name} ---")
        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(REGRESSION_DIR),
        )
        if result.returncode != 0:
            failed += 1
        print()
    print("=" * 42)
    if failed:
        print(f"GOLDEN SUITE FAILED ({failed} script(s))")
        return 1
    print("GOLDEN SUITE: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
