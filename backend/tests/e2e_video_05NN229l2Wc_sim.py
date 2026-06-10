import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_05NN229l2Wc_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Constraints (05NN229l2Wc)...")

    # Creating a simple profile to demonstrate that the concentric and equal math 
    # would result in a correct circular profile with a concentric hole if used.
    # We use explicit coordinates here to mimic what the constraint solver
    # would output to the backend.
    
    # Outer circle (R=50)
    outer_points = []
    for i in range(36):
        theta = (i/36.0) * 2 * math.pi
        outer_points.append([50.0 * math.cos(theta), 50.0 * math.sin(theta)])
        
    # Inner circle (R=25) -> Concentric
    inner_points = []
    for i in range(36):
        theta = (i/36.0) * 2 * math.pi
        inner_points.append([25.0 * math.cos(theta), 25.0 * math.sin(theta)])

    features = [
        {
            "id": "constraint_base",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": outer_points,
                "depth": 20.0,
                "operation": "ADD"
            }
        },
        {
            "id": "constraint_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": inner_points,
                "depth": 20.0, # Through all
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Constraints Demo.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_05NN229l2Wc_simulation()
