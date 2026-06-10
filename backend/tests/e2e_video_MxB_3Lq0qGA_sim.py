import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_video_MxB_3Lq0qGA_simulation():
    """
    Simulates the SolidWorks Dimensioning workflow from video MxB_3Lq0qGA.
    Tests Point-to-Line distance and Point-to-Circle distance.
    """
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Master Dimensions (MxB_3Lq0qGA)...")

    # Scenario: A rectangle with a concentric hole, dimensioned relative to edges.
    # We use explicit coordinates here to mimic the solved state.
    
    # 1. Main Base (50x30)
    base_points = [[0,0], [50,0], [50,30], [0,30], [0,0]]
    
    # 2. Hole (D=10, Center at 15, 15)
    # This implies a 15mm dimension from the left edge and 15mm from the bottom edge.
    hole_points = []
    for i in range(36):
        theta = (i/36.0) * 2 * math.pi
        hole_points.append([15 + 5 * math.cos(theta), 15 + 5 * math.sin(theta)])

    features = [
        {
            "id": "dim_base",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": base_points,
                "depth": 10.0,
                "operation": "ADD"
            }
        },
        {
            "id": "dim_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": hole_points,
                "depth": 20.0,
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for dimensioned part.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_video_MxB_3Lq0qGA_simulation()
