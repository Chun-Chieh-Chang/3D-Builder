import math
import sys
import os
import numpy as np

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_zCsIojVjmvM_advanced_simulation():
    """
    Simulates Advanced Loft Start/End Constraints from video zCsIojVjmvM.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating Advanced Loft Constraints (zCsIojVjmvM)...")

    # 1. Base Sketch (Rectangle at Z=0)
    base_points = [[-20,-10,0], [20,-10,0], [20,10,0], [-20,10,0], [-20,-10,0]]
    
    # 2. Top Sketch (Rectangle at Z=50, rotated)
    top_points = [[-10,-10,50], [10,-10,50], [10,10,50], [-10,10,50], [-10,-10,50]]

    features = [
        {
            "id": "loft_advanced",
            "type": "LOFT",
            "parameters": {
                "operation": "ADD",
                "profiles": [base_points, top_points],
                "startConstraint": "NORMAL_TO_PROFILE",
                "startMagnitude": 1.5,
                "endConstraint": "DIRECTION_VECTOR",
                "endMagnitude": 1.0,
                "endDirectionVector": [0.0, 1.0, 0.0] # Exit along Y axis
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Advanced Loft.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_zCsIojVjmvM_advanced_simulation()
