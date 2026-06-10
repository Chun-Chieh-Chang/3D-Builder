import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_zCsIojVjmvM_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Loft with Draft Angle (zCsIojVjmvM)...")

    # 1. Base Sketch (Rectangle at Z=0)
    base_points = [[-20,-10,0], [20,-10,0], [20,10,0], [-20,10,0], [-20,-10,0]]
    
    # 2. Top Sketch (Rectangle at Z=50, smaller)
    top_points = [[-10,-5,50], [10,-5,50], [10,5,50], [-10,5,50], [-10,-5,50]]

    features = [
        {
            "id": "loft_with_draft",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [base_points, top_points],
                "startConstraint": "NORMAL_TO_PROFILE",
                "startMagnitude": 1.0,
                "startDraftAngle": 15.0, # Flare out at 15 degrees
                "endConstraint": "NORMAL_TO_PROFILE",
                "endMagnitude": 1.0,
                "endDraftAngle": -10.0   # Taper in at 10 degrees
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Loft with Draft Angles.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_zCsIojVjmvM_simulation()
