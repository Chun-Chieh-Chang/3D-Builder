"""Read one STEP file through FreeCAD and write geometric facts as JSON.

Usage: set FREECAD_STEP_INPUT and FREECAD_STEP_REPORT, then run the script through
FreeCADCmd.exe. The caller owns the output path. This script rejects relative output
paths so reports cannot silently land in a different working directory.
"""
import json
import os
import sys

import FreeCAD
import Import
import Part


def fail(message):
    raise RuntimeError(message)


def main():
    source = os.environ.get("FREECAD_STEP_INPUT")
    output_path = os.environ.get("FREECAD_STEP_REPORT")
    if not source or not output_path:
        fail("FREECAD_STEP_INPUT and FREECAD_STEP_REPORT must both be set")

    source_path = os.path.abspath(source)
    if not os.path.isabs(output_path):
        fail("JSON output path must be absolute")
    if not os.path.isfile(source_path):
        fail("STEP input does not exist: " + source_path)

    document = FreeCAD.newDocument("acceptance_probe")
    try:
        Import.insert(source_path, document.Name)
        document.recompute()
        shapes = [obj.Shape for obj in document.Objects if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        if not shapes:
            fail("FreeCAD imported no shapes")

        compound = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
        box = compound.BoundBox
        report = {
            "reader": "FreeCAD " + FreeCAD.Version()[0],
            "source": source_path,
            "objects": len(shapes),
            "solids": len(compound.Solids),
            "faces": len(compound.Faces),
            "edges": len(compound.Edges),
            "vertices": len(compound.Vertexes),
            "volumeMm3": compound.Volume,
            "areaMm2": compound.Area,
            "centerOfMassMm": [compound.CenterOfMass.x, compound.CenterOfMass.y, compound.CenterOfMass.z],
            "boundsMm": {"min": [box.XMin, box.YMin, box.ZMin], "max": [box.XMax, box.YMax, box.ZMax]},
        }
        with open(output_path, "w", encoding="utf-8", newline="\n") as output:
            json.dump(report, output, indent=2, sort_keys=True)
            output.write("\n")
    finally:
        FreeCAD.closeDocument(document.Name)


main()
