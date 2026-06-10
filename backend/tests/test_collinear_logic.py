import math

def test_collinear_logic():
    print("[START] Validating COLLINEAR Constraint Math...")
    
    # Line 1: (0,0) to (10,0) -> Horizontal line on y=0
    # Line 2: (20, 5) to (30, 15)
    # Goal: Make Line 2 collinear with Line 1 (so y=0 and angle=0)

    p1a = [0.0, 0.0]
    p1b = [10.0, 0.0]
    p2a = [20.0, 5.0]
    p2b = [30.0, 15.0]
    
    dx1 = p1b[0] - p1a[0]
    dy1 = p1b[1] - p1a[1]
    dx2 = p2b[0] - p2a[0]
    dy2 = p2b[1] - p2a[1]
    
    len1 = math.hypot(dx1, dy1)
    len2 = math.hypot(dx2, dy2)
    
    # 1. Parallel enforcement (rotation)
    angle1 = math.atan2(dy1, dx1)
    angle2 = math.atan2(dy2, dx2)
    errAngle = angle2 - angle1
    errAngle = math.atan2(math.sin(errAngle), math.cos(errAngle))
    if abs(errAngle) > math.pi / 2:
        errAngle = errAngle - math.pi if errAngle > 0 else errAngle + math.pi
        
    print(f"Angle diff: {math.degrees(errAngle)}")
    
    def rotate(px, py, cx, cy, dtheta):
        cos = math.cos(dtheta)
        sin = math.sin(dtheta)
        rx = px - cx
        ry = py - cy
        return [cx + rx*cos - ry*sin, cy + rx*sin + ry*cos]
        
    m2x = (p2a[0] + p2b[0])/2
    m2y = (p2a[1] + p2b[1])/2
    
    # Rotate line 2 by -errAngle to make parallel
    p2a_new = rotate(p2a[0], p2a[1], m2x, m2y, -errAngle)
    p2b_new = rotate(p2b[0], p2b[1], m2x, m2y, -errAngle)
    
    # 2. Coincident to line (projection)
    nx = -dy1 / len1
    ny = dx1 / len1
    
    # Distance from line 2 endpoints to line 1
    distA = (p2a_new[0] - p1a[0])*nx + (p2a_new[1] - p1a[1])*ny
    distB = (p2b_new[0] - p1a[0])*nx + (p2b_new[1] - p1a[1])*ny
    
    print(f"distA: {distA}, distB: {distB}")
    
    # Assume line 1 is fixed (w1 = 0, w2 = 1.0)
    w2 = 1.0
    p2a_final = [p2a_new[0] - distA*nx*w2, p2a_new[1] - distA*ny*w2]
    p2b_final = [p2b_new[0] - distB*nx*w2, p2b_new[1] - distB*ny*w2]
    
    print(f"Final P2a: {p2a_final}")
    print(f"Final P2b: {p2b_final}")
    
    assert math.isclose(p2a_final[1], 0, abs_tol=1e-5)
    assert math.isclose(p2b_final[1], 0, abs_tol=1e-5)
    print("[SUCCESS] Collinear math properly forces line 2 onto line 1.")

if __name__ == "__main__":
    test_collinear_logic()
