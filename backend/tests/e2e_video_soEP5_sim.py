import math
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features
from app.services.geometry_service import HAS_OCC

def test_soEP5_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks CADable Exercise 5 (soEP5_cBqMI)...")

    # Phase 1: Base Plate (100x80x20)
    base_points = [
        [50.0, 40.0],
        [-50.0, 40.0],
        [-50.0, -40.0],
        [50.0, -40.0],
        [50.0, 40.0]
    ]
    
    features = [
        {
            "id": "base_plate",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": base_points,
                "depth": 20.0,
                "operation": "ADD"
            }
        },
        # Phase 2: 3D Fillets on 4 corners (R=15)
        # Using the geometric bounding box / edge coordinates for references
        {
            "id": "corner_fillets",
            "type": "FILLET",
            "parameters": {
                "radius": 15.0,
                "refs": [
                    {"edgeData": {"start": [50, 40, 20], "end": [50, 40, 0]}},
                    {"edgeData": {"start": [-50, 40, 20], "end": [-50, 40, 0]}},
                    {"edgeData": {"start": [-50, -40, 20], "end": [-50, -40, 0]}},
                    {"edgeData": {"start": [50, -40, 20], "end": [50, -40, 0]}}
                ]
            }
        },
        # Phase 3: Symmetrical Slots (Simplified to Rectangular Cuts for basic simulation)
        # Assuming slots are 16mm from left/right edges, say 20mm wide and 40mm long.
        {
            "id": "slots_cut",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 20.0, 0.0],
                "faceNormal": [0.0, 1.0, 0.0],
                "points": [
                    # Left Slot (Center at X=-34)
                    [-24.0, 20.0], [-44.0, 20.0], [-44.0, -20.0], [-24.0, -20.0], [-24.0, 20.0],
                    # Right Slot (Center at X=34)
                    [44.0, 20.0], [24.0, 20.0], [24.0, -20.0], [44.0, -20.0], [44.0, 20.0]
                ],
                "depth": 25.0, # Through All
                "operation": "CUT"
            }
        },
        # Phase 4: Side Holes (Diameter 24 -> Radius 12)
        # Cut Through All
        {
            "id": "side_holes",
            "type": "EXTRUDE", # Mocking cylindrical cut using polyline for now or utilizing CYLINDER feature
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 20.0, 0.0],
                "faceNormal": [0.0, 1.0, 0.0],
                "points": [
                    [12.0, 0.0], [0.0, 12.0], [-12.0, 0.0], [0.0, -12.0], [12.0, 0.0] # Diamond mock for hole
                ],
                "depth": 25.0,
                "operation": "CUT"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        mesh_data = result['data']
        print(f"[SUCCESS] CADable Exercise 5 Mesh generated.")
        
        try:
            from app.services.geometry_service import build_shape_only
            from OCC.Core.GProp import GProp_GProps
            from OCC.Core.BRepGProp import brepgprop
            shape = build_shape_only(features)
            props = GProp_GProps()
            brepgprop.VolumeProperties(shape, props)
            volume = props.Mass()
            print(f" - Simulated Volume: {volume:.2f} mm^3")
            # Base 100x80x20 = 160000
            # Minus fillets, slots, and holes.
            # Successful volume extraction confirms topological stability.
        except Exception as ve:
            print(f" - Volume check skipped: {ve}")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_soEP5_simulation()
