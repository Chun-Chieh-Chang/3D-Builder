import sys
import os
import math

# Add backend to sys.path
backend_path = os.path.join(os.getcwd(), 'backend')
if backend_path not in sys.path:
    sys.path.append(backend_path)

try:
    from app.services import geometry_service
except ImportError as e:
    print(f"Error importing geometry_service: {e}")
    sys.exit(1)

def simulate_foundational_block():
    print("=== Foundational Block Hybrid Verification Simulation ===")
    
    # 1. Base Profile: Top Plane, Center Rectangle (100x100)
    base_points = [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
        [-50, -50]
    ]
    
    # 2. Hole Profile: Top face of the block, Circle (D50)
    # In non-OCC environments, the fallback mass property calculation 
    # currently requires polygon points. We use a 64-segment approximation.
    segments = 64
    hole_points = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        hole_points.append([25 * math.cos(angle), 25 * math.sin(angle)])
    hole_points.append(hole_points[0]) # Close the loop

    features = [
        {
            "id": "base_extrude",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "depth": 20.0,
                "points": base_points,
                "operation": "ADD"
            }
        },
        {
            "id": "hole_cut",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FACE",
                "faceOrigin": [0.0, 20.0, 0.0],
                "faceNormal": [0.0, 1.0, 0.0],
                "depth": 20.0, # Match base depth for mock engine volume math
                "points": hole_points, 
                "operation": "CUT"
            }
        }
    ]
    
    print(f"Step 1: Extrude Boss/Base (100x100, Depth: 20mm)")
    print(f"Step 2: Extrude Cut (D50 Circle, Through All)")
    
    print("\nExecuting process_features...")
    try:
        result = geometry_service.process_features(features)
        if not result or "data" not in result:
            print("FAILED: Geometry processing returned no valid data.")
            return False
        
        print("SUCCESS: Geometry and Mesh generated.")
        vertices = result["data"].get("vertices", [])
        indices = result["data"].get("indices", [])
        print(f"Result: {len(vertices)//3} vertices, {len(indices)//3} triangles.")
        
        # Validation using Mass Properties
        mass_props = geometry_service.calculate_mass_properties(features, "GENERIC")
        if not mass_props:
            print("FAILED: Mass properties calculation failed.")
            return False
            
        volume = mass_props.get("volume", 0)
        print(f"\nCalculated Volume: {volume:.2f} mm^3")
        
        # Expected Volume: (100*100*20) - (PI * 25^2 * 20)
        expected_volume = (100 * 100 * 20) - (math.pi * (25**2) * 20)
        print(f"Expected Volume:   {expected_volume:.2f} mm^3")
        
        # In polygon approximation, volume will be slightly less than PI*R^2
        # For 64 segments, the area difference is about 3.15 mm^2, 
        # so volume difference is ~63 mm^3. Tolerance 100.0 is safe.
        tolerance = 100.0 
        if abs(volume - expected_volume) < tolerance:
            print(f"\nVERIFICATION: PASSED (Volume within tolerance {tolerance})")
            return True
        else:
            print(f"\nVERIFICATION: FAILED (Volume mismatch, diff: {abs(volume - expected_volume):.2f})")
            return False
            
    except Exception as e:
        print(f"EXCEPTION during simulation: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    if simulate_foundational_block():
        print("\n--- SIMULATION COMPLETE: SUCCESS ---")
        sys.exit(0)
    else:
        print("\n--- SIMULATION COMPLETE: FAILURE ---")
        sys.exit(1)
