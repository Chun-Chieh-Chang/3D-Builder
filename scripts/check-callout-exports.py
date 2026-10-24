"""Independent DXF/PDF consumers. Exits nonzero on semantic OR reader failures.

Requires ezdxf, PyMuPDF, Pillow and Poppler pdftotext. No product imports.
Usage: python scripts/check-callout-exports.py [out/callout-acceptance] [--failed-depth-only]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import ezdxf
import fitz
from ezdxf.lldxf.encoding import decode_dxf_unicode
from PIL import Image, ImageDraw

root = Path(sys.argv[1] if len(sys.argv) > 1 else "out/callout-acceptance").resolve()
manifest = json.loads((root / "manifest.json").read_text())
samples = manifest["samples"]
failed_only = "--failed-depth-only" in sys.argv[2:]
extensions = "--extensions" in sys.argv[2:]
case_ids = ["side-external", "side-internal", "side-tapped", "sheet-default"] if extensions else ["counterbore", "blind-countersink"] if failed_only else [
    "blind", "counterbore", "countersink", "blind-countersink", "tapped",
    "internal", "full-thread-blind-hole", "external"]
expected_ids = {f"{case}-{language}-{style}" for case in case_ids
                for language in ["en", "zh-TW"] for style in ["text", "symbols"]}
assert len(samples) == len(expected_ids) and {s["id"] for s in samples} == expected_ids


def portable(text):
    for symbol, word in [("↧", "DEPTH"), ("⌴", "CBORE"), ("⌵", "CSINK")]:
        text = text.replace(symbol, word)
    return text


tiles = []
rows = []
for sample in samples:
    row = {"id": sample["id"], "expected": sample["expected"],
           "actual": sample["actual"], "semanticPass": sample["expected"] == sample["actual"],
           "checks": {}, "sha256": {}}
    checks = row["checks"]
    dxf_path = root / (sample["id"] + ".dxf")
    drawing = ezdxf.readfile(dxf_path)
    checks["dxfAudit"] = not drawing.audit().has_errors
    dimensions = list(drawing.modelspace().query("DIMENSION"))
    side = extensions and sample["id"].startswith("side-")
    checks["dimensionCount"] = len(dimensions) == (0 if side else 1)
    if side:
        checks["dxfLeaderText"] = sum(decode_dxf_unicode(t.dxf.text) == portable(sample["actual"])
            for t in drawing.modelspace().query("TEXT")) == 1
        # Measure the spacing of overlapping projected outlines, independent of
        # the model metadata. Side leaders intentionally export no DIMENSION.
        segments = []
        for entity in drawing.modelspace().query("LWPOLYLINE"):
            if entity.dxf.layer not in ("VISIBLE", "HIDDEN"):
                continue
            points = list(entity.get_points("xy"))
            for a, b in zip(points, points[1:]):
                if abs(a[0] - b[0]) <= 1e-6 and abs(a[1] - b[1]) > 1e-6:
                    segments.append((0, a[0], min(a[1], b[1]), max(a[1], b[1])))
                elif abs(a[1] - b[1]) <= 1e-6 and abs(a[0] - b[0]) > 1e-6:
                    segments.append((1, a[1], min(a[0], b[0]), max(a[0], b[0])))
        checks["dxfProjectedDiameter"] = any(a[0] == b[0] and
            abs(abs(a[1] - b[1]) - sample["diameterMm"]) <= 1e-5 and
            min(a[3], b[3]) - max(a[2], b[2]) > 1e-6 for a in segments for b in segments)
    elif len(dimensions) == 1:
        dim = dimensions[0]
        checks["dxfOverride"] = decode_dxf_unicode(dim.dxf.text) == portable(sample["actual"])
        block = drawing.blocks.get(dim.dxf.geometry)
        checks["dxfRenderedBlockText"] = [decode_dxf_unicode(t.dxf.text)
            for t in block.query("TEXT")] == [portable(sample["actual"])]
        # DXF coordinates are serialized to six decimal places. This bound covers
        # the propagated endpoint rounding, and is not an application tolerance.
        checks["dxfDiameter"] = abs(dim.get_measurement() - sample["diameterMm"]) <= 1e-5
    pdfs = [("", sample["pdfExpected"])]
    if sample.get("fallbackPdfExpected"):
        pdfs.append(("-fallback", sample["fallbackPdfExpected"]))
    for suffix, expected in pdfs:
        path = root / (sample["id"] + suffix + ".pdf")
        with fitz.open(path) as pdf:
            page = pdf[0]
            blocks = page.get_text("blocks")
            matches = [b for b in blocks if b[4].strip() == expected]
            checks["pdfText" + suffix] = len(pdf) == 1 and len(matches) == 1
            checks["pdfA3" + suffix] = abs(page.rect.width - 420 * 72 / 25.4) < .01 and abs(page.rect.height - 297 * 72 / 25.4) < .01
            poppler = subprocess.run(["pdftotext", "-layout", str(path), "-"], check=True, capture_output=True, text=True).stdout
            checks["popplerText" + suffix] = expected in poppler
            if matches:
                rect = fitz.Rect(matches[0][:4])
                checks["pdfInPage" + suffix] = page.rect.contains(rect)
                checks["pdfNoTextOverlap" + suffix] = not any(
                    (rect & fitz.Rect(b[:4])).get_area() > 0 for b in blocks if b is not matches[0])
                pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=rect + (-3, -3, 3, 3), alpha=False)
                crop = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                checks["pdfHasRasterInk" + suffix] = crop.convert("L").getextrema()[0] < 100
                if sample["style"] == "symbols":
                    tiles.append((sample["id"] + suffix, crop))
        row["sha256"][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    row["sha256"][dxf_path.name] = hashlib.sha256(dxf_path.read_bytes()).hexdigest()
    row["readerPass"] = bool(checks) and all(checks.values())
    rows.append(row)

width, height = 1250, 110 * ((len(tiles) + 1) // 2)
sheet = Image.new("RGB", (width, height), "white")
pen = ImageDraw.Draw(sheet)
for i, (label, crop) in enumerate(tiles):
    x, y = (i % 2) * 625, (i // 2) * 110
    pen.text((x + 8, y + 3), label, fill="black")
    crop.thumbnail((605, 78))
    sheet.paste(crop, (x + 8, y + 25))
sheet.save(root / "pdf-contact-sheet.png")
freecad_path = root / "freecad.json"
freecad = json.loads(freecad_path.read_text()) if freecad_path.exists() else None
report = {"readers": {"ezdxf": ezdxf.__version__, "pymupdf": fitz.VersionBind,
           "poppler": subprocess.run(["pdftotext", "-v"], capture_output=True, text=True).stderr.splitlines()[0]},
          "scope": "new sheet defaults, side leaders and tolerance classes" if extensions else "previously failed blind-depth cases only" if failed_only else "full callout matrix",
          "summary": {"samples": len(rows), "semanticPass": sum(r["semanticPass"] for r in rows),
                      "readerPass": sum(r["readerPass"] for r in rows)},
          "freecad": freecad,
          "notImplemented": [] if extensions else ["historical report; see extension acceptance for new features"],
          "limits": ["No AutoCAD/SHX environment available", "PDF crops contain raster ink; visual inspection is still required", "mm; front and top side views" if extensions else "mm / front-view samples only"],
          "samples": rows}
report["fonts"] = {name: {"path": path, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}
                   for name, path in manifest["fonts"].items()}
if freecad:
    assert {r["id"] for r in freecad["samples"]} == {r["id"] for r in rows}
    assert all(r["sha256"] == hashlib.sha256((root / (r["id"] + ".dxf")).read_bytes()).hexdigest()
               for r in freecad["samples"]), "Stale FreeCAD report: rerun the import probe"
    report["summary"]["freecadGeometryPass"] = sum(r["geometryPass"] for r in freecad["samples"])
(root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = ["# Drawing callout external acceptance", "", "```json", json.dumps(report["summary"], indent=2), "```", "",
         "Reader compatibility is separate from manufacturing correctness. FreeCAD checks geometry only.", "",
         "| Sample | Model-derived expected label | Actual exported label |", "|---|---|---|"]
lines += [f'| {r["id"]} | {r["expected"]} | {r["actual"]} |' for r in rows if not r["semanticPass"]]
lines += ["", "Scope: " + report["scope"],
          "Not verified: AutoCAD/SHX, physical printing, inch units, all view orientations.",
          "See report.json for individual reader checks and SHA-256 hashes; pdf-contact-sheet.png for rendered labels."]
(root / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps(report["summary"]))
if any(not r["semanticPass"] or not r["readerPass"] for r in rows) or (freecad and any(not r["geometryPass"] for r in freecad["samples"])):
    sys.exit(1)
