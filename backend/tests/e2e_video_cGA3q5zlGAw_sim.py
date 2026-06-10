import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_cGA3q5zlGAw_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Part 432 (cGA3q5zlGAw)...")

    # 1. Base Extrude
    base_points = [[0,0], [50,0], [50,30], [0,30], [0,0]]
    
    features = [
        {
            "id": "base_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": base_points,
                "depth": 15.0,
                "operation": "ADD"
            }
        },
        # 2. Loft (Mocking a transition to a smaller circle)
        {
            "id": "top_loft",
            "type": "LOFT",
            "parameters": {
                "profile_ids": ["base_extrude", "sketch_top"],
                "operation": "ADD",
                "profiles": [
                    {"points": base_points, "z_offset": 15.0},
                    {"points": [[10,10], [40,10], [40,20], [10,20], [10,10]], "z_offset": 30.0}
                ]
            }
        },
        # 3. DOME (New Feature)
        {
            "id": "crown_dome",
            "type": "DOME",
            "parameters": {
                "height": 10.0,
                "faces_refs": [
                    {
                        "id": "face_top",
                        "coordinates": [25.0, 15.0, 30.0],
                        "normal": [0,0,1],
                        "signature": {"area": 300.0}
                    }
                ]
            }
        },
        # 4. SHELL
        {
            "id": "final_shell",
            "type": "SHELL",
            "parameters": {
                "thickness": 2.0,
                "faces_to_remove_refs": [
                    {
                        "id": "face_bottom",
                        "coordinates": [25.0, 15.0, 0.0],
                        "normal": [0,0,-1]
                    }
                ]
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Part 432 with DOME and SHELL.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_cGA3q5zlGAw_simulation()
