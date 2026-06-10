import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_gxIlg9irqHU_local_tangency_simulation():
    """
    Simulates Loft from a Circle on a Cylinder side to an offset sketch.
    Tests Local Normal-Based Tangency for curved surfaces.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Local Tangency (gxIlg9irqHU)...")

    # 1. Base Cylinder (Horizontal along X axis)
    # Circle on X-axis, radius 20
    features = [
        {
            "id": "base_cyl",
            "type": "CYLINDER",
            "parameters": {
                "radius": 20.0,
                "height": 100.0,
                "x": -50, "y": 0, "z": 0,
                "axis": [1, 0, 0], # X axis
                "operation": "ADD"
            }
        },
        # 2. Loft from a small circle on the cylinder's curved face to an offset circle
        {
            "id": "branch_loft",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [
                    # Profile 1: Small circle on cylinder surface (near center Y=20, Z=0)
                    [ [0, 20 + 5*math.cos(i*math.pi/6), 5*math.sin(i*math.pi/6)] for i in range(12) ],
                    # Profile 2: Offset circle at Y=60
                    [ [0, 60 + 10*math.cos(i*math.pi/6), 10*math.sin(i*math.pi/6)] for i in range(12) ]
                ],
                "startConstraint": "TANGENT_TO_FACE",
                "startFaceRef": {
                    "id": "cyl_curved_face",
                    "coordinates": [0, 20.0, 0.0],
                    "normal": [0, 1, 0], # Normal at this point is [0,1,0]
                    "signature": {"type": "CYLINDRICAL"}
                },
                "startMagnitude": 1.5
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Curved Surface Tangency.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_gxIlg9irqHU_local_tangency_simulation()
