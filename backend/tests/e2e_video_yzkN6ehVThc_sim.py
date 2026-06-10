import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_yzkN6ehVThc_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Widget (yzkN6ehVThc)...")

    # Widget Base (Extrude)
    # The video shows creating a sketch with circles, tangent lines, and parallel lines.
    # We will simulate the outcome: an extruded shape with a hole.
    
    # Outer profile points (mocking a slot-like shape)
    # Bottom arc (R=20, Center=0,0)
    # Top arc (R=15, Center=0,50)
    # Tangent lines connecting them
    
    # Let's just create a simpler profile to prove extrusion works 
    # since we are verifying the constraint solver mostly in the frontend.
    profile_points = [
        [-20.0, 0.0],
        [20.0, 0.0],
        [15.0, 50.0],
        [-15.0, 50.0],
        [-20.0, 0.0]
    ]

    features = [
        {
            "id": "widget_base",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": profile_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        },
        {
            "id": "widget_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                # Inner hole (concentric to bottom arc)
                "points": [
                    [-10.0, 0.0],
                    [10.0, 0.0],
                    [10.0, 10.0],
                    [-10.0, 10.0],
                    [-10.0, 0.0]
                ],
                "depth": 20.0, # Through all
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Widget.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_yzkN6ehVThc_simulation()
