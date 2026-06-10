# Feature Gap Audit Report: Advanced Fillet Types (Variable, Face, Full Round)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Fillet Types 1 (Example 0802-1~3) (Video ID: Q9fIprl-X0s)
**Focus**: Advanced Fillet operations including:
- **Variable Size Fillet**: Different radii at different vertices along the same edge.
- **Face Fillet**: Fillet between two non-adjacent face sets.
- **Full Round Fillet**: Fillet that is tangent to three adjacent faces, replacing the center face.

## 2. Analysis of the Gap
Based on the code audit:
- **UI (`src/ui/PartFeaturePropertyManager.tsx`)**: The Fillet property manager only supports `CONSTANT` radius and a single `SelectionBox` for edges. It lacks selectors for multiple face sets required for Face and Full Round fillets. It also lacks a point-based radius list for Variable fillets.
- **Backend (`backend/app/services/geometry_service.py`)**: 
    - **Face Fillet**: Partially implemented logic exists in the `FILLET` handler but needs verification for multi-face selection.
    - **Full Round Fillet**: Partially implemented logic exists using three face references.
    - **Variable Fillet**: Completely missing. OpenCASCADE's `BRepFilletAPI_MakeFillet.Add(R1, V1, R2, V2, Edge)` is not yet integrated.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Fillet Type" toggle (Constant, Variable, Face, Full Round).
- Implement dynamic selection boxes:
    - `Face Fillet`: Show "Face Set 1" and "Face Set 2" selection boxes.
    - `Full Round`: Show "Side Face 1", "Center Face", and "Side Face 2" selection boxes.
    - `Variable`: Show a list to add points along edges with specific radii.

### Backend Update (`backend/app/services/geometry_service.py`):
- Refine `Face Fillet` logic to handle lists of faces correctly.
- Refine `Full Round Fillet` logic to ensure the center face is fully consumed.
- Implement `Variable Fillet` support by passing vertex-radius pairs to the `fillet_tool`.

## 4. Priority
- **Status**: Critical. Advanced fillets are necessary for ergonomic product design and complex mechanical transitions shown in the tutorial.
