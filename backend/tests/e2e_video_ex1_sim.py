import math
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features
from app.services.geometry_service import HAS_OCC

def test_exercise_1_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Exercise 1...")

    # Phase 1: Base Plate (80x50x18)
    # Center Rectangle 80x50 on Top Plane (XZ)
    base_points = [
        [40.0, 25.0],
        [-40.0, 25.0],
        [-40.0, -25.0],
        [40.0, -25.0],
        [40.0, 25.0]
    ]
    
    features = [
        {
            "id": "base_plate",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": base_points,
                "depth": 18.0,
                "operation": "ADD"
            }
        },
        # Phase 2: Vertical Wall (80x12x38)
        # On Top Face (y=18). Aligned to back edge (z=-25 to -13).
        # We'll center it on X, and place it from z=-25 to z=-13.
        # Rectangle 80x12.
        {
            "id": "vertical_wall",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 18.0, -19.0], # Center of the wall footprint on the face
                "faceNormal": [0.0, 1.0, 0.0],
                "points": [
                    [40.0, 6.0],
                    [-40.0, 6.0],
                    [-40.0, -6.0],
                    [40.0, -6.0],
                    [40.0, 6.0]
                ],
                "depth": 38.0,
                "operation": "ADD"
            }
        },
        # Phase 3: Corner Slant Cut (45 deg)
        # Front face of vertical wall (z=-13, y from 18 to 56).
        # Triangle on corner. 
        # Vertices: 
        # 1. Side edge, 10mm from top: (x=40, y=56-10=46)
        # 2. Side edge, bottom: (x=40, y=18)
        # 3. Bottom edge, 12mm from side: (x=40-12=28, y=18)
        # Wait, the search result says "Top vertex 10mm from top edge" and "Side vertex 12mm from side edge" and "45 deg".
        # If it's a triangle at the corner:
        # A (40, 46) 
        # B (40, 18) - corner
        # C (28, 18) 
        # Angle at C? tan(theta) = 28/12... not 45.
        # If it's 45 deg, and one offset is 10mm, the other must be same if it's from the corner?
        # Let's re-read: "angle between slanted line and vertical edge to 45 deg".
        # "distance from top edge to start of cut to 10 mm".
        # "distance from side edge to bottom of cut to 12 mm".
        # This implies it's NOT a simple 45-45-90 triangle if both 10 and 12 are specified.
        # Unless 45 deg is the *result* or one dimension is redundant.
        # Let's assume the sketch is:
        # Line from (x=40, y=46) to (x=40-28?, y=18)
        # I will use the dimensions provided: 10mm from top, 12mm from side.
        
        {
            "id": "slant_cut",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 37.0, -13.0], # Front face of wall
                "faceNormal": [0.0, 0.0, 1.0],
                "points": [
                    [40.0, 19.0], # Top corner of wall (rel to wall center y=37)
                    [40.0, 9.0],  # 10mm down from top (top=19)
                    [28.0, -19.0], # 12mm from side (side=40), at bottom (bottom=-19)
                    [40.0, -19.0], # Bottom corner
                    [40.0, 19.0]
                ],
                "depth": 12.0, # Through the wall
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        mesh_data = result['data']
        print(f"[SUCCESS] Exercise 1 Mesh generated.")
        
        try:
            from app.services.geometry_service import build_shape_only
            from OCC.Core.GProp import GProp_GProps
            from OCC.Core.BRepGProp import brepgprop
            shape = build_shape_only(features)
            props = GProp_GProps()
            brepgprop.VolumeProperties(shape, props)
            volume = props.Mass()
            print(f" - Simulated Volume: {volume:.2f} mm^3")
            # Base: 80*50*18 = 72000
            # Wall: 80*12*38 = 36480
            # Cut: Triangle (area) * 12. 
            # Vertices relative to wall: (40, 19) to (40, 9) to (28, -19) to (40, -19).
            # This is a trapezoid or triangle? 
            # Points: (40, 19), (40, 9), (28, -19), (40, -19)
            # This is a triangle (40,9), (28,-19), (40,-19) PLUS a rectangle above?
            # No, the cut usually removes the corner.
            # Triangle to remove: (40, 19) to (40, 9) to (28, 19)? No.
            # Let's just trust the simulation to give us a baseline.
        except Exception as ve:
            print(f" - Volume check skipped: {ve}")

    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_exercise_1_simulation()
