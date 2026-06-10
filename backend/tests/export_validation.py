#!/usr/bin/env python3
"""Golden STEP export: write STEP from fixture and verify round-trip volume."""
import json
import os
import sys
import tempfile

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))
from app.services import geometry_service

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "../fixtures")


def run_export_validation():
    print("=== 3D-Builder STEP Export Golden Validation ===")

    if not geometry_service.HAS_OCC:
        print("[SKIP] OpenCASCADE not available; STEP export validation deferred.")
        return

    fixture_path = os.path.join(FIXTURES_DIR, "box_10x10x10.3dbpart")
    with open(fixture_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    features = data.get("features", [])
    props_before = geometry_service.calculate_mass_properties(features)
    if props_before is None:
        print("[FAIL] Could not compute mass properties before export.")
        sys.exit(1)

    fd, step_path = tempfile.mkstemp(suffix=".step")
    os.close(fd)
    try:
        ok = geometry_service.export_cad_file(features, "STEP", step_path)
        if not ok or not os.path.isfile(step_path) or os.path.getsize(step_path) < 64:
            print("[FAIL] STEP export failed or produced an empty file.")
            sys.exit(1)

        print(f"  STEP written: {step_path} ({os.path.getsize(step_path)} bytes)")

        imported = geometry_service.import_step_file(step_path)
        if imported is None or imported.IsNull():
            print("[FAIL] STEP file could not be re-imported.")
            sys.exit(1)

        from OCC.Core.GProp import GProp_GProps
        from OCC.Core.BRepGProp import brepgprop

        gp = GProp_GProps()
        brepgprop.VolumeProperties(imported, gp)
        vol_imported = gp.Mass()

        vol_before = props_before.get("volume", 0.0)
        if abs(vol_imported - vol_before) > 1.0:
            print(f"[FAIL] STEP round-trip volume mismatch: {vol_before} vs {vol_imported}")
            sys.exit(1)

        print(f"  [PASS] STEP export/import volume match: {vol_imported:.2f} mm3")
    finally:
        if os.path.exists(step_path):
            os.remove(step_path)


if __name__ == "__main__":
    run_export_validation()
