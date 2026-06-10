
import os
import sys
import math
import json

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def get_circle_points(cx, cz, r, num_points=32):
    pts = []
    for i in range(num_points + 1):
        angle = 2 * math.pi * i / num_points
        pts.append([cx + r * math.cos(angle), cz + r * math.sin(angle)])
    return pts

def get_hexagon_points(cx, cz, r, rotation_deg=0):
    pts = []
    rot_rad = math.radians(rotation_deg)
    for i in range(7):
        angle = math.radians(i * 60) + rot_rad
        pts.append([cx + r * math.cos(angle), cz + r * math.sin(angle)])
    return pts

def simulate_spanner_final():
    print("Starting Final Industrial Simulation for Spanner (Wrench) - Video sDqD0PRYhJI...")
    
    features = []
    
    # Dimensions
    head1_center = (-52.0, 0.0)
    head2_center = (52.0, 0.0)
    head1_dia = 32.0
    head2_dia = 26.0
    handle_width = 104.0
    handle_height = 10.0
    
    # 1. Head 1 (Large) - D32
    features.append({
        "id": "head1",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": get_circle_points(head1_center[0], head1_center[1], head1_dia/2.0),
            "depth": 6.0,
            "endCondition": "MID_PLANE",
            "operation": "ADD"
        }
    })

    # 2. Head 2 (Small) - D26
    features.append({
        "id": "head2",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": get_circle_points(head2_center[0], head2_center[1], head2_dia/2.0),
            "depth": 6.0,
            "endCondition": "MID_PLANE",
            "operation": "ADD"
        }
    })

    # 3. Handle - 104x10
    handle_pts = [
        [-52.0, -5.0],
        [52.0, -5.0],
        [52.0, 5.0],
        [-52.0, 5.0],
        [-52.0, -5.0]
    ]
    features.append({
        "id": "handle",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": handle_pts,
            "depth": 3.5,
            "endCondition": "MID_PLANE",
            "operation": "ADD"
        }
    })

    # 4. Open End Cut (Left Head) - 18mm, 18 deg tilt
    tilt = math.radians(18)
    def rotate_pt(x, z, angle):
        return [
            x * math.cos(angle) - z * math.sin(angle),
            x * math.sin(angle) + z * math.cos(angle)
        ]
    
    # Create an open-ended rectangle for the cut
    cut1_raw = [
        [0, -9.0],
        [-25.0, -9.0],
        [-25.0, 9.0],
        [0, 9.0],
        [0, -9.0]
    ]
    cut1_points = []
    for p in cut1_raw:
        rp = rotate_pt(p[0], p[1], tilt)
        cut1_points.append([rp[0] - 52.0, rp[1]])
        
    features.append({
        "id": "open_end_cut",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": cut1_points,
            "depth": 10.0,
            "endCondition": "THROUGH_ALL",
            "operation": "CUT"
        }
    })

    # 5. Ring End Cut (Right Head) - 12-point star (Union of two hexagons)
    # Nut size 13mm (across flats). Radius across corners = 13 / cos(30) / 2
    hex_r = (13.0 / 2.0) / math.cos(math.radians(30))
    
    features.append({
        "id": "ring_end_cut_hex1",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": get_hexagon_points(head2_center[0], head2_center[1], hex_r, 0),
            "depth": 10.0,
            "endCondition": "THROUGH_ALL",
            "operation": "CUT"
        }
    })
    
    features.append({
        "id": "ring_end_cut_hex2",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": get_hexagon_points(head2_center[0], head2_center[1], hex_r, 30),
            "depth": 10.0,
            "endCondition": "THROUGH_ALL",
            "operation": "CUT"
        }
    })

    # 6. Fillets - Transition between heads and handle
    # For simulation, we might skip fillets if vertex tracking is not robust, 
    # but let's try to verify the feature chain can handle it.
    
    print(f"Processing {len(features)} features for Spanner...")
    try:
        result = geometry_service.process_features_cached(features)
        if result and result.get('data'):
            print("Simulation SUCCESSFUL: Mesh generated.")
            with open("simulation_result_spanner.json", "w") as f:
                json.dump({"success": True, "feature_count": len(features)}, f)
        else:
            print("Simulation FAILED: No mesh data.")
    except Exception as e:
        print(f"Simulation ERRORED: {str(e)}")

if __name__ == "__main__":
    simulate_spanner_final()
