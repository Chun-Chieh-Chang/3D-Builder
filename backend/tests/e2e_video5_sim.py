import os
import sys
import json

# Add backend to sys.path to allow importing app modules
backend_path = os.path.join(os.getcwd(), 'backend')
if backend_path not in sys.path:
    sys.path.append(backend_path)

try:
    from app.services import geometry_service
    HAS_IMPORT = True
except ImportError as e:
    print(f"ImportError: {e}")
    HAS_IMPORT = False

def simulate_exercise_3():
    if not HAS_IMPORT:
        return {"success": False, "error": "Could not import geometry_service"}

    print("Starting SolidWorks Exercise 3 Simulation...")

    features = [
        {
            "id": "base_u",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": [
                    [0, 30], [0, 0], [100, 0], [100, 30], 
                    [85, 30], [85, 15], [15, 15], [15, 30], [0, 30]
                ],
                "depth": 60.0,
                "x": 0.0, "y": 0.0, "z": -30.0, # Mid-plane simulation
                "operation": "ADD"
            }
        },
        {
            "id": "hub",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": [
                    [50, 0, "CIRCLE_CENTER"], [70, 0] # D40 Hub
                ],
                "depth": 50.0,
                "x": 0.0, "y": 15.0, "z": 0.0,
                "operation": "ADD"
            }
        },
        {
            "id": "hole",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": [
                    [50, 0, "CIRCLE_CENTER"], [60, 0] # D20 Hole
                ],
                "depth": 100.0,
                "x": 0.0, "y": 65.0, "z": 0.0,
                "operation": "CUT",
                "flip": True # Cut downwards
            }
        },
        {
            "id": "rib_left",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": [
                    [15, 15], [30, 15], [30, 45], [15, 15]
                ],
                "depth": 10.0,
                "x": 0.0, "y": 0.0, "z": -5.0, # Mid-plane simulation
                "operation": "ADD"
            }
        },
        {
            "id": "rib_right",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "FRONT",
                "points": [
                    [85, 15], [70, 15], [70, 45], [85, 15]
                ],
                "depth": 10.0,
                "x": 0.0, "y": 0.0, "z": -5.0, # Mid-plane simulation
                "operation": "ADD"
            }
        }
    ]

    print("Processing features...")
    try:
        result = geometry_service.process_features_cached(
            features,
            deflection=0.1,
            from_feature_index=0,
            feature_fingerprint="exercise_3_sim_v1"
        )
        
        if result and "data" in result:
            print("Simulation successful!")
            print(f"Vertices count: {len(result['data'].get('vertices', [])) // 3}")
            
            # Export to STEP for manual verification
            export_path = os.path.join(os.getcwd(), "exercise_3_result.step")
            success = geometry_service.export_cad_file(features, "STEP", export_path)
            if success:
                print(f"Exported to {export_path}")
            
            return {"success": True, "vertices_count": len(result['data'].get('vertices', [])) // 3}
        else:
            print("Simulation failed: No geometry data returned.")
            return {"success": False, "error": "No geometry data"}
            
    except Exception as e:
        print(f"Simulation failed with error: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    res = simulate_exercise_3()
    with open('simulation_result.json', 'w') as f:
        json.dump(res, f)
