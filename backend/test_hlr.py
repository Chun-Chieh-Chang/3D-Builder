import requests
import json

payload = {
    "features": [
        {
            "id": "box1",
            "type": "BOX",
            "parameters": {"width": 50, "height": 30, "depth": 20}
        },
        {
            "id": "hole1",
            "type": "HOLE_WIZARD",
            "parameters": {
                "size": "M10",
                "x": 25, "y": 15, "z": 20,
                "nx": 0, "ny": 0, "nz": -1,
                "depth": 20
            }
        }
    ],
    "plane": "TOP"
}

from app.services.geometry_service import project_2d, HAS_OCC
if HAS_OCC:
    print("Testing backend function directly...")
    res = project_2d(payload["features"], plane_type="TOP")
    print(f"Got {len(res)} HLR lines. Sample:")
    if len(res) > 0:
        print(json.dumps(res[0], indent=2))
        print("Visible lines:", len([l for l in res if l['visible']]))
        print("Hidden lines:", len([l for l in res if not l['visible']]))
else:
    print("OCC NOT AVAILABLE!")
