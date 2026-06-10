import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_cjB3FWxvKY_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Constraints (cj-B3FWxvKY)...")

    # Creating a simple profile to demonstrate that the collinear math 
    # would result in a correct rectangular / stepped profile if used.
    # We use explicit coordinates here to mimic what the constraint solver
    # would output to the backend.
    
    # Base rectangle
    profile_points = [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 50.0],
        [80.0, 50.0],
        [80.0, 25.0],
        [20.0, 25.0],
        [20.0, 50.0],
        [0.0, 50.0],
        [0.0, 0.0]
    ]

    features = [
        {
            "id": "constraint_base",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": profile_points,
                "depth": 20.0,
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Constraints Demo.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_cjB3FWxvKY_simulation()
