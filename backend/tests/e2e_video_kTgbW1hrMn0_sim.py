import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_kTgbW1hrMn0_simulation():
    """
    Simulates the SolidWorks Fully Defined Sketch logic from video kTgbW1hrMn0.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Master Constraints (kTgbW1hrMn0)...")

    # Scenario: A complex profile where auto-defining locks all nodes.
    # We use a stepped profile centered on origin.
    
    profile_points = [
        [0.0, 0.0],
        [40.0, 0.0],
        [40.0, 20.0],
        [20.0, 20.0],
        [20.0, 40.0],
        [0.0, 40.0],
        [0.0, 0.0]
    ]

    features = [
        {
            "id": "master_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": profile_points,
                "depth": 12.0,
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for fully defined master sketch.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_kTgbW1hrMn0_simulation()
