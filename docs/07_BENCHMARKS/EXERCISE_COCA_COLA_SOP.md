# 3D-Builder Benchmark SOP: Coca-Cola Bottle

**Name**: Coca-Cola Bottle (Exercise ARzX8pPeJiA)
**Goal**: Verify the functionality of Revolve, Swept Cut, Circular Pattern, and Loft.

## Hybrid Verification Protocol: Manual Checklist

Please follow these steps in the 3D-Builder UI to confirm the architectural logic is sound.

### Step 1: Bottle Main Body (Revolve)
1. **Sketch Silhouette**:
   - Select the `Front Plane` in the FeatureManager.
   - Click the `Sketch` button in the Ribbon.
   - Draw a vertical line from the origin (e.g., L=200) to serve as the axis.
   - Draw a profile mimicking the right half of a bottle using `Line` and `Arc/Spline`.
   - Close the sketch.
   - Click `Exit Sketch`.
2. **Revolve Feature**:
   - Go to the `Features` tab in the Ribbon.
   - Click `Revolved Boss/Base`.
   - Select the vertical line as the Axis of Revolution.
   - Set the angle to `360`.
   - Click `✓ OK`.

### Step 2: The Grips (Swept Cut)
1. **Sketch Path**:
   - Select the `Front Plane` again.
   - Sketch a curve following the outer boundary of the middle of the bottle.
   - Click `Exit Sketch`.
2. **Sketch Profile**:
   - Create a new Plane normal to the start of the path curve.
   - Sketch a small semi-circle or ellipse.
   - Click `Exit Sketch`.
3. **Swept Cut Feature**:
   - Click `Swept Boss/Base` in the Ribbon (if `Swept Cut` is missing, check if `SWEEP` supports Cut operation via property manager).
   - Select the small profile and the long curve path.
   - Set Operation to `Cut`.
   - Click `✓ OK`.

### Step 3: Grip Duplication (Circular Pattern)
1. **Circular Pattern**:
   - Click `Circular Pattern` in the Ribbon.
   - Select the central axis of the bottle as the direction.
   - Select the newly created Swept Cut as the feature to pattern.
   - Set instances to `6`.
   - Click `✓ OK`.

### Step 4: Petaloid Base (Loft)
1. **Create Planes**:
   - Create two offset planes below the `Top Plane`.
2. **Sketch Profiles**:
   - On the highest plane, sketch a circle.
   - On the middle plane, sketch a star/petal shape.
   - On the lowest plane, sketch a smaller petal shape.
3. **Lofted Boss/Base**:
   - Click `Lofted Boss/Base` in the Ribbon.
   - **Verification Point**: Ensure you can select multiple sketch profiles in order.
   - Select the three profiles.
   - Click `✓ OK`.

## Success Criteria
- [ ] Revolve successfully generates the organic bottle shape.
- [ ] Sweep can execute a `CUT` operation.
- [ ] Circular Pattern correctly duplicates the complex swept cut around the revolved body.
- [ ] Loft successfully skins the transition between 3 different cross-sections without topological failure.
