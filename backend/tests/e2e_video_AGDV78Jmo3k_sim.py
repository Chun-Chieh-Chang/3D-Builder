import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_AGDV78Jmo3k_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Loft Advanced (AGDV78Jmo3k)...")

    # 1. Profiles
    p1 = [[-20,-10,0], [20,-10,0], [20,10,0], [-20,10,0], [-20,-10,0]]
    p2 = [[-10,-5,50], [10,-5,50], [10,5,50], [-10,5,50], [-10,-5,50]]

    features = [
        {
            "id": "loft_advanced",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [p1, p2],
                "startConstraint": "TANGENT_TO_FACE",
                "startFaceRef": {
                    "id": "base_face",
                    "normal": [0,0,-1] # Tangent to a base face pointing down
                },
                "startMagnitude": 1.2,
                "isThin": True,
                "thickness": 1.5
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Loft with Tangency and Thin feature.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_AGDV78Jmo3k_simulation()
