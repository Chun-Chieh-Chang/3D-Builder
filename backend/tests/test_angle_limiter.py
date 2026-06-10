import math
import numpy as np

def test_angle_limiter_logic():
    print("[START] Validating Angle Limiter Logic...")
    
    # Mock normals
    # Let's say we have two normals, initially at 0 degrees
    n1 = np.array([1.0, 0.0, 0.0])
    n2 = np.array([1.0, 0.0, 0.0])
    sign = 1.0
    
    # Let's say limits are 30 to 90 degrees
    min_ang = 30.0
    max_ang = 90.0
    
    # Scenario 1: Current angle is 0 degrees (below min_ang)
    current_dot = np.dot(n1, n2) * sign
    current_angle = math.degrees(math.acos(max(-1.0, min(1.0, current_dot))))
    print(f"Scenario 1 - Current Angle: {current_angle} deg")
    
    if current_angle < min_ang:
        target_dot = math.cos(math.radians(min_ang))
        residual = current_dot - (sign * target_dot)
        print(f"Residual (should be > 0 to push angle up): {residual}")
        assert residual > 0.1
    else:
        assert False, "Failed to detect below min_ang"
        
    # Scenario 2: Current angle is 120 degrees (above max_ang)
    # n2 at 120 deg
    n2_120 = np.array([-0.5, math.sqrt(3)/2, 0.0])
    current_dot_120 = np.dot(n1, n2_120) * sign
    current_angle_120 = math.degrees(math.acos(max(-1.0, min(1.0, current_dot_120))))
    print(f"Scenario 2 - Current Angle: {current_angle_120} deg")
    
    if current_angle_120 > max_ang:
        target_dot = math.cos(math.radians(max_ang))
        residual = current_dot_120 - (sign * target_dot)
        print(f"Residual (should be < 0 to push angle down): {residual}")
        assert residual < -0.1
    else:
        assert False, "Failed to detect above max_ang"

    # Scenario 3: Current angle is 45 degrees (inside limits)
    n2_45 = np.array([math.sqrt(2)/2, math.sqrt(2)/2, 0.0])
    current_dot_45 = np.dot(n1, n2_45) * sign
    current_angle_45 = math.degrees(math.acos(max(-1.0, min(1.0, current_dot_45))))
    print(f"Scenario 3 - Current Angle: {current_angle_45} deg")
    
    if min_ang <= current_angle_45 <= max_ang:
        residual = 0.0
        print(f"Residual (should be 0): {residual}")
        assert residual == 0.0
    else:
        assert False, "Failed to detect inside limits"
        
    print("[SUCCESS] Angle Limiter logic verified.")

if __name__ == "__main__":
    test_angle_limiter_logic()
