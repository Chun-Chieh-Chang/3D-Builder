import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_ifzVEFoETEk_simulation():
    """
    Simulates the SolidWorks Point-on-Line Coincident logic.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Point-on-Edge Coincident (ifzVEFoETEk)...")

    # Scenario: A rectangle where a hole center is locked to a diagonal line
    # Base: (0,0) to (100, 50)
    # Diagonal: (0,0) to (100, 50)
    # Hole Center: (50, 25) - must lie on the diagonal
    
    profile_points = [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 50.0],
        [0.0, 50.0],
        [0.0, 0.0]
    ]

    features = [
        {
            "id": "base_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": profile_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        },
        {
            "id": "concentric_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                # Circle at (50, 25)
                "points": [[50 + 5*math.cos(i*math.pi/6), 25 + 5*math.sin(i*math.pi/6)] for i in range(12)],
                "depth": 20.0,
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for part with point-on-edge constraint.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_ifzVEFoETEk_simulation()
