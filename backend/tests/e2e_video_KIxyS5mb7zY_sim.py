import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_KIxyS5mb7zY_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Revolve Axis Logic (KIxyS5mb7zY)...")

    # Scenario: A rectangle profile and a separate centerline axis
    # Profile: (10, 0) to (20, 50)
    profile_points = [
        [10.0, 0.0],
        [20.0, 0.0],
        [20.0, 50.0],
        [10.0, 50.0],
        [10.0, 0.0]
    ]
    
    # Axis: Centerline at U=0 (Vertical)
    axis_uv = [[0.0, 0.0], [0.0, 100.0]]

    features = [
        {
            "id": "revolve_with_axis",
            "type": "REVOLVE",
            "parameters": {
                "plane": "FRONT",
                "points": profile_points,
                "axis_uv_points": axis_uv,
                "angle": 360.0,
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Revolve with UV Axis.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_KIxyS5mb7zY_simulation()
