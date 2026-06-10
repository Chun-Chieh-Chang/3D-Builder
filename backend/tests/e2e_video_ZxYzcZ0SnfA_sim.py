import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_ZxYzcZ0SnfA_simulation():
    """
    Simulates the SolidWorks Center Rectangle workflow.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Center Rectangle (ZxYzcZ0SnfA)...")

    # Center at (0,0), Corner at (25, 15)
    # This results in a 50x30 rectangle.
    
    profile_points = [
        [25.0, 15.0],
        [-25.0, 15.0],
        [-25.0, -15.0],
        [25.0, -15.0],
        [25.0, 15.0]
    ]

    features = [
        {
            "id": "center_rect_extrude",
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
        print("[SUCCESS] Mesh generated for Center Rectangle.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_ZxYzcZ0SnfA_simulation()
