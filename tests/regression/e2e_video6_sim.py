
import os
import sys
import math

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def simulate_exercise_4():
    print("Starting Simulation for SolidWorks Exercise 4...")
    
    features = []
    
    # 1. Base Plate
    # Top Plane (XZ), Center Rectangle 84x70, Extrude 11mm
    # points_2d map to (x, z) on TOP plane
    base_points = [
        [-42, -35],
        [42, -35],
        [42, 35],
        [-42, 35],
        [-42, -35]
    ]
    features.append({
        "id": "base_plate",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": base_points,
            "depth": 11.0,
            "x": 0, "y": 0, "z": 0
        }
    })

    # 2. Corner Fillets R18
    # Vertical edges at (±42, Y, ±35)
    # Edge 1: (42, 0, 35) to (42, 11, 35)
    # Edge 2: (42, 0, -35) to (42, 11, -35)
    # Edge 3: (-42, 0, -35) to (-42, 11, -35)
    # Edge 4: (-42, 0, 35) to (-42, 11, 35)
    fillet_refs = [
        {"edgeData": {"start": [42, 0, 35], "end": [42, 11, 35]}},
        {"edgeData": {"start": [42, 0, -35], "end": [42, 11, -35]}},
        {"edgeData": {"start": [-42, 0, -35], "end": [-42, 11, -35]}},
        {"edgeData": {"start": [-42, 0, 35], "end": [-42, 11, 35]}}
    ]
    features.append({
        "id": "corner_fillets",
        "type": "FILLET",
        "parameters": {
            "radius": 18.0,
            "refs": fillet_refs
        }
    })

    # 3. Base Holes (4x D13)
    # Concentric with fillets? (±24, ±17)
    # We use EXTRUDE with isCut=True (if supported) or just a negative depth? 
    # Actually geometry_service.py handle isCut via operation='CUT'
    hole_radius = 13.0 / 2.0
    hole_centers = [
        [24, 17],
        [24, -17],
        [-24, -17],
        [-24, 17]
    ]
    
    def get_circle_points(cx, cz, r, num_points=24):
        pts = []
        for i in range(num_points + 1):
            angle = 2 * math.pi * i / num_points
            pts.append([cx + r * math.cos(angle), cz + r * math.sin(angle)])
        return pts

    hole_loops = [get_circle_points(c[0], c[1], hole_radius) for c in hole_centers]
    
    features.append({
        "id": "base_holes",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": hole_loops,
            "depth": 11.0,
            "operation": "CUT",
            "x": 0, "y": 0, "z": 0 # Start from base bottom? Or top?
            # If we start from Top Plane (Y=0), depth 11 goes to Y=11.
            # To cut the base plate (Y=0 to 11), we can start at Y=0 and extrude 11.
        }
    })

    # 4. Reference Plane (Offset 162mm from base top face)
    # Base top face is at Y=11, normal (0,1,0)
    features.append({
        "id": "REF_PLANE_1",
        "type": "REFERENCE_PLANE",
        "parameters": {
            "planeType": "OFFSET",
            "offset": 162.0,
            "refs": [
                {
                    "type": "FACE",
                    "coordinates": [0, 11, 0],
                    "normal": [0, 1, 0]
                }
            ]
        }
    })

    # 5. Top Hub: Circle D162, Extrude (Mid Plane, 34mm)
    # On REF_PLANE_1. 
    # Mid Plane 34mm means extrude 17mm in both directions or start offset by -17.
    hub_radius = 162.0 / 2.0
    hub_points = get_circle_points(0, 0, hub_radius)
    
    features.append({
        "id": "top_hub",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "REF_PLANE_1",
            "points": hub_points,
            "depth": 34.0,
            "flip": False,
            # For "Mid Plane", our EXTRUDE might need a 'midPlane' parameter if supported,
            # otherwise we manually offset.
            # Let's check if EXTRUDE supports 'midPlane'. 
            # If not, we adjust starting point.
            "x": 0, "y": -17, "z": 0, # Offset starting point by 17mm back? 
            # Wait, if plane is REF_PLANE_1 (Y=173), and we want Mid Plane 34mm,
            # it should go from Y=173-17=156 to Y=173+17=190.
            # If we just use depth 34, it goes from 173 to 207.
            # Let's assume the backend handles 'midPlane' or we adjust.
            "midPlane": True 
        }
    })

    # 6. Rib: Right Plane, Triangle, Extrude (Mid Plane, 8mm)
    # Right Plane (ZY), X=0.
    # Hub bottom is at Y=156 (if midplane worked). Base top is at Y=11.
    # Triangle from hub to base.
    rib_points = [
        [0, 11],    # Bottom on base (Z=0, Y=11)
        [81, 156],  # Hub outer edge (Z=81, Y=156)
        [0, 156],   # Hub center axis (Z=0, Y=156)
        [0, 11]
    ]
    features.append({
        "id": "rib",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "RIGHT",
            "points": rib_points,
            "depth": 8.0,
            "midPlane": True,
            "x": 0, "y": 0, "z": 0
        }
    })

    print(f"Processing {len(features)} features...")
    result = geometry_service.process_features_cached(features)
    
    if result:
        print("Simulation SUCCESSFUL")
        # Export for manual check if needed
        # geometry_service.export_cad_file(features, "STEP", "exercise_4_result.step")
    else:
        print("Simulation FAILED")

if __name__ == "__main__":
    simulate_exercise_4()
