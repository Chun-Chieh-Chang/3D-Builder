import os
import json
import sys
import math
import tempfile

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def run_roundtrip_test():
    print(\"=== 3D-Builder Persistence Roundtrip Validation ===\")
    
    # 1. Define a complex part (Box + Extrude)
    original_features = [
        {
            \"id\": \"f1\",
            \"type\": \"BOX\",
            \"name\": \"Base\",
            \"parameters\": {\"width\": 10, \"height\": 10, \"depth\": 10}
        },
        {
            \"id\": \"f2\",
            \"type\": \"EXTRUDE\",
            \"name\": \"Boss\",
            \"parameters\": {
                \"points\": [[[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]],
                \"depth\": 5,
                \"operation\": \"ADD\",
                \"plane\": \"FRONT\",
                \"x\": 0, \"y\": 0, \"z\": 10 
            }
        }
    ]
    
    # 2. Rebuild and get initial properties
    print(\"Rebuilding original model...\")
    props1 = geometry_service.calculate_mass_properties(original_features)
    vol1 = props1['volume']
    
    # 3. Simulate SAVE to .3dbpart
    save_data = {
        \"schema\": \"com.3dbuilder.part\",
        \"schemaVersion\": \"1.0.0\",
        \"features\": original_features,
        \"sketchNodes\": {}, \"sketchEdges\": {}, \"sketchConstraints\": {}
    }
    
    # Create temp file
    fd, tmp_path = tempfile.mkstemp(suffix='.3dbpart')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as tmp:
            json.dump(save_data, tmp)
            
        print(f\"Model saved to temporary file: {tmp_path}\")
        
        # 4. Simulate OPEN from .3dbpart
        with open(tmp_path, 'r', encoding='utf-8-sig') as f:
            loaded_data = json.load(f)
        
        loaded_features = loaded_data.get('features', [])
        
        # 5. Rebuild and compare properties
        print(\"Rebuilding loaded model...\")
        props2 = geometry_service.calculate_mass_properties(loaded_features)
        vol2 = props2['volume']
        
        diff = abs(vol1 - vol2)
        if diff < 1e-6:
            print(f\"  [PASS] Persistence Roundtrip successful. Volume consistent: {vol2:.2f}\")
        else:
            print(f\"  [FAIL] Volume discrepancy after roundtrip! Diff: {diff}\")
            sys.exit(1)
            
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
            
    print(\"=\"*50)
    print(\"VALIDATION SUCCESS\")
    print(\"=\"*50)

if __name__ == '__main__':
    run_roundtrip_test()
