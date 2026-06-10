# SolidWorks Exercise: Coca-Cola Bottle - Expert Step-by-Step Guide

**Source**: [YouTube: SolidWorks Tutorial Coca Cola Bottle](https://www.youtube.com/watch?v=ARzX8pPeJiA)
**Author**: SolidWorks Expert Subagent
**Target Application**: 3D-Builder (SolidWorks 2000 methodology)

## Workflow Translation

Creating a Coca-Cola bottle is a classic advanced modeling exercise that combines Revolve, Swept Cut, Circular Pattern, and Loft.

### Phase 1: The Main Body (Revolved Boss/Base)
1. **New Part**: Open `File > New > Part`. Set units to **MMGS**.
2. **Sketch Profile**:
   - Select the **Front Plane** in the FeatureManager Design Tree.
   - Click **Sketch**.
   - Draw a vertical **Centerline** starting from the Origin upwards. This will be the axis of revolution.
   - Use the **Line** and **Spline** tools to sketch the right half of the bottle's silhouette (the neck opening, curved main body, and flat base).
   - Ensure the sketch is closed by connecting the top and bottom endpoints to the centerline.
   - Click `Exit Sketch`.
3. **Revolve Feature**:
   - Navigate to `Features > Revolved Boss/Base`.
   - The centerline should be automatically selected as the Axis of Revolution.
   - Set the angle to `360°`.
   - Click `OK (✓)`.

### Phase 2: The Iconic Grips (Swept Cut & Circular Pattern)
1. **Path Sketch**:
   - Select the **Front Plane** and click **Sketch**.
   - Sketch an Arc or Spline following the contour of the bottle's midsection where the vertical flute/grip will be.
   - Click `Exit Sketch`.
2. **Profile Sketch**:
   - Create a Reference Plane perpendicular to the start point of the path.
   - On this new plane, sketch a small arc or ellipse representing the cross-section of the flute cut.
   - Click `Exit Sketch`.
3. **Swept Cut**:
   - Go to `Features > Swept Cut`.
   - Profile: Select the small arc sketch.
   - Path: Select the contour spline sketch.
   - Click `OK (✓)`.
4. **Circular Pattern**:
   - Go to `Features > Circular Pattern`.
   - Direction/Axis: Select the central vertical axis of the bottle (or a circular edge on the neck).
   - Features to Pattern: Select the Swept Cut.
   - Set Number of Instances to `6` (or desired number).
   - Check `Equal Spacing`.
   - Click `OK (✓)`.

### Phase 3: The Complex Petaloid Base (Lofted Boss/Base)
1. **Reference Planes**:
   - Create a series of horizontal reference planes (e.g., Plane 1, Plane 2, Plane 3) offset from the Top Plane downwards to construct the petal feet.
2. **Loft Profiles**:
   - On Plane 1 (Top of the base), sketch a circle matching the body diameter.
   - On Plane 2 (Middle of the base), sketch the "star" or "petal" pattern using arcs.
   - On Plane 3 (Bottom), sketch a smaller petal profile.
3. **Lofted Boss/Base**:
   - Go to `Features > Lofted Boss/Base`.
   - Select the profiles in order (Plane 1 -> Plane 2 -> Plane 3).
   - Ensure the connectors are aligned to prevent twisting.
   - Click `OK (✓)`.

### Phase 4: Finishing
1. **Shell Feature**:
   - Select the top flat face of the bottle neck.
   - Go to `Features > Shell`.
   - Set thickness to `1 mm` to hollow out the bottle.
   - Click `OK (✓)`.
2. **Fillets**:
   - Apply `Fillet` to the sharp edges of the swept cuts and the petaloid base.

---
**SolidWorks UX/UI Compliance Gap Check**:
- *Swept Cut*: Need to ensure the backend `SWEEP` operation supports `operation: 'CUT'`.
- *Circular Pattern*: Verify pattern arrays on complex swept cuts.
- *Loft*: Backend has `LOFT` via `BRepOffsetAPI_ThruSections`, verify multi-profile inputs.
- *Shell*: Ensure `SHELL` API or equivalent workaround is available.
