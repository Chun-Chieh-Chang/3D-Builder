import math

def test_point_on_edge_logic():
    print("[START] Validating Point-on-Edge COINCIDENT Constraint Math...")

    # Edge: (0,0) to (100, 100) -> Infinite line y = x
    # Node: Initially at (10, 50)
    # Goal: Node should move to its projection on the line -> (30, 30)
    
    e1 = [0.0, 0.0]
    e2 = [100.0, 100.0]
    node = [10.0, 50.0]
    
    dx = e2[0] - e1[0]
    dy = e2[1] - e1[1]
    l2 = dx*dx + dy*dy
    
    t = ((node[0] - e1[0]) * dx + (node[1] - e1[1]) * dy) / l2
    
    projX = e1[0] + t * dx
    projY = e1[1] + t * dy
    
    print(f"Projected point: ({projX}, {projY})")
    
    # Target: t = ((10-0)*100 + (50-0)*100) / 20000 = (1000 + 5000) / 20000 = 0.3
    # projX = 0 + 0.3 * 100 = 30
    # projY = 0 + 0.3 * 100 = 30
    
    assert math.isclose(projX, 30.0)
    assert math.isclose(projY, 30.0)
    print("[SUCCESS] Point-on-Line math verified.")

    # Edge: Circle at (0,0) with R=50
    # Node: Initially at (100, 0)
    # Goal: Node should move to (50, 0)
    
    center = [0.0, 0.0]
    radius = 50.0
    node2 = [100.0, 0.0]
    
    dist = math.hypot(node2[0] - center[0], node2[1] - center[1])
    ratio = radius / dist
    
    finalX = center[0] + (node2[0] - center[0]) * ratio
    finalY = center[1] + (node2[1] - center[1]) * ratio
    
    print(f"Point on circle: ({finalX}, {finalY})")
    assert math.isclose(finalX, 50.0)
    assert math.isclose(finalY, 0.0)
    print("[SUCCESS] Point-on-Circle math verified.")

if __name__ == "__main__":
    test_point_on_edge_logic()
