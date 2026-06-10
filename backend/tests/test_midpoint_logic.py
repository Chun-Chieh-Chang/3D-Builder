import math

def test_midpoint_logic():
    print("[START] Validating MIDPOINT Constraint Math...")

    # Line: (0,0) to (100, 100) -> Midpoint is (50, 50)
    # Target Node: Initially at (0, 100)
    # Goal: Target Node should move to (50, 50)
    
    n1 = [0.0, 0.0]
    n2 = [100.0, 100.0]
    targetNode = [0.0, 100.0]
    
    midX = (n1[0] + n2[0]) / 2
    midY = (n1[1] + n2[1]) / 2
    
    dx = midX - targetNode[0]
    dy = midY - targetNode[1]
    
    # targetNode moves towards mid
    targetNode[0] += dx
    targetNode[1] += dy
    
    print(f"Midpoint node after relaxation: {targetNode}")
    assert math.isclose(targetNode[0], 50.0)
    assert math.isclose(targetNode[1], 50.0)
    print("[SUCCESS] MIDPOINT logic verified.")

if __name__ == "__main__":
    test_midpoint_logic()
