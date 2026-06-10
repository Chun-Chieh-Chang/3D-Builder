
import os
import sys
import json

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def test_dome_feature():
    print("Testing DOME feature implementation...")
    
    # 1. Create a base cube (20x20x20)
    features = [
        {
            "id": "base_cube",
            "type": "EXTRUDE",
            "parameters": {
                "plane": "TOP",
                "points": [[-10,-10], [10,-10], [10,10], [-10,10], [-10,-10]],
                "depth": 20.0,
                "operation": "ADD"
            }
        }
    ]
    
    # 2. Add a DOME to the top face
    # Top face normal is (0,1,0) in our coordinate system if plane is TOP? 
    # Actually, TOP plane extrusion goes along Y axis (0,1,0). 
    # The top face of the extruded block will be at Y=20.
    
    features.append({
        "id": "dome_top",
        "type": "DOME",
        "parameters": {
            "distance": 5.0,
            "refs": [
                {
                    "coordinates": [0, 20, 0],
                    "normal": [0, 1, 0],
                    "signature": {}
                }
            ],
            "reverse": False
        }
    })
    
    try:
        result = geometry_service.process_features_cached(features)
        if result and result.get('data'):
            print("DOME Simulation SUCCESSFUL: Mesh generated.")
            # Verify volume increase?
            return True
        else:
            print("DOME Simulation FAILED: No mesh data.")
            return False
    except Exception as e:
        print(f"DOME Simulation ERRORED: {str(e)}")
        return False

if __name__ == "__main__":
    test_dome_feature()
