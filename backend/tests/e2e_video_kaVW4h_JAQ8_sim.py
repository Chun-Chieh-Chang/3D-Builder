import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_kaVW4h_JAQ8_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Constraints (kaVW4h_JAQ8)...")

    # Creating a simple profile to demonstrate that the equal radius math 
    # would result in a correct circular profile with two equal holes.
    
    # Base rectangle
    profile_points = [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 50.0],
        [0.0, 50.0],
        [0.0, 0.0]
    ]

    features = [
        {
            "id": "base_plate",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": profile_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        },
        {
            "id": "hole_1",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": [[25+15*math.cos(i*math.pi/6), 25+15*math.sin(i*math.pi/6)] for i in range(12)],
                "depth": 20.0,
                "operation": "CUT"
            }
        },
        {
            "id": "hole_2",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": [[75+15*math.cos(i*math.pi/6), 25+15*math.sin(i*math.pi/6)] for i in range(12)],
                "depth": 20.0,
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for base plate with two equal holes.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_kaVW4h_JAQ8_simulation()
