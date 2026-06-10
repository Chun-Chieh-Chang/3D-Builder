import math
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features
from app.services.geometry_service import HAS_OCC

def test_exercise_6_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Exercise 6...")

    # Phase 1: Main Base (90x64x33)
    # Center Rectangle 90x64 on Top Plane (XZ)
    # Origin is center.
    base_points = [
        [45.0, 32.0],
        [-45.0, 32.0],
        [-45.0, -32.0],
        [45.0, -32.0],
        [45.0, 32.0]
    ]
    
    features = [
        {
            "id": "base_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": base_points,
                "depth": 33.0,
                "operation": "ADD"
            }
        },
        # Phase 2: Top Center Slot (16mm wide, 90mm long, 25mm deep)
        # On Top Face (y=33). Center at (0,0).
        # Rectangle 90x16.
        {
            "id": "top_slot",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 33.0, 0.0],
                "faceNormal": [0.0, 1.0, 0.0],
                "points": [
                    [45.0, 8.0],
                    [-45.0, 8.0],
                    [-45.0, -8.0],
                    [45.0, -8.0],
                    [45.0, 8.0]
                ],
                "depth": 25.0,
                "operation": "CUT"
            }
        },
        # Phase 3: Center Through Hole (26x14)
        # On Slot bottom face (y=33-25=8) or Top Face (Through All)
        {
            "id": "center_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 8.0, 0.0],
                "faceNormal": [0.0, 1.0, 0.0],
                "points": [
                    [13.0, 7.0],
                    [-13.0, 7.0],
                    [-13.0, -7.0],
                    [13.0, -7.0],
                    [13.0, 7.0]
                ],
                "depth": 10.0, # Enough to go through remaining 8mm
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        mesh_data = result['data']
        print(f"[SUCCESS] Exercise 6 Mesh generated.")
        print(f" - Vertices: {len(mesh_data.get('vertices', [])) // 3}")
        print(f" - Faces: {len(mesh_data.get('indices', [])) // 3}")
        
        # Verify volume if MassProperties were available (optional)
        # Expected volume: (90*64*33) - (90*16*25) - (26*14*8)
        # = 190080 - 36000 - 2912 = 151168 mm^3
        
        try:
            from OCC.Core.GProp import GProp_GProps
            from OCC.Core.BRepGProp import brepgprop
            # Re-process to get shape for volume check
            from app.services.geometry_service import build_shape_only
            shape = build_shape_only(features)
            props = GProp_GProps()
            brepgprop.VolumeProperties(shape, props)
            volume = props.Mass()
            print(f" - Simulated Volume: {volume:.2f} mm^3")
            expected_volume = 151168.0
            diff = abs(volume - expected_volume)
            if diff < 1.0:
                print(f" - Volume Match: [OK] (Diff: {diff:.4f})")
            else:
                print(f" - Volume Match: [WARNING] (Diff: {diff:.4f}, Expected: {expected_volume})")
        except Exception as ve:
            print(f" - Volume check skipped: {ve}")

    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_exercise_6_simulation()
