import os
import sys
import tempfile
import traceback
import json

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))
from app.services import geometry_service

def run_e2e_workflow():
    print("=== Starting E2E Construction SOP Validation ===")
    
    # ---------------------------------------------------------
    # SOP Step 1: Base Sketch (100x100 Rectangle on TOP plane)
    # ---------------------------------------------------------
    print("\n[Step 1] Creating Base Sketch (Rectangle on TOP Plane)...")
    base_sketch_points = [
        [
            [-50, -50, "START", {"edgeId": "e1"}],
            [50, -50, None, {"edgeId": "e2"}],
            [50, 50, None, {"edgeId": "e3"}],
            [-50, 50, None, {"edgeId": "e4"}],
            [-50, -50, None, {"edgeId": "e1"}]
        ]
    ]
    
    features = [
        {
            "id": "feat_base_sketch",
            "type": "SKETCH",
            "parameters": {
                "plane": "TOP",
                "points": base_sketch_points
            }
        }
    ]
    
    res1 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step1")
    if "error" in res1.get("status", ""):
        print(f"❌ Step 1 Failed: {res1.get('message')}")
        return
    print("✅ Step 1 Succeeded. Base Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 2: Base Extrude (ADD, depth 50)
    # ---------------------------------------------------------
    print("\n[Step 2] Creating Base Extrude (Depth 50, ADD)...")
    features.append({
        "id": "feat_base_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "TOP",
            "points": base_sketch_points,
            "depth": 50.0,
            "operation": "ADD"
        }
    })
    
    res2 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step2")
    if "error" in res2.get("status", ""):
        print(f"❌ Step 2 Failed: {res2.get('message')}")
        return
    print(f"✅ Step 2 Succeeded. Solid body generated. Mesh vertices count: {len(res2['data']['vertices'])}")

    # ---------------------------------------------------------
    # SOP Step 3: Cut Sketch (Circle on top face Z=50)
    # ---------------------------------------------------------
    print("\n[Step 3] Creating Cut Sketch (Circle on FACE Z=50)...")
    cut_sketch_points = [
        [
            [0, 0, "CIRCLE_CENTER", {"edgeId": "c1", "planeNormal": [0, 0, 1]}],
            [25, 0, "CIRCLE_PERIMETER", {"edgeId": "c1", "planeNormal": [0, 0, 1]}],
            [0, 0, None, {"edgeId": "c1", "planeNormal": [0, 0, 1]}]
        ]
    ]
    features.append({
        "id": "feat_cut_sketch",
        "type": "SKETCH",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 50],
            "faceNormal": [0, 0, 1],
            "points": cut_sketch_points
        }
    })
    res3 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step3")
    if "error" in res3.get("status", ""):
        print(f"❌ Step 3 Failed: {res3.get('message')}")
        return
    print("✅ Step 3 Succeeded. Cut Sketch created.")

    # ---------------------------------------------------------
    # SOP Step 4: Cut Extrude (CUT, depth 50)
    # ---------------------------------------------------------
    print("\n[Step 4] Creating Cut Extrude (Depth 50, CUT)...")
    features.append({
        "id": "feat_cut_extrude",
        "type": "EXTRUDE",
        "parameters": {
            "plane": "FACE",
            "faceOrigin": [0, 0, 50],
            "faceNormal": [0, 0, 1],
            "points": cut_sketch_points,
            "depth": 50.0,
            "operation": "CUT"
        }
    })
    res4 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step4")
    if "error" in res4.get("status", ""):
        print(f"❌ Step 4 Failed: {res4.get('message')}")
        return
    print(f"✅ Step 4 Succeeded. Hole cut successfully. Mesh vertices count: {len(res4['data']['vertices'])}")

    # ---------------------------------------------------------
    # SOP Step 5: Fillet on an edge
    # ---------------------------------------------------------
    print("\n[Step 5] Applying Fillet to top edges...")
    # Find edges at Z=50 to fillet. We can look at the topology edges from res4.
    top_edges = []
    if "topology" in res4["data"] and "edges" in res4["data"]["topology"]:
        for edge_info in res4["data"]["topology"]["edges"]:
            # Check if edge is roughly at Z=50
            start_z = edge_info["start"][2]
            end_z = edge_info["end"][2]
            if abs(start_z - 50) < 1e-3 and abs(end_z - 50) < 1e-3:
                top_edges.append(edge_info["id"])
    
    if not top_edges:
        print("⚠️ Could not dynamically find top edges for fillet. Using dummy ID to test error handling.")
        top_edges = ["dummy_edge_id"]
    
    features.append({
        "id": "feat_fillet",
        "type": "FILLET",
        "parameters": {
            "radius": 5.0,
            "edgeIds": [top_edges[0]] # Just fillet one edge
        }
    })
    res5 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step5")
    if "error" in res5.get("status", ""):
        print(f"❌ Step 5 Failed: {res5.get('message')}")
    else:
        print(f"✅ Step 5 Succeeded. Fillet applied. Mesh vertices count: {len(res5['data']['vertices'])}")

    # ---------------------------------------------------------
    # SOP Step 6: Clear session
    # ---------------------------------------------------------
    print("\n[Step 6] Clearing Session...")
    features.clear()
    res6 = geometry_service.process_features_cached(features, deflection=0.5, from_feature_index=0, feature_fingerprint="step6")
    if "error" in res6.get("status", ""):
        print(f"❌ Step 6 Failed: {res6.get('message')}")
    else:
        print(f"✅ Step 6 Succeeded. Workspace cleared. Mesh vertices: {len(res6.get('data', {}).get('vertices', []))}")

    print("\n=== E2E Validation Complete ===")

if __name__ == "__main__":
    try:
        run_e2e_workflow()
    except Exception as e:
        print("❌ CRITICAL SCRIPT FAILURE:")
        traceback.print_exc()
