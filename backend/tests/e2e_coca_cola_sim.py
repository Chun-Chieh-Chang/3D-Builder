import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_exercise_coca_cola_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Coca-Cola Bottle...")

    # Phase 1: Main Body (REVOLVE)
    # Profile points for half a bottle
    bottle_profile = [
        [0.0, 0.0],
        [15.0, 0.0],       # Base
        [25.0, 10.0],      # Lower curve
        [25.0, 60.0],      # Main body
        [10.0, 80.0],      # Neck taper
        [10.0, 100.0],     # Neck straight
        [0.0, 100.0],      # Top close
        [0.0, 0.0]         # Back to origin
    ]

    features = [
        {
            "id": "bottle_body",
            "type": "REVOLVE",
            "parameters": {
                "plane": "FRONT",
                "points": bottle_profile,
                "angle": 360.0,
                "axis": [0.0, 1.0, 0.0], # revolve around Y axis
                "operation": "ADD"
            }
        }
    ]

    # Phase 2: Petaloid Base (LOFT) - Mocking profiles
    base_prof_1 = []
    base_prof_2 = []
    for i in range(10):
        theta = 2 * math.pi * (i / 10.0)
        base_prof_1.append([15.0 * math.cos(theta), 15.0 * math.sin(theta)])
        # Star shape for second profile
        r = 15.0 if i % 2 == 0 else 8.0
        base_prof_2.append([r * math.cos(theta), r * math.sin(theta)])

    # Add Loft feature
    features.append({
        "id": "bottle_base",
        "type": "LOFT",
        "parameters": {
            "profiles": [
                {"points": base_prof_1, "z_offset": 0.0},
                {"points": base_prof_2, "z_offset": -10.0}
            ],
            "operation": "ADD"
        }
    })

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated for Coca-Cola Bottle.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_exercise_coca_cola_simulation()
