import os
import sys
import traceback
import json

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def run_e2e_pz2_bit_workflow():
    print("=== Starting PZ2 Screwdriver Bit E2E Simulation ===")
    
    # ---------------------------------------------------------
    # SOP Step 1: Hex Base Sketch (TOP plane)
    # Hexagon: distance across flats = 6.35mm (1/4 inch)
    # R_corner = 3.666, R_flat = 3.175
    # ---------------------------------------------------------
    print("\n[Step 1] Creating Hex Base Sketch (TOP Plane)...")
    hex_points = [
        [
            [3.666, 0, "START", {"edgeId": "h1"}],
            [1.833, 3.175, None, {"edgeId": "h2"}],
            [-1.833, 3.175, None, {"edgeId": "h3"}],
            [-3.666, 0, None, {"edgeId": "h4"}],
            [-1.833, -3.175, None, {"edgeId": "h5"}],
            [1.833, -3.175, None, {"edgeId": "h6"}],
            [3.666, 0, None, {"edgeId": "h1"}]
        ]
    ]
    
    features = [
        {
            "id": "feat_hex_sketch",
            "type": "SKETCH",
            "parameters": {
                "plane": "TOP",
                "points": hex_points
            }
        }
    ]
    
    res1 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step1")
    if "error" in res1.get("status", ""):
        print(f"❌ Step 1 Failed: {res1.get('message')}")
        return
    print("✅ Step 1 Succeeded. Hex Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 2: Extrude Hex Base (Depth 10.0)
    # ---------------------------------------------------------
    print("\n[Step 2] Extruding Hex Base (Depth 10.0)...")
    features.append({
        "id": "feat_hex_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": hex_points,
            "depth": 10.0,
            "operation": "ADD"
        }
    })
    
    res2 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step2")
    if "error" in res2.get("status", ""):
        print(f"❌ Step 2 Failed: {res2.get('message')}")
        return
    print(f"✅ Step 2 Succeeded. Hex base generated. Mesh vertices: {len(res2['data']['vertices'])}")

    # ---------------------------------------------------------
    # SOP Step 3: Shank Sketch (On Hex Top Face Z=10)
    # Circle Diameter 6.0
    # ---------------------------------------------------------
    print("\n[Step 3] Creating Shank Sketch (Circle D=6.0 on Z=10 Face)...")
    shank_sketch_points = [
        [
            [0, 0, "CIRCLE_CENTER", {"edgeId": "s1", "planeNormal": [0, 0, 1]}],
            [3.0, 0, "CIRCLE_PERIMETER", {"edgeId": "s1", "planeNormal": [0, 0, 1]}],
            [0, 0, None, {"edgeId": "s1", "planeNormal": [0, 0, 1]}]
        ]
    ]
    features.append({
        "id": "feat_shank_sketch",
        "type": "SKETCH",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 10.0],
            "faceNormal": [0, 0, 1],
            "points": shank_sketch_points
        }
    })
    res3 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step3")
    if "error" in res3.get("status", ""):
        print(f"❌ Step 3 Failed: {res3.get('message')}")
        return
    print("✅ Step 3 Succeeded. Shank Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 4: Extrude Shank (Depth 15.0)
    # ---------------------------------------------------------
    print("\n[Step 4] Extruding Shank (Depth 15.0)...")
    features.append({
        "id": "feat_shank_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 10.0],
            "faceNormal": [0, 0, 1],
            "points": shank_sketch_points,
            "depth": 15.0,
            "operation": "ADD"
        }
    })
    res4 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step4")
    if "error" in res4.get("status", ""):
        print(f"❌ Step 4 Failed: {res4.get('message')}")
        return
    print(f"✅ Step 4 Succeeded. Shank generated. Mesh vertices: {len(res4['data']['vertices'])}")

    # ---------------------------------------------------------
    # SOP Step 5: Tip Sketch (On Shank Top Face Z=25)
    # Circle Diameter 2.0 (for taper)
    # ---------------------------------------------------------
    print("\n[Step 5] Creating Tip Sketch (Circle D=2.0 on Z=25 Face)...")
    tip_sketch_points = [
        [
            [0, 0, "CIRCLE_CENTER", {"edgeId": "t1", "planeNormal": [0, 0, 1]}],
            [1.0, 0, "CIRCLE_PERIMETER", {"edgeId": "t1", "planeNormal": [0, 0, 1]}],
            [0, 0, None, {"edgeId": "t1", "planeNormal": [0, 0, 1]}]
        ]
    ]
    features.append({
        "id": "feat_tip_sketch",
        "type": "SKETCH",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 25.0],
            "faceNormal": [0, 0, 1],
            "points": tip_sketch_points
        }
    })
    res5 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step5")
    if "error" in res5.get("status", ""):
        print(f"❌ Step 5 Failed: {res5.get('message')}")
        return
    print("✅ Step 5 Succeeded. Tip Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 6: Extrude Tip (Depth 5.0, ADD)
    # Note: In a real model this would be a loft or tapered extrude.
    # We will simulate a simple cylinder for now as requested.
    # ---------------------------------------------------------
    print("\n[Step 6] Extruding Tip (Depth 5.0)...")
    features.append({
        "id": "feat_tip_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 25.0],
            "faceNormal": [0, 0, 1],
            "points": tip_sketch_points,
            "depth": 5.0,
            "operation": "ADD"
        }
    })
    res6 = geometry_service.process_features_cached(features, deflection=0.1, from_feature_index=0, feature_fingerprint="pz2_step6")
    if "error" in res6.get("status", ""):
        print(f"❌ Step 6 Failed: {res6.get('message')}")
        return
    print(f"✅ Step 6 Succeeded. Tip generated. Mesh vertices: {len(res6['data']['vertices'])}")

    print("\n=== PZ2 Bit Modeling Simulation Complete ===")

if __name__ == "__main__":
    try:
        run_e2e_pz2_bit_workflow()
    except Exception as e:
        print("❌ CRITICAL SCRIPT FAILURE:")
        traceback.print_exc()
