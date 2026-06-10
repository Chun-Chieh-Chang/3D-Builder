import math

def test_equal_radius_logic():
    print("[START] Validating EQUAL Radius Constraint Math...")

    # Circle 1: Center (0,0), Perimeter (10,0) -> R=10
    # Circle 2: Center (50,50), Perimeter (70,50) -> R=20
    # Goal: Both radii become 15
    
    c1 = [0.0, 0.0]
    p1 = [10.0, 0.0]
    c2 = [50.0, 50.0]
    p2 = [70.0, 50.0]
    
    r1 = math.hypot(p1[0] - c1[0], p1[1] - c1[1])
    r2 = math.hypot(p2[0] - c2[0], p2[1] - c2[1])
    
    targetR = (r1 + r2) / 2 # (10 + 20) / 2 = 15
    
    def relax(center, perimeter, target):
        curr = math.hypot(perimeter[0] - center[0], perimeter[1] - center[1])
        ratio = target / curr
        # Perimeter moves
        perimeter[0] = center[0] + (perimeter[0] - center[0]) * ratio
        perimeter[1] = center[1] + (perimeter[1] - center[1]) * ratio
        
    relax(c1, p1, targetR)
    relax(c2, p2, targetR)
    
    newR1 = math.hypot(p1[0] - c1[0], p1[1] - c1[1])
    newR2 = math.hypot(p2[0] - c2[0], p2[1] - c2[1])
    
    print(f"Equal radii after relaxation: R1: {newR1}, R2: {newR2}")
    assert math.isclose(newR1, 15.0)
    assert math.isclose(newR2, 15.0)
    print("[SUCCESS] EQUAL radius logic verified.")

if __name__ == "__main__":
    test_equal_radius_logic()
