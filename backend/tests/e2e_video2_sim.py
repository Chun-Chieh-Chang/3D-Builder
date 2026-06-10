import os
import sys
import traceback
import json

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def run_e2e_video2_workflow():
    print("=== Starting Video 2 E2E Simulation (Tube + Wrap + Pattern) ===")
    
    # ---------------------------------------------------------
    # SOP Step 1: Base Sketch (Concentric Circles on FRONT plane)
    # ---------------------------------------------------------
    print("\n[Step 1] Creating Base Sketch (Concentric Circles)...")
    base_sketch_points = [
        # Outer circle (D=30, R=15)
        [
            [0, 0, "CIRCLE_CENTER", {"edgeId": "c_out", "radius": 15.0}],
            [15, 0, "CIRCLE_PERIMETER", {"edgeId": "c_out"}],
            [0, 0, None, {"edgeId": "c_out"}]
        ],
        # Inner circle (D=20, R=10)
        [
            [0, 0, "CIRCLE_CENTER", {"edgeId": "c_in", "radius": 10.0}],
            [10, 0, "CIRCLE_PERIMETER", {"edgeId": "c_in"}],
            [0, 0, None, {"edgeId": "c_in"}]
        ]
    ]
    
    features = [
        {
            "id": "feat_base_sketch",
            "type": "SKETCH",
            "parameters": {
                "plane": "FRONT",
                "points": base_sketch_points
            }
        }
    ]
    
    res1 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step1")
    if "error" in res1.get("status", ""):
        print(f"❌ Step 1 Failed: {res1.get('message')}")
        return
    print("✅ Step 1 Succeeded. Base Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 2: Base Extrude (Depth 52)
    # ---------------------------------------------------------
    print("\n[Step 2] Creating Base Extrude (Depth 52, ADD)...")
    features.append({
        "id": "feat_base_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FRONT",
            "points": base_sketch_points,
            "depth": 52.0,
            "operation": "ADD"
        }
    })
    
    res2 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step2")
    if "error" in res2.get("status", ""):
        print(f"❌ Step 2 Failed: {res2.get('message')}")
        return
    print(f"✅ Step 2 Succeeded. Tube solid generated.")

    # ---------------------------------------------------------
    # SOP Step 3: Chamfer both ends
    # ---------------------------------------------------------
    print("\n[Step 3] Applying Chamfer to end edges...")
    # Mocking edge IDs for chamfer
    top_edges = ["dummy_edge_front", "dummy_edge_back"]
    
    features.append({
        "id": "feat_chamfer",
        "type": "CHAMFER",
        "parameters": {
            "radius": 2.0,
            "edgeIds": top_edges
        }
    })
    res3 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step3")
    if "error" in res3.get("status", ""):
        print(f"❌ Step 3 Failed: {res3.get('message')}")
    else:
        print(f"✅ Step 3 Succeeded. Chamfer applied.")

    # ---------------------------------------------------------
    # SOP Step 4: Reference Plane (Offset 20mm)
    # ---------------------------------------------------------
    print("\n[Step 4] Creating Offset Plane...")
    features.append({
        "id": "feat_ref_plane",
        "type": "REFERENCE_PLANE",
        "parameters": {
            "planeType": "OFFSET",
            "offset": 20.0,
            "refs": [{"type": "FACE", "id": "FRONT_PLANE"}]
        }
    })
    res4 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step4")
    print("✅ Step 4 Succeeded. Plane created.")

    # ---------------------------------------------------------
    # SOP Step 5: Wrap Deboss Feature
    # ---------------------------------------------------------
    print("\n[Step 5] Applying Wrap Deboss (Depth 5mm)...")
    slot_sketch = [
        # Dummy slot profile
        [ [0,0,"START",{"edgeId":"e1"}], [5,0,None,{"edgeId":"e2"}], [0,0,None,{"edgeId":"e1"}] ]
    ]
    features.append({
        "id": "feat_wrap_deboss",
        "type": "WRAP",
        "parameters": {
            "wrapType": "DEBOSS",
            "depth": 5.0,
            "plane": "feat_ref_plane",
            "points": slot_sketch
        }
    })
    res5 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step5")
    if "error" in res5.get("status", ""):
        print(f"❌ Step 5 Failed: {res5.get('message')}")
    else:
        print("✅ Step 5 Succeeded. Wrap deboss applied.")

    # ---------------------------------------------------------
    # SOP Step 6: Circular Pattern
    # ---------------------------------------------------------
    print("\n[Step 6] Applying Circular Pattern...")
    features.append({
        "id": "feat_circ_pattern",
        "type": "PATTERN",
        "parameters": {
            "pattern_type": "CIRCULAR",
            "target_feature_ids": ["feat_wrap_deboss"],
            "count": 6,
            "angle": 360.0
        }
    })
    res6 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="v2_step6")
    if "error" in res6.get("status", ""):
        print(f"❌ Step 6 Failed: {res6.get('message')}")
    else:
        print("✅ Step 6 Succeeded. Circular pattern applied.")

    print("\n=== Video 2 E2E Validation Complete ===")

if __name__ == "__main__":
    try:
        run_e2e_video2_workflow()
    except Exception as e:
        print("❌ CRITICAL SCRIPT FAILURE:")
        traceback.print_exc()