import os
import sys
import json
import math

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services import geometry_service

def circle_points(radius, center=(0, 0), segments=32):
    pts = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        pts.append([
            center[0] + radius * math.cos(angle),
            center[1] + radius * math.sin(angle)
        ])
    return pts

def run_simulation():
    print("Starting SolidWorks Exercise 2 (L-Bracket) Simulation...")
    
    # SOP Data
    # 1. Base: Top Plane, Center Rectangle (100x63), Extrude (12).
    # 2. Wall: Top face of base, Corner Rectangle (63x12 at edge), Extrude (50).
    # 3. Boss: Back face of wall, Circle (D36), Extrude (25).
    # 4. Holes: Boss face (D18), Base face (2x D12), Extruded Cut (Through All).

    features = [
        {
            "id": "base_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "depth": 12.0,
                "points": [[-50, -31.5], [50, -31.5], [50, 31.5], [-50, 31.5]],
                "operation": "ADD"
            }
        },
        {
            "id": "wall_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "y": 12.0,
                "depth": 50.0,
                # Rectangle 12x63 at the left edge (X from -50 to -38)
                "points": [[-50, -31.5], [-38, -31.5], [-38, 31.5], [-50, 31.5]],
                "operation": "ADD"
            }
        },
        {
            "id": "boss_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "RIGHT",
                "x": -50.0,
                "depth": 25.0,
                "flip": True, # Extrude away from the part
                # D36 circle -> R18. Center on wall face.
                # Wall is from Y=12 to 62. Width is Z=-31.5 to 31.5.
                # Center: Y=37, Z=0.
                "points": circle_points(18, center=(37, 0)),
                "operation": "ADD"
            }
        },
        {
            "id": "boss_hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "RIGHT",
                "x": -50.0,
                "depth": 50.0, # Through All
                "flip": True,
                # D18 circle -> R9.
                "points": circle_points(9, center=(37, 0)),
                "operation": "CUT"
            }
        },
        {
            "id": "base_hole_1",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "y": 12.0,
                "depth": 20.0,
                "flip": True, # Down through base
                # D12 circle -> R6. 
                "points": circle_points(6, center=(25, 15)),
                "operation": "CUT"
            }
        },
        {
            "id": "base_hole_2",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "y": 12.0,
                "depth": 20.0,
                "flip": True,
                "points": circle_points(6, center=(25, -15)),
                "operation": "CUT"
            }
        }
    ]

    print(f"Processing {len(features)} features...")
    result = geometry_service.process_features(features)

    if result and "data" in result:
        vertices = result["data"].get("vertices", [])
        indices = result["data"].get("indices", [])
        print(f"Simulation Successful!")
        print(f"Generated Mesh: {len(vertices)//3} vertices, {len(indices)//3} triangles.")
        
        # Save results to a file for audit
        with open("tests/regression/e2e_video4_result.json", "w") as f:
            # Strip large mesh data for the report, just keep counts and metadata
            summary = {
                "success": True,
                "feature_count": len(features),
                "vertex_count": len(vertices)//3,
                "triangle_count": len(indices)//3,
                "has_occ": geometry_service.HAS_OCC
            }
            json.dump(summary, f, indent=2)
        return True
    else:
        print("Simulation Failed: No mesh data returned.")
        return False

if __name__ == "__main__":
    success = run_simulation()
    if not success:
        sys.exit(1)
