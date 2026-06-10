import math
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.geometry_service import process_features, calculate_mass_properties

def test_pressure_tank_simulation():
    """
    Simulation of Video 3: Pressure Tank Body.
    Profile: A vertical line, a tangent arc (dish top), and another tangent arc or line.
    Actually, a typical pressure tank profile for revolve is:
    - Vertical construction line (Axis)
    - Profile: 
        1. Vertical line (sidewall)
        2. Tangent arc (top head)
        3. Horizontal line (to axis)
        4. Vertical line (along axis) - or just close to axis.
    """
    print("Starting E2E Simulation: Pressure Tank...")

    # Define the sketch profile for Revolve
    # Coordinates in local UV space of the FRONT plane
    # R=500mm, H=1000mm, Head Radius=500mm
    # Profile points for a half-section:
    # (0, 0) -> (500, 0) [Bottom]
    # (500, 0) -> (500, 1000) [Sidewall]
    # (500, 1000) -> (0, 1500) [Top Head - Arc]
    # (0, 1500) -> (0, 0) [Axis]

    # To simulate ARC, we need [x, y, tag]
    # Arc from (500, 1000) to (0, 1500) with a control point to make it a quadrant
    # A circular arc tangent to the vertical sidewall at (500, 1000) 
    # Center would be at (0, 1000), Radius 500.
    # Control point for 3-point arc (approximate or precise)
    # Midpoint of 90 deg arc: (500*cos(45), 1000 + 500*sin(45)) = (353.5, 1353.5)

    sketch_params = {
        "id": "sketch_tank",
        "plane": "FRONT",
        "points": [
            [
                [0, 0, "START"],
                [500, 0],
                [500, 1000],
                [353.55, 1353.55, "ARC_CONTROL"],
                [0, 1500],
                [0, 0]
            ]
        ]
    }

    features = [
        {
            "id": "f1",
            "type": "REVOLVE",
            "parameters": {
                "id": "revolve_tank",
                "angle": 360,
                "plane": "FRONT",
                "points": sketch_params["points"],
                # Axis: Vertical line from (0,0) to (0,1500)
                # In current backend, it defaults to Y-axis in local space (u=0).
                # Since our axis IS u=0, it should work.
            }
        }
    ]

    try:
        # 1. Process features to build B-Rep
        shape_data = process_features(features, deflection=0.1)
        
        if shape_data:
            print("Successfully built Pressure Tank solid.")
            
            # 2. Calculate Mass Properties
            props = calculate_mass_properties(features, material_id="STEEL")
            if props:
                print(f"Volume: {props['volume']:.2f} mm^3")
                print(f"Mass: {props['mass']:.2f} kg")
                print(f"Center of Mass: {props['center_of_mass']}")
                
                # Expected Volume calculation:
                # Cylinder: pi * 500^2 * 1000 = 785,398,163
                # Hemispherical Top: (2/3) * pi * 500^3 = 261,799,387
                # Total: ~1,047,197,550 mm^3
                expected_vol = 1047197550
                diff = abs(props['volume'] - expected_vol) / expected_vol
                if diff < 0.01:
                    print("SUCCESS: Volume within 1% of theoretical value.")
                else:
                    print(f"WARNING: Volume difference {diff*100:.2f}%")
            else:
                print("FAILED: Mass properties calculation returned None.")
        else:
            print("FAILED: process_features returned None.")

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"CRITICAL ERROR during simulation: {e}")

if __name__ == "__main__":
    test_pressure_tank_simulation()
