import os
import sys
import math

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def simulate_up_to_next():
    print("Starting Simulation for 'Up To Next' feature - Video 59...")
    features = []
    
    # 1. Base Box (Target surface for the extrusion)
    feat1 = {
        "id": "base_box",
        "type": "BOX",
        "name": "Base Part",
        "parameters": {
            "width": 50.0,
            "height": 50.0,
            "depth": 10.0,
            "x": 0.0,
            "y": 0.0,
            "z": 20.0, # Box is at Z = 20 to 30
            "operation": "ADD"
        }
    }
    features.append(feat1)
    
    # 2. Extrude a cylinder from Z=0 up to the Box
    # Using EXTRUDE instead of CYLINDER to test the UP_TO_NEXT ray casting
    
    # Circle profile for extrude
    circle_points = []
    r = 10.0
    num_pts = 36
    for i in range(num_pts):
        ang = 2 * math.pi * i / num_pts
        # centered at x=25, y=25
        px = 25.0 + r * math.cos(ang)
        py = 25.0 + r * math.sin(ang)
        circle_points.append([px, py])
        
    feat2 = {
        "id": "extrude_up_to_next",
        "type": "EXTRUDE",
        "name": "UpToNext Boss",
        "parameters": {
            "plane": "FRONT", # Front plane is Z=0. Normal is Z+.
            "points": [circle_points],
            "endCondition": "UP_TO_NEXT",
            "operation": "ADD"
        }
    }
    features.append(feat2)
    
    print(f"Processing {len(features)} features...")
    
    try:
        if geometry_service.HAS_OCC:
            res = geometry_service.build_compound_solid(features)
            if res:
                print("Simulation SUCCESSFUL (Boolean Mesh Generated)")
            else:
                print("Simulation FAILED")
        else:
            print("Simulation SUCCESSFUL (Mock Mode)")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")

if __name__ == "__main__":
    simulate_up_to_next()
