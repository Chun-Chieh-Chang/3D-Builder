# Manual UI Validation SOP: SolidWorks Exercise 6

## Goal
Verify that the 3D-Builder UI can execute the modeling steps for Exercise 6 and produce the correct visual and geometric result.

## Prerequisites
- [ ] 3D-Builder Backend is running (FastAPI).
- [ ] 3D-Builder Frontend is running (Next.js).
- [ ] Browser console is open for error monitoring.

## Step-by-Step Validation

### 1. Base Extrusion
1.  **Select Plane**: Click on **TOP** plane in the viewport.
2.  **Sketch**: Click **Sketch** button in the Ribbon.
3.  **Center Rectangle**:
    - Select **Center Rectangle** tool from the Toolbar.
    - Click on the **Origin** (0,0) as the center.
    - Drag to create a rectangle.
4.  **Dimension**:
    - Use **Smart Dimension** to set width to **90mm**.
    - Set height to **64mm**.
5.  **Exit & Extrude**:
    - Click **Exit Sketch**.
    - In the PropertyManager, set **Depth** to **33mm**.
    - Click **OK** (Checkmark).
6.  **Verify**: Model shows a 90x64x33 block.

### 2. Top Center Slot (Cut)
1.  **Select Face**: Click on the **Top Face** of the block.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Click **Origin** (projected).
    - Draw a rectangle.
4.  **Dimension**:
    - Set width to **90mm**.
    - Set height to **16mm**.
5.  **Exit & Cut**:
    - Click **Exit Sketch**.
    - Select **Extrude Cut** (or toggle Cut in PropertyManager).
    - Set **Depth** to **25mm**.
    - Click **OK**.
6.  **Verify**: A slot is cut through the center of the top face.

### 3. Center Through Hole
1.  **Select Face**: Click on the **Bottom Face** of the newly created slot.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Click **Origin**.
    - Draw 26mm x 14mm rectangle.
4.  **Exit & Cut**:
    - Click **Exit Sketch**.
    - Select **Extrude Cut**.
    - Set **Condition** to **Through All** (or depth > 8mm).
    - Click **OK**.
5.  **Verify**: A hole passes completely through the part.

## Final Check
- [ ] Check Mass Properties: Volume should be approximately **151,168 mm³**.
- [ ] Check for visual artifacts or "z-fighting".
- [ ] Check Console for any `NaN` or `undefined` errors during rebuild.
