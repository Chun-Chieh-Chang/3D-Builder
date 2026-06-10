import math
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, HAS_OCC

def test_exercise_A84_simulation():
    if not HAS_OCC:
        print("[SKIP] OpenCASCADE not found. Skipping geometry simulation.")
        return

    print("[START] Simulating SolidWorks Exercise A84...")

    # Phase 1: Main Vertical Pipe (Swept Boss)
    # Path: L shape: Origin (0,0) -> Up (0,80) -> Right (100, 80)
    # With a fillet of 30mm at (0,80).
    # Since we need to provide `path_points`, let's create points along the fillet.
    # Start: (0,0,0) -> (0,50,0) -> arc -> (30,80,0) -> (100,80,0)
    # Wait, BRepFill_PipeShell takes a wire from points. If we provide many points for the arc, it will be a polyline.
    # B-Rep wire from points connects them with linear segments unless there's an arc command.
    # `_build_wire_from_points` usually just builds a polygonal wire if it's just points.
    # Let's see if we can use a simpler geometry or approximate the fillet.
    path_points = []
    path_points.append([0.0, 0.0])
    path_points.append([0.0, 50.0])
    # Approximate 90 deg arc of R=30, center=(30, 50)
    # It goes from (0,50) to (30,80)
    import math
    for i in range(1, 10):
        angle = math.pi/2 * (i/10.0) # from 0 to pi/2, but we start at 180 deg (left) and go to 90 deg (top).
        # Actually center is at x=30, y=50.
        # point = center + (R*cos, R*sin)
        # 180 deg -> (-30, 0) relative to center -> (0, 50)
        # 90 deg -> (0, 30) relative to center -> (30, 80)
        theta = math.pi + (math.pi/2 * (-i/10.0))  # going from pi to pi/2
        px = 30.0 + 30.0 * math.cos(theta)
        py = 50.0 + 30.0 * math.sin(theta)
        path_points.append([px, py])
    path_points.append([30.0, 80.0])
    path_points.append([100.0, 80.0])
    
    # Actually, sweep path is in 3D, so we need [x, y, z] for points? 
    # Let's check `_build_wire_from_points` to see if it takes 2D or 3D. 
    # Usually it takes 2D and assumes z=0 if length is 2.
    # Wait, the profile must be at the start of the path and perpendicular to it.
    # The start is (0,0,0), tangent is (0,1,0). 
    # The profile should be on the XZ plane.
    # profile_points: a circle of diameter 50 (R=25) on XZ plane.
    # Since `_build_wire_from_points` might only support 2D points on the sketch plane.
    # How does SWEEP map the profile_points to the path?
    # SolidWorks Sweep expects a 2D sketch for profile and 2D sketch for path.
    # If `build_feature_shape_in_isolation` for SWEEP doesn't transform the profile to the path start, we might have an issue.
    # Let's provide 3D points for profile if we can, or just use 2D.
    # Let's see if there is an alternative approach:
    # Use Extrude + Cylinder for vertical and horizontal parts, a sphere for the corner?
    # Let's just try SWEEP.
    
    profile_points = []
    for i in range(20):
        theta = 2 * math.pi * (i / 20.0)
        profile_points.append([25.0 * math.cos(theta), 25.0 * math.sin(theta)])
    
    features = [
        {
            "id": "pipe_sweep",
            "type": "SWEEP",
            "parameters": {
                "profile_points": profile_points,
                "path_points": [[p[0], p[1], 0.0] for p in path_points],
                "operation": "ADD"
            }
        }
    ]

    result = process_features(features)
    
    if result and result.get('data'):
        print("[SUCCESS] Mesh generated.")
    else:
        print("[FAILURE] Mesh generation failed.")

if __name__ == "__main__":
    test_exercise_A84_simulation()
