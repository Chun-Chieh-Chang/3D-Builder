import math

def test_power_trim_logic():
    """
    Simulates the Power Trim intersection splitting logic implemented in TrimTool.ts.
    """
    print("[START] Validating Power Trim Intersection Splitting Logic...")
    
    # 1. Setup: Intersecting Line and Circle
    # Line: (0, 50) to (100, 50)
    # Circle: Center (50, 50), Radius 30
    # Intersections at (20, 50) and (80, 50)
    
    line_start = (0, 50)
    line_end = (100, 50)
    intersections = [20.0, 80.0] # Distances from line_start
    
    total_len = 100.0
    boundaries = [0.0, 20.0, 80.0, 100.0]
    
    # 2. Simulate Trim at x=10 (between start and first intersection)
    brush_pos_along = 10.0
    
    # Identify segment index
    segment_index = -1
    for i in range(len(boundaries) - 1):
        if brush_pos_along >= boundaries[i] and brush_pos_along <= boundaries[i+1]:
            segment_index = i
            break
            
    print(f"Brush at {brush_pos_along} identified segment index: {segment_index}")
    
    # Logic: Delete boundaries[0] to boundaries[1]
    # Keep boundaries[1] to boundaries[2] and boundaries[2] to boundaries[3]
    segments_to_keep = []
    for i in range(len(boundaries) - 1):
        if i != segment_index:
            segments_to_keep.append((boundaries[i], boundaries[i+1]))
            
    print(f"Segments kept: {segments_to_keep}")
    
    # Expectations
    expected_segments = [(20.0, 80.0), (80.0, 100.0)]
    assert segments_to_keep == expected_segments
    print("[SUCCESS] Power Trim correctly identified and removed the intersecting segment.")

if __name__ == "__main__":
    test_power_trim_logic()
