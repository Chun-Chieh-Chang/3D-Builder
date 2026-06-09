import sys
import os
import math

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import build_feature_shape_in_isolation
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

def test_fill_pattern():
    print("--- Testing Fill Pattern (Square Layout) ---")
    
    # 1. Create a boundary sketch (50x50 Square)
    boundary_points = [
        [0, 0, 0],
        [50, 0, 0],
        [50, 50, 0],
        [0, 50, 0],
        [0, 0, 0]
    ]
    features = [
        {
            'id': 'sketch_boundary',
            'type': 'SKETCH',
            'parameters': {'points': boundary_points}
        },
        {
            'id': 'seed_feature',
            'type': 'EXTRUDE',
            'parameters': {
                'points': [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [0,0,0]],
                'depth': 5.0,
                'operation': 'ADD'
            }
        }
    ]
    
    # 2. Fill Pattern Parameters
    fill_params = {
        'pattern_type': 'FILL',
        'boundary_id': 'sketch_boundary',
        'target_feature_ids': ['seed_feature'],
        'fill_layout': 'SQUARE',
        'spacing': 10.0,
        'margin': 5.0,
        'fill_angle': 0.0
    }
    
    shape = build_feature_shape_in_isolation('PATTERN', fill_params, None, features)
    
    if shape and not shape.IsNull():
        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        volume = props.Mass()
        
        # Grid logic: boundary 50x50. Grid spacing 10.
        # Grid covers diag of 50x50 approx.
        # Center of boundary (25, 25).
        # We should see approx 4-6 instances if margin and PIP work.
        print(f"Computed Fill Pattern Volume: {volume:.2f}")
        
        # Each seed is 2x2x5 = 20 volume.
        # If we have 25 instances (5x5 grid in 50x50), volume = 500.
        if volume > 100:
            print("✅ Fill Pattern Success!")
        else:
            print(f"❌ Volume {volume} seems low.")
    else:
        print("❌ Shape construction failed.")

if __name__ == "__main__":
    try:
        test_fill_pattern()
    except Exception as e:
        print(f"Test Failed with Error: {e}")
        import traceback
        traceback.print_exc()
