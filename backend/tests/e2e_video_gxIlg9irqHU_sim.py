import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_gxIlg9irqHU_simulation():
    """
    Simulates Advanced Loft from a Cylinder face to an Apex point.
    Tests Point Lofting and Tangent to Face local normal logic.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Advanced Loft (gxIlg9irqHU)...")

    # 1. Base Cylinder
    features = [
        {
            "id": "base_cyl",
            "type": "CYLINDER",
            "parameters": {
                "radius": 20.0,
                "height": 50.0,
                "x": 0, "y": 0, "z": 0,
                "operation": "ADD"
            }
        },
        # 2. Loft from Top Face of Cylinder to a Point
        {
            "id": "apex_loft",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [
                    # Profile 1: Circle points on cylinder top (Z=50)
                    [ [20*math.cos(i*math.pi/6), 20*math.sin(i*math.pi/6), 50.0] for i in range(12) ],
                    # Profile 2: Single Point (Apex) at Z=100
                    [ [0.0, 0.0, 100.0] ]
                ],
                "startConstraint": "TANGENT_TO_FACE",
                "startFaceRef": {
                    "id": "cyl_top_face",
                    "coordinates": [0, 0, 50.0],
                    "normal": [0, 0, 1],
                    "signature": {"area": 1256.6} # Pi * 20^2
                },
                "startMagnitude": 1.5
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Point Loft with Tangency.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_gxIlg9irqHU_simulation()
