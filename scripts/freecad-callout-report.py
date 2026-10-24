"""Run inside a configured FreeCAD Python environment; see automated-acceptance.md.

This checks actual imported geometry, not rendering or dimension override text.
"""
import hashlib
import json
import sys
from pathlib import Path

import FreeCAD
import importDXF

root = Path(sys.argv[1]).resolve()
manifest = json.loads((root / "manifest.json").read_text())
rows = []
for sample in manifest["samples"]:
    doc = FreeCAD.newDocument("callout_probe")
    try:
        importDXF.insert(str(root / (sample["id"] + ".dxf")), doc.Name)
        doc.recompute()
        shapes = [obj.Shape for obj in doc.Objects
                  if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        distances = [obj.Distance.Value for obj in doc.Objects
                     if hasattr(obj, "Distance")]
        side = sample["id"].startswith("side-")
        valid = bool(shapes) and (len(distances) == 0 if side else len(distances) == 1 and abs(
            distances[0] - sample["diameterMm"]) <= 1e-5)
        rows.append({"id": sample["id"], "sha256": hashlib.sha256(
                         (root / (sample["id"] + ".dxf")).read_bytes()).hexdigest(), "shapes": len(shapes),
                     "diametersMm": distances, "geometryPass": valid})
    finally:
        FreeCAD.closeDocument(doc.Name)
report = {"version": FreeCAD.Version(), "mode": "headless legacy DXF importer",
          "limitation": "Dimension override text and glyph rendering are not verified by this importer.",
          "samples": rows}
(root / "freecad.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
if not all(row["geometryPass"] for row in rows):
    raise RuntimeError("FreeCAD geometry check failed; see freecad.json")
