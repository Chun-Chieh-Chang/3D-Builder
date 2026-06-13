# Robot Stress Test Model: The Industrial Hinge Link

## Goal
Verify all newly implemented "100% Parity" features in a single modeling session.

## Modeling Plan (The SOP)
1. **Symmetric Base**:
   - Create a Center Rectangle (Symmetry constraint).
   - Use mixed units: Width = `2in`, Height = `50mm + 0.5in`.
   - Extrude `15mm` from Mid Plane.
2. **Drafted Boss**:
   - Create a circle on the top face.
   - Extrude `30mm`.
   - Apply a `5 deg` **Draft** (Draft feature) using the top face as neutral plane.
3. **Up To Next Cut**:
   - Create a sketch on a side plane.
   - Extrude Cut with **Up To Next** end condition to verify boundary detection.
4. **Shelling**:
   - Apply **Shell** with `2mm` thickness, removing the top face of the boss.
5. **Configuration Test**:
   - Create a new configuration "LARGE".
   - Using the **Design Table**, change Width to `4in` and suppression of the Shell feature.
6. **Engineering Drawing**:
   - Enter **DRAWING** mode.
   - Verify HLR (Hidden Line Removal) on all 4 views.
   - Add a **Smart Dimension** to the width.
7. **Physics Interaction**:
   - Enter **ASSEMBLY** mode.
   - Enable **Physics**.
   - Drag the component to verify real-time linkage simulation.

## Verification Method
- **Backend**: `backend/tests/e2e_stress_test_sim.py` (Automated).
- **Frontend**: Manual SOP for the User (Visual).
