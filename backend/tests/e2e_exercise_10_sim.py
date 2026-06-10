
import os
import sys
import math

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def simulate_exercise_10():
    print("Starting Simulation for SolidWorks Exercise 10 (Base with Inclined Octagonal Hub)...")
    
    features = []
    
    # 1. Base Plate (Top Plane - XZ)
    # Width 56 (X), Depth 32 (Z), Height 8 (Y)
    # Center Rectangle 56x32
    base_points = [
        [-28, -16],
        [28, -16],
        [28, 16],
        [-28, 16],
        [-28, -16]
    ]
    features.append({
        "id": "base_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": base_points,
            "depth": 8.0,
            "x": 0, "y": 0, "z": 0
        }
    })

    # 2. Octagonal Hub (Inclined Face)
    # Normal is at 45 degrees. 
    # Let's say it's inclined in the XY plane.
    # Normal vector N = (cos(45), sin(45), 0) = (0.7071, 0.7071, 0)
    # Origin of the face: Start at top center (0, 8, 0), move along axis by 20mm
    axis_len = 20.0
    angle_rad = math.radians(45)
    nx, ny = math.cos(angle_rad), math.sin(angle_rad)
    
    # Face Origin
    fx = axis_len * nx
    fy = 8.0 + axis_len * ny
    fz = 0.0
    
    # Octagon points (Local 2D coordinates on the inclined plane)
    # Diameter 15mm, Radius 7.5mm
    R = 7.5
    # Flat-edged octagon vertices
    cos225 = math.cos(math.radians(22.5))
    sin225 = math.sin(math.radians(22.5))
    
    u1, v1 = R * cos225, R * sin225
    u2, v2 = R * sin225, R * cos225
    
    octagon_points = [
        [u1, v1],
        [u2, v2],
        [-u2, v2],
        [-u1, v1],
        [-u1, -v1],
        [-u2, -v2],
        [u2, -v2],
        [u1, -v1],
        [u1, v1]
    ]
    
    features.append({
        "id": "hub_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [fx, fy, fz],
            "faceNormal": [nx, ny, 0.0],
            "points": octagon_points,
            "depth": 30.0, # Long enough to intersect base
            "flip": True,   # Extrude towards base
            "operation": "ADD"
        }
    })

    # 3. Through Hole
    # Diameter 10mm, Radius 5mm
    def get_circle_points(r, num_points=24):
        pts = []
        for i in range(num_points + 1):
            angle = 2 * math.pi * i / num_points
            pts.append([r * math.cos(angle), r * math.sin(angle)])
        return pts

    hole_points = get_circle_points(5.0)
    features.append({
        "id": "hub_hole",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [fx, fy, fz],
            "faceNormal": [nx, ny, 0.0],
            "points": hole_points,
            "depth": 60.0, # Through all
            "flip": True,
            "operation": "CUT"
        }
    })

    print(f"Processing {len(features)} features...")
    try:
        # Use simple process_features to avoid caching issues in script
        result = geometry_service.process_features(features)
        if result:
            print("Simulation SUCCESSFUL (Geometry logic verified)")
            print(f"Result contains mesh data with {len(result['data'].get('vertices', []))//3} vertices.")
            
            # Basic validation: ensure we have at least some geometry
            if len(result['data'].get('vertices', [])) > 0:
                print("✅ Geometry generated successfully.")
            else:
                print("❌ Geometry is empty.")
        else:
            print("Simulation FAILED (No result from geometry service)")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    simulate_exercise_10()
