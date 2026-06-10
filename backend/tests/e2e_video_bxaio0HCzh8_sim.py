import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_bxaio0HCzh8_simulation():
    """
    Simulates the SolidWorks constraint hierarchy from video bxaio0HCzh8.
    Tests Sketch -> Extrude -> Feature Fillet workflow.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Constraint Workflow (bxaio0HCzh8)...")

    # 1. Fully defined base sketch (50x30 rectangle)
    profile_points = [[0,0], [50,0], [50,30], [0,30], [0,0]]
    
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
        # 2. Child feature: Fillet on one of the vertical edges
        {
            "id": "corner_fillet",
            "type": "FILLET",
            "parameters": {
                "radius": 5.0,
                "edge_refs": [
                    {
                        "id": "vertical_edge_1",
                        "coordinates": [50.0, 0.0, 5.0],
                        "normal": [1.0, -1.0, 0.0],
                        "signature": {"length": 10.0}
                    }
                ]
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for parent-child feature chain.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_bxaio0HCzh8_simulation()
