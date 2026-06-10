import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_WvJHy0ph4i0_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Loft Constraints (WvJHy0ph4i0)...")

    # 1. Base Sketch (Rectangle on Plane 1)
    base_points = [[-20,-10], [20,-10], [20,10], [-20,10], [-20,-10]]
    
    # 2. Top Sketch (Circle on Plane 2, offset Z=50)
    top_points = []
    for i in range(12):
        theta = (i/12.0) * 2 * math.pi
        top_points.append([10 * math.cos(theta), 10 * math.sin(theta), 50.0])

    features = [
        {
            "id": "loft_with_constraints",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [
                    # Profile 1 at Z=0
                    [ [p[0], p[1], 0.0] for p in base_points ],
                    # Profile 2 at Z=50
                    top_points
                ],
                "startConstraint": "NORMAL_TO_PROFILE",
                "startMagnitude": 1.5,
                "endConstraint": "NORMAL_TO_PROFILE",
                "endMagnitude": 1.0
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Loft with Start/End constraints.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_WvJHy0ph4i0_simulation()
