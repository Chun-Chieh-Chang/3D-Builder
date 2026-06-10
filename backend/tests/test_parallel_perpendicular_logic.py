import math

def test_parallel_perpendicular_logic():
    print("[START] Validating PARALLEL and PERPENDICULAR Constraint Math...")

    # 1. PARALLEL Mock
    # Line 1: (0,0) to (10,10) -> angle = 45 deg
    # Line 2: (0,10) to (10,15) -> angle = ~26.5 deg
    # Goal: Make Line 2 parallel to Line 1
    
    a1 = math.atan2(10-0, 10-0) # 45 deg
    a2 = math.atan2(15-10, 10-0) # 26.56 deg
    
    err = a2 - a1
    err = math.atan2(math.sin(err), math.cos(err))
    
    if abs(err) > math.pi / 2:
        err = err - math.pi if err > 0 else err + math.pi
        
    print(f"Parallel Error Rad: {err}, Deg: {math.degrees(err)}")
    
    # We rotate line 2 by -err
    a2_new = a2 - err
    print(f"New Line 2 Angle Deg: {math.degrees(a2_new)}")
    
    # Check if a2_new is parallel to a1 (0 or 180 diff)
    diff = a2_new - a1
    diff = math.atan2(math.sin(diff), math.cos(diff))
    if abs(diff) > math.pi / 2:
        diff = diff - math.pi if diff > 0 else diff + math.pi
        
    assert math.isclose(diff, 0, abs_tol=1e-7)
    print("[SUCCESS] PARALLEL logic verified.")


    # 2. PERPENDICULAR Mock
    # Line 1: (0,0) to (10,10) -> angle = 45 deg
    # Line 2: (0,10) to (10,15) -> angle = ~26.5 deg
    # Goal: Make Line 2 perpendicular to Line 1 (-45 or 135 deg)
    
    err_perp = a2 - a1
    err_perp = math.atan2(math.sin(err_perp), math.cos(err_perp))
    
    if err_perp > 0:
        err_perp -= math.pi / 2
    else:
        err_perp += math.pi / 2
        
    print(f"Perpendicular Error Rad: {err_perp}, Deg: {math.degrees(err_perp)}")
    
    a2_perp = a2 - err_perp
    print(f"New Line 2 Perp Angle Deg: {math.degrees(a2_perp)}")
    
    # Check if a2_perp is perpendicular to a1
    diff_perp = a2_perp - a1
    diff_perp = math.atan2(math.sin(diff_perp), math.cos(diff_perp))
    
    # Should be close to 90 or -90
    assert math.isclose(abs(diff_perp), math.pi/2, abs_tol=1e-7)
    print("[SUCCESS] PERPENDICULAR logic verified.")

if __name__ == "__main__":
    test_parallel_perpendicular_logic()
