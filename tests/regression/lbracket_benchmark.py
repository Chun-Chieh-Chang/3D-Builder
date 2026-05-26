import os
import json
import sys
import math

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def run_lbracket_benchmark():
    print("=== 3D-Builder Benchmark: L-Bracket Modeling & Validation ===")
    
    # Use relative path from this script location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    fixture_path = os.path.join(script_dir, '../fixtures/l_bracket_benchmark.3dbpart')
    
    with open(fixture_path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
    
    features = data['features']
    
    # Expected Volume based on parametric mock rules:
    # 1. Base Plate: 50 * 10 * 30 = 15000
    # 2. Upright: 10 * 30 * 30 = 9000
    # 3. Mounting Hole (CUT): PI * 3^2 * 20 = 565.4866
    # Total = 15000 + 9000 - 565.4866 = 23434.5134
    
    expected_vol = 15000 + 9000 - (3.14159265 * 3**2 * 20)
    
    print("Executing L-Bracket rebuild...")
    props = geometry_service.calculate_mass_properties(features)
    actual_vol = props['volume']
    
    print(f"Expected Volume: {expected_vol:.2f}")
    print(f"Actual Volume:   {actual_vol:.2f}")
    
    if abs(actual_vol - expected_vol) < 0.1:
        print(f"  [PASS] L-Bracket Benchmark successful. Volume: {actual_vol:.2f}")
    else:
        print(f"  [FAIL] Discrepancy! Diff: {abs(actual_vol - expected_vol)}")
        sys.exit(1)

if __name__ == '__main__':
    run_lbracket_benchmark()
