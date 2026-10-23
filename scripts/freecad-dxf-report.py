"""Read one DXF file through FreeCAD and write geometric facts as JSON.

Usage: set FREECAD_DXF_INPUT and FREECAD_DXF_REPORT, then run the script through
FreeCADCmd.exe. The caller owns the output path. This script rejects relative output
paths so reports cannot silently land in a different working directory.
"""
import json
import os
import sys

import FreeCAD
import Part
import importDXF


def fail(message):
    raise RuntimeError(message)


def main():
    source = os.environ.get("FREECAD_DXF_INPUT")
    output_path = os.environ.get("FREECAD_DXF_REPORT")
    if not source or not output_path:
        fail("FREECAD_DXF_INPUT and FREECAD_DXF_REPORT must both be set")

    source_path = os.path.abspath(source)
    if not os.path.isabs(output_path):
        fail("JSON output path must be absolute")
    if not os.path.isfile(source_path):
        fail("DXF input does not exist: " + source_path)

    document = FreeCAD.newDocument("dxf_acceptance_probe")
    try:
        importDXF.insert(source_path, document.Name)
        document.recompute()
        layers = [
            getattr(obj, "Label", obj.Name)
            for obj in document.Objects
            if "Layer" in obj.TypeId or "Layer" in obj.Name
        ]
        shapes = [
            obj.Shape
            for obj in document.Objects
            if hasattr(obj, "Shape") and not obj.Shape.isNull()
        ]
        if not shapes:
            fail("FreeCAD imported no shapes from DXF: " + source_path)

        compound = Part.makeCompound(shapes)
        box = compound.BoundBox
        report = {
            "reader": "FreeCAD " + FreeCAD.Version()[0],
            "source": source_path,
            "totalObjects": len(document.Objects),
            "shapes": len(shapes),
            "layers": sorted(list(set(layers))),
            "boundsMm": {
                "min": [round(box.XMin, 3), round(box.YMin, 3), round(box.ZMin, 3)],
                "max": [round(box.XMax, 3), round(box.YMax, 3), round(box.ZMax, 3)],
            },
        }
        with open(output_path, "w", encoding="utf-8", newline="\n") as output:
            json.dump(report, output, indent=2, sort_keys=True)
            output.write("\n")
    finally:
        FreeCAD.closeDocument(document.Name)


main()
