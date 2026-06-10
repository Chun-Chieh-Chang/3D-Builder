# SolidWorks Exercise A84 - Expert Step-by-Step Guide

**Source**: [YouTube: SolidWorks Tutorial for beginners Exercise A84](https://www.youtube.com/watch?v=vhO94xdr6Qg)
**Author**: SolidWorks Expert Subagent
**Target Application**: 3D-Builder (SolidWorks 2000 methodology)

## Workflow Translation

This intermediate-level part involves a vertical pipe, a horizontal cylinder, and a mounting flange. We will build it using standard SolidWorks features: Swept Boss, Extruded Boss, Extruded Cut, and Rib.

### Phase 1: Main Vertical Pipe Path & Profile
1. **New Part**: Open `File > New > Part`. Set units to **MMGS**.
2. **Path Sketch**:
   - Select **Front Plane** in the FeatureManager Design Tree.
   - Click **Sketch**.
   - Draw a vertical line from the Origin upwards, length `80 mm`.
   - Draw a horizontal line from the top of the vertical line to the right, length `100 mm`.
   - Use the **Sketch Fillet** tool to apply a `30 mm` radius at the corner.
   - Click `Exit Sketch`.
3. **Profile Sketch**:
   - Select **Top Plane** and click **Sketch**.
   - Draw a circle centered at the Origin (the start of the path).
   - Use **Smart Dimension** to set the diameter to `50 mm`.
   - Click `Exit Sketch`.
4. **Swept Boss/Base**:
   - Navigate to `Features > Swept Boss/Base`.
   - Profile: Select the circle sketch.
   - Path: Select the L-shaped path sketch.
   - Check **Thin Feature** (One-Direction, e.g., `5 mm` inward thickness) to make it hollow, or apply a Shell feature later. (Assuming solid for now, cut later).
   - Click `OK (✓)`.

### Phase 2: Horizontal Cylinder
1. **Sketch Plane**: Select the **Right Plane** or the end flat face of the swept pipe. Click **Sketch**.
2. **Profile**: Draw a circle with a diameter of `80 mm`.
3. **Extrude Boss/Base**:
   - Go to `Features > Extruded Boss/Base`.
   - Set End Condition to **Mid Plane**, depth `80 mm`.
   - Click `OK (✓)`.
4. **Internal Hole (Extruded Cut)**:
   - Select the outer circular face of the newly created cylinder. Click **Sketch**.
   - Draw a circle with a diameter of `60 mm`.
   - Go to `Features > Extruded Cut`.
   - Set End Condition to **Through All** or depth `70 mm`.
   - Click `OK (✓)`.

### Phase 3: Flange
1. **Base Flange**:
   - Select the bottom face of the vertical pipe. Click **Sketch**.
   - Draw the outer flange profile (e.g., a circle diameter `100 mm`).
   - Go to `Features > Extruded Boss/Base`. Extrude `10 mm` downwards.
2. **Bolt Holes**:
   - Select the top face of the flange. Click **Sketch**.
   - Draw a construction circle of diameter `80 mm`.
   - Draw one `15 mm` diameter hole on this construction circle.
   - Use **Circular Sketch Pattern** to create 3 or 4 instances.
   - Go to `Features > Extruded Cut`, set to **Through All**.

### Phase 4: Rib & Finish
1. **Rib Feature**:
   - Select the **Front Plane**. Click **Sketch**.
   - Draw a diagonal line connecting the vertical and horizontal bodies.
   - Go to `Features > Rib`.
   - Set thickness to `12 mm` (Mid Plane), ensure the material direction arrow points inwards.
   - Click `OK (✓)`.
2. **Fillets & Chamfers**:
   - Apply `1 mm x 45°` Chamfer to outer cylinder edges.
   - Apply `3 mm` Fillets to internal sharp intersections.

---
**SolidWorks UX/UI Compliance Gap Check**:
- *Swept Boss/Base*: Must ensure path and profile inputs are supported in 3D-Builder.
- *Rib Feature*: Check if `geometry_service.py` supports Rib generation.
- *Circular Pattern*: Verify pattern arrays in sketch or feature level.
