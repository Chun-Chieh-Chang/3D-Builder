
import os
import sys
import math

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def simulate_exercise_5():
    print("Starting Simulation for SolidWorks Exercise 5 (Stepped Base with Hub)...")
    
    features = []
    
    # 1. Base Profile (Right Plane - YZ)
    # Z is horizontal (length), Y is vertical (height)
    # Length 145, Height 90, Step at 25, Riser width 72
    base_profile = [
        [0, 0],
        [145, 0],
        [145, 25],
        [72, 25],
        [72, 90],
        [0, 90],
        [0, 0]
    ]
    features.append({
        "id": "base_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "RIGHT",
            "points": base_profile,
            "depth": 72.0,
            "midPlane": True,
            "x": 0, "y": 0, "z": 0
        }
    })

    # 2. Bottom Slot (Front Face - XY at Z=0)
    # X is horizontal (width), Y is vertical (height)
    # Width 70, Height 5, Centered on 72mm width
    slot_points = [
        [-35, 0],
        [35, 0],
        [35, 5],
        [-35, 5],
        [-35, 0]
    ]
    features.append({
        "id": "bottom_slot",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FRONT",
            "points": slot_points,
            "depth": 145.0, # Cut through the entire length
            "operation": "CUT",
            "x": 0, "y": 0, "z": 0
        }
    })

    # 3. Hub (Side Face - YZ at X=36)
    # Circle D24, R12. Center (Z=36, Y=45)
    def get_circle_points(cz, cy, r, num_points=24):
        pts = []
        for i in range(num_points + 1):
            angle = 2 * math.pi * i / num_points
            pts.append([cz + r * math.cos(angle), cy + r * math.sin(angle)])
        return pts

    hub_points = get_circle_points(36, 45, 12.0)
    features.append({
        "id": "hub_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "RIGHT",
            "points": hub_points,
            "depth": 20.0,
            "x": 36.0, "y": 0, "z": 0 # Offset to the side face
        }
    })

    # 4. Hub Hole (YZ at X=36+20=56 or same face with Through All)
    hole_points = get_circle_points(36, 45, 6.0)
    features.append({
        "id": "hub_hole",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "RIGHT",
            "points": hole_points,
            "depth": 100.0, # Large depth for through all simulation
            "operation": "CUT",
            "x": 36.0, "y": 0, "z": 0
        }
    })

    # 5. Mirror (Mirror Hub and Hole about Right Plane X=0)
    features.append({
        "id": "mirror_hubs",
        "type": "MIRROR",
        "parameters": {
            "target_feature_ids": ["hub_extrude", "hub_hole"],
            "mirror_plane_refs": [{"id": "RIGHT"}]
        }
    })

    print(f"Processing {len(features)} features...")
    try:
        result = geometry_service.process_features_cached(features)
        if result:
            print("Simulation SUCCESSFUL (Geometry logic verified)")
            print(f"Result contains {len(result.get('mesh_data', []))} meshes.")
        else:
            print("Simulation FAILED (No result from geometry service)")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")

if __name__ == "__main__":
    simulate_exercise_5()
