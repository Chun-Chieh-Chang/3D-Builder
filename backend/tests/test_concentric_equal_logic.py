import math

def test_concentric_equal_logic():
    print("[START] Validating CONCENTRIC and EQUAL Constraint Math...")

    # Mock CONCENTRIC
    # Circle 1: Center (0,0), R=10
    # Circle 2: Center (5,5), R=20
    # Goal: Circle 2 center moves to (0,0) or halfway
    
    n1 = [0.0, 0.0]  # Center 1
    n2 = [5.0, 5.0]  # Center 2
    
    dx = n2[0] - n1[0]
    dy = n2[1] - n1[1]
    
    w1 = 0.5
    w2 = 0.5
    
    n1[0] += dx * w1
    n1[1] += dy * w1
    n2[0] -= dx * w2
    n2[1] -= dy * w2
    
    print(f"Concentric centers after relaxation: C1: {n1}, C2: {n2}")
    assert math.isclose(n1[0], 2.5) and math.isclose(n1[1], 2.5)
    assert math.isclose(n2[0], 2.5) and math.isclose(n2[1], 2.5)
    print("[SUCCESS] CONCENTRIC logic verified.")

    # Mock EQUAL
    # Line 1: (0,0) to (10,0) -> Length 10
    # Line 2: (0,10) to (20,10) -> Length 20
    # Goal: Both lengths become 15
    
    p1a = [0.0, 0.0]
    p1b = [10.0, 0.0]
    p2a = [0.0, 10.0]
    p2b = [20.0, 10.0]
    
    l1 = math.hypot(p1b[0]-p1a[0], p1b[1]-p1a[1])
    l2 = math.hypot(p2b[0]-p2a[0], p2b[1]-p2a[1])
    
    diff = (l1 - l2) / 2
    
    nx1 = (p1b[0]-p1a[0]) / l1
    ny1 = (p1b[1]-p1a[1]) / l1
    nx2 = (p2b[0]-p2a[0]) / l2
    ny2 = (p2b[1]-p2a[1]) / l2
    
    # Expand L1 by diff/2 on each side, Shrink L2 by diff/2 on each side
    # diff = (10 - 20) / 2 = -5
    
    w1a = 0.5; w1b = 0.5
    w2a = 0.5; w2b = 0.5
    
    p1a[0] += nx1 * diff * w1a; p1a[1] += ny1 * diff * w1a
    p1b[0] -= nx1 * diff * w1b; p1b[1] -= ny1 * diff * w1b
    
    p2a[0] -= nx2 * diff * w2a; p2a[1] -= ny2 * diff * w2a
    p2b[0] += nx2 * diff * w2b; p2b[1] += ny2 * diff * w2b
    
    newL1 = math.hypot(p1b[0]-p1a[0], p1b[1]-p1a[1])
    newL2 = math.hypot(p2b[0]-p2a[0], p2b[1]-p2a[1])
    
    print(f"Equal constraint lengths after relaxation: L1: {newL1}, L2: {newL2}")
    assert math.isclose(newL1, 15.0)
    assert math.isclose(newL2, 15.0)
    print("[SUCCESS] EQUAL logic verified.")

if __name__ == "__main__":
    test_concentric_equal_logic()
