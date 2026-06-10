# 3D-Builder Benchmark SOP: Exercise A84 - Pipe and Flange

**Name**: Exercise A84 Pipe and Flange
**Goal**: Verify the functionality of Sketching, Swept Boss, Extruded Cut, Circular Pattern, and Rib.

## Hybrid Verification Protocol: Manual Checklist

Please follow these steps in the 3D-Builder UI to confirm the architectural logic is sound.

### Step 1: Main Vertical Pipe Profile and Path
1. **Sketch Path**: 
   - Select the `Front Plane` in the FeatureManager.
   - Click the `Sketch` button in the Ribbon.
   - Draw a vertical line from the origin (L=80) and horizontal line (L=100).
   - Apply a `Sketch Fillet` of R=30 at the corner.
   - Click `Exit Sketch`.
2. **Sketch Profile**:
   - Select the `Top Plane` in the FeatureManager.
   - Click the `Sketch` button in the Ribbon.
   - Draw a circle with D=50 at the origin.
   - Click `Exit Sketch`.
3. **Swept Boss/Base**:
   - Go to `Features` tab in the Ribbon.
   - Click `Swept Boss/Base`.
   - **Verification Point**: Ensure there is a UI prompt to select a `Profile` and a `Path`.
   - Select the Circle sketch as the Profile and the L-shape sketch as the Path.
   - Ensure `Thin Feature` is checked (if available) to make it hollow, otherwise assume solid.
   - Click `✓ OK`.

### Step 2: Horizontal Cylinder and Cut
1. **Extrude Cylinder**:
   - Select the Right Plane or the flat end of the Sweep.
   - Click `Sketch` and draw a D=80 circle.
   - Click `Extruded Boss/Base` in the Ribbon.
   - Set to `Mid Plane` with Depth `80`.
   - Click `✓ OK`.
2. **Internal Cut**:
   - Select the face of the cylinder. Click `Sketch` and draw D=60 circle.
   - Click `Extruded Cut` in the Ribbon.
   - Set End Condition to `Through All`.
   - Click `✓ OK`.

### Step 3: Base Flange and Pattern
1. **Extrude Flange**:
   - Select the bottom flat face of the Sweep pipe.
   - Click `Sketch`, draw a D=100 circle.
   - Click `Extruded Boss/Base`, depth `10` down.
   - Click `✓ OK`.
2. **Bolt Holes & Pattern**:
   - Select top of the flange, draw a D=15 circle on a D=80 bolt circle.
   - Extrude Cut `Through All`.
   - **Verification Point**: Check if `Circular Pattern` is available in the Ribbon. If yes, pattern the cut 4 times.

### Step 4: Rib Feature
1. **Sketch Rib**:
   - Select `Front Plane`. Click `Sketch`.
   - Draw a diagonal line connecting the sweep and cylinder.
2. **Apply Rib**:
   - Go to `Features` tab. Click `Rib`.
   - **Verification Point**: Ensure `Rib` is available in the Ribbon (if not, use Extrude Mid-Plane as a workaround).
   - Set thickness to 12.
   - Click `✓ OK`.

### Step 5: Finishing
- Use `Fillet` and `Chamfer` to finish sharp edges.

## Success Criteria
- [ ] Sweep path and profile selection works without crashing.
- [ ] Extrude Mid-Plane correctly expands equally.
- [ ] The Rib (or Extrude workaround) merges properly with the curved cylinder faces.
