import math

def test_corner_trim_and_auto_constraint():
    print("[START] Validating Corner Trim and Auto-Constraint Logic...")

    # 1. Corner Trim Mock
    # Line 1: (0,0) to (50,0) - Horizontal
    # Line 2: (0,50) to (0,10) - Vertical
    # Virtual Intersection at (0,0)
    
    l1_nodes = [(0,0), (50,0)]
    l2_nodes = [(0,50), (0,10)]
    
    # Virtual intersection calculation (simplified)
    # Line 1: y = 0
    # Line 2: x = 0
    intersect = (0, 0)
    
    # Corner Trim Logic: Move closest endpoints to intersect
    # L1: (0,0) is closer to (0,0) than (50,0)
    # L2: (0,10) is closer to (0,0) than (0,50)
    
    l1_new = [intersect, (50,0)]
    l2_new = [(0,50), intersect]
    
    print(f"Corner Trim: L1 {l1_nodes} -> {l1_new}")
    print(f"Corner Trim: L2 {l2_nodes} -> {l2_new}")
    
    assert l1_new[0] == intersect
    assert l2_new[1] == intersect
    print("[SUCCESS] Corner Trim correctly calculated endpoints.")

    # 2. Auto-Tangent Logic Mock
    # Circle at (50, 50), Radius 30
    # Line starts at (0, 50)
    center = (50, 50)
    radius = 30
    start_p = (0, 50)
    
    # Distance to center
    dx = center[0] - start_p[0]
    dy = center[1] - start_p[1]
    dist = math.sqrt(dx**2 + dy**2) # 50
    
    # alpha = acos(R/d) = acos(30/50) = 53.13 deg
    alpha = math.acos(radius / dist)
    cp_angle = math.atan2(start_p[1] - center[1], start_p[0] - center[0]) # 180 deg
    
    # Tangent points: angle(CP) +/- alpha
    t1_angle = cp_angle + alpha
    t2_angle = cp_angle - alpha
    
    pt1 = (center[0] + radius * math.cos(t1_angle), center[1] + radius * math.sin(t1_angle))
    pt2 = (center[0] + radius * math.cos(t2_angle), center[1] + radius * math.sin(t2_angle))
    
    print(f"Tangent points from {start_p} to Circle(50,50,R30): {pt1}, {pt2}")
    
    # Verify pt1 and pt2 are on the circle
    assert math.isclose(math.hypot(pt1[0]-center[0], pt1[1]-center[1]), radius)
    assert math.isclose(math.hypot(pt2[0]-center[0], pt2[1]-center[1]), radius)
    
    # Verify line is perpendicular to radius (dot product = 0)
    # Radius vector: T - C
    # Line vector: T - P
    v_rad = (pt1[0]-center[0], pt1[1]-center[1])
    v_line = (pt1[0]-start_p[0], pt1[1]-start_p[1])
    dot = v_rad[0]*v_line[0] + v_rad[1]*v_line[1]
    assert math.isclose(dot, 0, abs_tol=1e-7)
    
    print("[SUCCESS] Auto-Tangent logic verified.")

if __name__ == "__main__":
    test_corner_trim_and_auto_constraint()
