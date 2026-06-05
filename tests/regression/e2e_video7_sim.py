
import os
import sys
import math

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def get_circle_points(cx, cz, r, num_points=24):
    pts = []
    for i in range(num_points + 1):
        angle = 2 * math.pi * i / num_points
        pts.append([cx + r * math.cos(angle), cz + r * math.sin(angle)])
    return pts

def simulate_spanner():
    print("Starting Simulation for Spanner (Wrench) - Video 7...")
    
    features = []
    
    # 1. Head 1: Circle D32 at (-52, 0)
    head1_points = get_circle_points(-52, 0, 16.0)
    features.append({
        "id": "head1",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": head1_points,
            "depth": 6.0,
            "x": 0, "y": -3.0, "z": 0, # Mid-plane simulation
            "operation": "ADD"
        }
    })

    # 2. Head 2: Circle D26 at (52, 0)
    head2_points = get_circle_points(52, 0, 13.0)
    features.append({
        "id": "head2",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": head2_points,
            "depth": 6.0,
            "x": 0, "y": -3.0, "z": 0, # Mid-plane simulation
            "operation": "ADD"
        }
    })

    # 3. Handle: Rectangle (104 x 10) connecting the centers
    # Corners: (-52, -5), (52, -5), (52, 5), (-52, 5)
    handle_points = [
        [-52, -5],
        [52, -5],
        [52, 5],
        [-52, 5],
        [-52, -5]
    ]
    features.append({
        "id": "handle",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": handle_points,
            "depth": 3.5,
            "x": 0, "y": -1.75, "z": 0, # Mid-plane simulation
            "operation": "ADD"
        }
    })

    # 4. Side 1 Cut: 18mm wide at 18-degree tilt
    # Simplified: rectangular cut at -52, 0
    # Tilt 18 degrees means rotating the points
    tilt = math.radians(18)
    def rotate_pt(x, z, angle):
        return [
            x * math.cos(angle) - z * math.sin(angle),
            x * math.sin(angle) + z * math.cos(angle)
        ]
    
    # Base rectangle for cut: 18mm wide, 30mm long (to ensure it clears the head)
    cut1_raw = [
        [0, -9],
        [30, -9],
        [30, 9],
        [0, 9],
        [0, -9]
    ]
    # Center of rotation is the head center (-52, 0)
    cut1_points = []
    for p in cut1_raw:
        rp = rotate_pt(p[0], p[1], tilt)
        cut1_points.append([rp[0] - 52, rp[1]])
        
    features.append({
        "id": "cut1",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": cut1_points,
            "depth": 10.0,
            "x": 0, "y": -5.0, "z": 0,
            "operation": "CUT"
        }
    })

    # 5. Side 2 Cut: 15mm wide
    # Straight cut at (52, 0)
    cut2_points = [
        [52, -7.5],
        [22, -7.5],
        [22, 7.5],
        [52, 7.5],
        [52, -7.5]
    ]
    features.append({
        "id": "cut2",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": cut2_points,
            "depth": 10.0,
            "x": 0, "y": -5.0, "z": 0,
            "operation": "CUT"
        }
    })

    print(f"Processing {len(features)} features...")
    try:
        result = geometry_service.process_features_cached(features)
        if result:
            print("Simulation SUCCESSFUL")
            # Save result metadata
            import json
            with open("simulation_result.json", "w") as f:
                json.dump({"success": True, "feature_count": len(features)}, f)
        else:
            print("Simulation FAILED")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")

if __name__ == "__main__":
    simulate_spanner()
