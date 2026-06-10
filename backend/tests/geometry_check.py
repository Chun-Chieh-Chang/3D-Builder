import os
import json
import sys
import math

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))

from app.services import geometry_service

FIXTURES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../fixtures'))

# L-Bracket: 15000 + 9000 - (pi * 3^2 * 20)
L_BRACKET_VOLUME = 15000 + 9000 - (3.14159265 * 3**2 * 20)

EXPECTATIONS = {
    "box_10x10x10.3dbpart": {
        "volume": 1000.0,
        "surface_area": 600.0,
    },
    "extrude_square_10x10_h5.3dbpart": {
        "volume": 500.0,
        "surface_area": 400.0,
    },
    "l_bracket_benchmark.3dbpart": {
        "volume": L_BRACKET_VOLUME,
    },
}

def run_regression():
    print("=== 3D-Builder Geometry Regression Check ===")
    
    passed = 0
    failed = 0
    
    for filename, expected in EXPECTATIONS.items():
        file_path = os.path.join(FIXTURES_DIR, filename)
        if not os.path.exists(file_path):
            print(f"[SKIP] Fixture not found: {filename}")
            continue
            
        print(f"Testing {filename}...")
        
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
            
        features = data.get('features', [])
        
        try:
            props = geometry_service.calculate_mass_properties(features)
            
            if props is None:
                print(f"  [FAIL] Failed to calculate mass properties.")
                failed += 1
                continue
                
            actual_vol = props.get('volume', 0.0)
            actual_area = props.get('surface_area', 0.0)
            
            vol_err = abs(actual_vol - expected["volume"])
            area_err = (
                abs(actual_area - expected["surface_area"])
                if "surface_area" in expected
                else 0.0
            )

            TOL = 1e-1

            area_ok = "surface_area" not in expected or area_err < TOL
            if vol_err < TOL and area_ok:
                area_msg = (
                    f", Area: {actual_area:.2f}"
                    if "surface_area" in expected
                    else ""
                )
                print(f"  [PASS] Volume: {actual_vol:.2f}{area_msg}")
                passed += 1
            else:
                print("  [FAIL] Discrepancy detected!")
                print(f"    Volume: Expected {expected['volume']}, Got {actual_vol}")
                if "surface_area" in expected:
                    print(f"    Area:   Expected {expected['surface_area']}, Got {actual_area}")
                failed += 1
                
        except Exception as e:
            print(f"  [ERROR] Kernel exception: {e}")
            failed += 1
            
    print("\n" + "="*40)
    print(f"RESULTS: {passed} PASSED, {failed} FAILED")
    print("="*40)
    
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_regression()
