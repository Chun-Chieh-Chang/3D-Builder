# Spanner (Wrench) Modeling SOP - Industrial Parity V2

This SOP follows the SolidWorks 2000 industrial workflow for modeling a combination spanner, incorporating the latest 3D-Builder features.

## 1. Base Sketch (Top Plane)
- Select **Top Plane** and enter **Sketch Mode**.
- Draw a **Centerline** (Construction Line) horizontally from the origin.
- Draw two circles:
    - **Circle 1 (Large Head)**: Diameter **32mm**, Center at **(-52, 0)**.
    - **Circle 2 (Small Head)**: Diameter **26mm**, Center at **(52, 0)**.
- Exit Sketch.

## 2. Heads Extrusion
- Select the sketch and use **Extruded Boss/Base**.
- **End Condition**: `Mid Plane`.
- **Depth**: `6mm`.
- Confirm (Green Check).

## 3. Handle Sketch & Extrude
- Select **Top Plane** and enter **Sketch Mode**.
- Draw a **Center Rectangle** at the origin.
- **Dimensions**: `104mm x 10mm`.
- Exit Sketch.
- Use **Extruded Boss/Base**.
- **End Condition**: `Mid Plane`.
- **Depth**: `3.5mm`.
- Confirm.

## 4. Open End Cut (Large Head)
- Select the **top face** of the large head (or Top Plane).
- Draw a rectangle or use the **Polygon** workaround (Line tool).
- **Width**: `18mm`.
- **Tilt**: Rotate the profile by **18 degrees** relative to the handle axis.
- Use **Extruded Cut**.
- **End Condition**: `Through All`.
- Confirm.

## 5. Ring End Cut (Small Head) - 12-Point Star
- Select the **top face** of the small head.
- **Step A**: Draw a Hexagon (use Line tool for 6 points, 13mm across flats).
- **Step B**: Draw a second Hexagon, rotated **30 degrees** from the first.
- Use **Extruded Cut**.
- **End Condition**: `Through All`.
- *Note: In 3D-Builder, you may perform this as two separate Cut features if multi-loop is not selected.*

## 6. Finishing Touches
- Add **Fillets** (R2-R5) to the transitions between heads and handle.
- Assign material: **Chrome Steel**.
- Verify **Mass Properties**.
