import os
import sys
import math

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def simulate_eye_bolt():
    print("Starting Simulation for Eye Bolt (Lifting Ring) - Video 58...")
    features = []
    
    # 1. Base Cylinder (Extrude)
    # Replaces the bolt shaft
    feat1 = {
        "id": "base_cylinder",
        "type": "CYLINDER",
        "name": "Bolt Shaft",
        "parameters": {
            "radius": 5.0,
            "height": 20.0,
            "x": 0.0,
            "y": 0.0,
            "z": 0.0,
            "operation": "ADD"
        }
    }
    features.append(feat1)
    
    # 2. Revolve the Ring
    # Typically, an eye bolt ring is a torus. We can simulate it by revolving a circle.
    # Center of circle is at (0, 15), radius is 3. Revolve around Y axis.
    # We provide the points for a circle.
    circle_points = []
    cx, cy, r = 15.0, 20.0, 3.0  # Actually, X=15, Y=20. Revolve around Y axis.
    num_pts = 36
    for i in range(num_pts):
        ang = 2 * math.pi * i / num_pts
        px = cx + r * math.cos(ang)
        py = cy + r * math.sin(ang)
        circle_points.append([px, py])
        
    feat2 = {
        "id": "ring_revolve",
        "type": "REVOLVE",
        "name": "Eye Ring",
        "parameters": {
            "plane": "FRONT",
            "points": circle_points,
            "angle": 360.0,
            "axis": "Y",  # Revolving around Y axis
            "operation": "ADD"
        }
    }
    features.append(feat2)
    
    print(f"Processing {len(features)} features...")
    
    try:
        if geometry_service.HAS_OCC:
            res = geometry_service.build_compound_solid(features)
            if res:
                print("Simulation SUCCESSFUL")
            else:
                print("Simulation FAILED")
        else:
            print("Simulation SUCCESSFUL (Mock)")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")

if __name__ == "__main__":
    simulate_eye_bolt()
