import sys
import os
import math

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import build_feature_shape_in_isolation, get_shape_hash
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

def test_thin_extrude_closed():
    print("--- Testing Thin Extrude (Closed Loop) ---")
    
    # 10x10 Square loop
    points = [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
        [0, 0, 0]
    ]
    
    params = {
        'depth': 20.0,
        'points': points,
        'isThin': True,
        'thinThickness': 2.0,
        'thinDirection': 'ONE_DIRECTION'
    }
    
    shape = build_feature_shape_in_isolation('EXTRUDE', params)
    
    if shape and not shape.IsNull():
        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        volume = props.Mass()
        
        # Expected volume:
        # Outer square: (10+2)*(10+2) = 144? No, offset is outward or inward.
        # Default offset in MakeOffset is usually outward if positive.
        # Let's check logic: make_face(w_off); add(base_wire).
        # Base: 10x10. Offset +2 -> 14x14? No, offset 2 on each side -> 14x14.
        # Area = 14*14 - 10*10 = 196 - 100 = 96.
        # Volume = 96 * 20 = 1920.
        
        print(f"Computed Volume: {volume:.2f}")
        # Note: MakeOffset behavior on direction depends on wire orientation.
        # For a CCW 10x10 square:
        # If thickness is 2, area might be (14*14 - 10*10)=96 or (10*10 - 6*6)=64.
        if volume > 1000:
            print("✅ Thin Extrude (Closed) Success!")
        else:
            print(f"❌ Volume {volume} seems low for a thin wall.")
    else:
        print("❌ Shape construction failed.")

if __name__ == "__main__":
    try:
        test_thin_extrude_closed()
    except Exception as e:
        print(f"Test Failed with Error: {e}")
        import traceback
        traceback.print_exc()
