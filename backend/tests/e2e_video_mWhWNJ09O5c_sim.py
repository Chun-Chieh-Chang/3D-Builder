import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_mWhWNJ09O5c_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Master Constraints (mWhWNJ09O5c)...")

    # Workflow: Symmetric profile with midpoint anchor
    # Rectangle centered at (0,0) via midpoint/symmetry
    # Profile points: (-25, -15) to (25, 15)
    
    profile_points = [
        [-25.0, -15.0],
        [25.0, -15.0],
        [25.0, 15.0],
        [-25.0, 15.0],
        [-25.0, -15.0]
    ]

    features = [
        {
            "id": "master_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": profile_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for master constraints sketch.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_mWhWNJ09O5c_simulation()
