import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_axLwYdBmJ0o_simulation():
    """
    Simulates the SolidWorks ergonomic workflow demonstrated in video axLwYdBmJ0o.
    This includes creating a sketch, applying constraints (mocked), and extruding.
    We specifically mock the 'FIX' constraint logic by setting fixed coordinates.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Ergonomic Workflow (axLwYdBmJ0o)...")

    # Scenario: A fully defined rectangle where one corner is FIXED at origin.
    # Fixed Node: (0,0)
    # Rectangle: (0,0) to (50, 30)
    
    profile_points = [
        [0.0, 0.0],
        [50.0, 0.0],
        [50.0, 30.0],
        [0.0, 30.0],
        [0.0, 0.0]
    ]

    features = [
        {
            "id": "ergonomic_base",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": profile_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for ergonomic base.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_axLwYdBmJ0o_simulation()
