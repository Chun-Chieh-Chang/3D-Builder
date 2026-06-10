import sys
import os
import math

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import build_feature_shape_in_isolation
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

def test_surface_cut():
    print("--- Testing Surface Cut ---")
    
    # Base Box: 50x50x50 at origin
    features = [
        {
            'id': 'base_box',
            'type': 'BOX',
            'parameters': {'width': 50, 'height': 50, 'depth': 50, 'operation': 'ADD'}
        },
        {
            # A plane or surface to cut with. Let's make an extruded surface.
            'id': 'cut_surface',
            'type': 'EXTRUDE',
            'parameters': {
                # Line from (0,25,0) to (50,25,0)
                'points': [[0,25,0], [50,25,0]],
                'depth': 60.0,
                'isSurfaceOnly': True,
                'operation': 'ADD' # surface features don't add to final solid usually, but for tool we evaluate in isolation
            }
        }
    ]
    
    # 2. Surface Cut Parameters
    cut_params = {
        'tool_feature_id': 'cut_surface',
        'flip': False, # Normal of extrusion depends on line direction. Line is +X, extrude is +Z. Cross product = +Y.
        'operation': 'ADD' # SURFACE_CUT just modifies final_shape in process_features. Let's test process_features
    }
    
    # We need to run process_features to see the cut
    from app.services.geometry_service import process_features
    
    test_features = features + [
        {
            'id': 'surface_cut',
            'type': 'SURFACE_CUT',
            'parameters': cut_params
        }
    ]
    
    from app.services.geometry_service import TopoDS_Shape
    # process_features requires a proper mock for TNS linker.
    # We can pass an empty list of updates.
    updates = []
    final_shape = process_features(test_features, updates)
    
    if final_shape and not final_shape.IsNull():
        props = GProp_GProps()
        brepgprop.VolumeProperties(final_shape, props)
        volume = props.Mass()
        
        # Original volume = 50*50*50 = 125000
        # Cut at Y=25. Volume should be halved to 62500.
        print(f"Computed Volume after Surface Cut: {volume:.2f}")
        
        if abs(volume - 62500) < 1000:
            print("✅ Surface Cut Success!")
        else:
            print(f"❌ Volume {volume} does not match expected 62500.")
    else:
        print("❌ Shape construction failed.")

if __name__ == "__main__":
    try:
        test_surface_cut()
    except Exception as e:
        print(f"Test Failed with Error: {e}")
        import traceback
        traceback.print_exc()
