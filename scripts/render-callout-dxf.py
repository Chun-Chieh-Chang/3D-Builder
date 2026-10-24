"""Render acceptance DXFs with ezdxf + Inkscape, without rewriting source files.

ezdxf's TEXT frontend does not decode R2000 Unicode escapes itself. Its public
decode_dxf_unicode utility is applied to the in-memory reader representation.
This adapter is recorded in the report; it is not native AutoCAD/SHX evidence.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration
from ezdxf.lldxf.encoding import decode_dxf_unicode
from ezdxf.fonts import fonts
from PIL import Image, ImageDraw

root = Path(sys.argv[1]).resolve()
manifest = json.loads((root / "manifest.json").read_text())
font = Path(manifest["fonts"]["cjk"])
fonts.font_manager.scan_folder(font.parent)
assert "Noto Sans TC" in fonts.get_font_face(font.name).family
rows = []
tiles = []
env = dict(os.environ)
env.setdefault("XDG_CONFIG_HOME", "/tmp/callout-inkscape-config")
env.setdefault("XDG_CACHE_HOME", "/tmp/callout-inkscape-cache")
for sample in manifest["samples"]:
    if len(sys.argv) > 2 and sample["id"] not in sys.argv[2:]:
        continue
    path = root / (sample["id"] + ".dxf")
    doc = ezdxf.readfile(path)
    doc.styles.get("STANDARD").dxf.font = font.name
    # Decode TEXT in both modelspace and dimension blocks, with the external
    # library's standard codec. The exported file is kept byte-for-byte intact.
    for entity in doc.entitydb.values():
        if entity.dxftype() in ("TEXT", "DIMENSION") and entity.dxf.hasattr("text"):
            entity.dxf.text = decode_dxf_unicode(entity.dxf.text)
    backend = svg.SVGBackend()
    Frontend(RenderContext(doc), backend, config=Configuration(
        background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK
    )).draw_layout(doc.modelspace(), finalize=True)
    vector = path.with_suffix(".external.svg")
    raster = path.with_suffix(".external.png")
    vector.write_text(backend.get_string(layout.Page(420, 297)), encoding="utf-8")
    subprocess.run(["inkscape", str(vector), "--export-type=png",
                    "--export-filename=" + str(raster), "--export-width=1680"],
                   env=env, check=True, capture_output=True)
    with Image.open(raster) as image:
        assert image.size[0] == 1680 and image.convert("L").getextrema()[0] < 100
        # Include model, leader and annotation together, rather than only text.
        crop = image.crop((130, 300, 1600, 670)).convert("RGB")
    rows.append({"id": sample["id"], "svg": vector.name, "png": raster.name})
# Rebuild the contact sheet using existing successful renders as well. Explicit
# sample IDs above rerender only failures, preserving the other raster files.
for sample in manifest["samples"]:
    with Image.open(root / (sample["id"] + ".external.png")) as image:
        tiles.append((sample["id"], image.crop((130, 300, 1600, 670)).convert("RGB")))
sheet = Image.new("RGB", (1470, 405 * len(tiles)), "white")
pen = ImageDraw.Draw(sheet)
for i, (label, crop) in enumerate(tiles):
    pen.text((10, 405 * i + 5), label, fill="black")
    sheet.paste(crop, (0, 405 * i + 25))
sheet.save(root / "dxf-contact-sheet.png")
(root / "dxf-render.json").write_text(json.dumps({
    "reader": "ezdxf " + ezdxf.__version__,
    "renderer": subprocess.run(["inkscape", "--version"], capture_output=True, check=True, text=True).stdout.strip(),
    "adapter": "ezdxf.decode_dxf_unicode on in-memory TEXT/DIMENSION; registered Noto Sans TC by filename",
    "scope": "Only listed samples were rerendered; other contact-sheet images reused.",
    "limitation": "Not unmodified AutoCAD/SHX rendering; visual review required.",
    "samples": rows,
}, indent=2), encoding="utf-8")
print(f"Rendered {len(rows)} DXF files; inspect dxf-contact-sheet.png")
