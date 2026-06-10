import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_9B7CFz_jKpg_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Loft Advanced Boundary (9B7CFz-jKpg)...")

    # 1. Profiles
    p1 = [[0,0,0], [20,0,0], [20,20,0], [0,20,0], [0,0,0]]
    p2 = [[5,5,50], [15,5,50], [15,15,50], [5,15,50], [5,5,50]]

    features = [
        {
            "id": "loft_advanced",
            "type": "LOFT",
            "parameters": {
                "profiles": [p1, p2],
                "startConstraint": "NORMAL_TO_PROFILE",
                "startMagnitude": 2.0,
                "endConstraint": "DIRECTION_VECTOR",
                "endMagnitude": 1.5,
                "endDirectionVector": [1.0, 0.0, 0.0] # Exit sideways
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Loft with Advanced Boundary Constraints.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_9B7CFz_jKpg_simulation()
