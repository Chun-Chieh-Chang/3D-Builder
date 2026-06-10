# Feature Gap Audit Report: Fillet Types (Variable, Face, Full Round)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Fillet Types 1 (Example 0802-1~3) (Video ID: Q9fIprl-X0s)
**Focus**: Demonstrating the four standard fillet types in SolidWorks:
1. Constant Size Fillet (Implemented - Basic)
2. Variable Size Fillet (Missing)
3. Face Fillet (Missing)
4. Full Round Fillet (Missing)

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: The Fillet property manager only provides a single "Radius" input and an "Edges to Fillet" selection box. There is no radio-button or icon-button set to switch between the four Fillet Types.
- **Variable Fillet**: Lacks UI to define multiple points along an edge with different radii.
- **Face Fillet**: Lacks UI to select two sets of faces instead of edges.
- **Full Round Fillet**: Lacks UI to select three sets of adjacent faces.
- **Backend (`geometry_service.py`)**: The `FILLET` logic currently only supports `BRepFilletAPI_MakeFillet.Add(r1, edge)` or `Add(r1, r2, edge)`. It does not handle `Add(r_start, r_end, edge)` with multiple interpolation points or face-face fillet algorithms.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Fillet Type" button group at the top of the Fillet rollout with icons for:
  - Constant
  - Variable
  - Face
  - Full Round
- **Dynamic Inputs**:
  - For **Variable**: Show a list of points/radii.
  - For **Face Fillet**: Change "Items to Fillet" to two `SelectionBox` components ("Face Set 1", "Face Set 2").
  - For **Full Round**: Change "Items to Fillet" to three `SelectionBox` components ("Side Face Set 1", "Center Face Set", "Side Face Set 2").

### Backend Update (`backend/app/services/geometry_service.py`):
- Update `FILLET` handler to check `params.get('filletType', 'CONSTANT')`.
- **Logic for FACE_FILLET**: Use `fillet_tool.Add(r1, face1, face2)`.
- **Logic for FULL_ROUND**: Use `fillet_tool.Add(face1, face2, face3)`.

## 4. Priority
- **Status**: Medium-High (Essential for industrial design and complex ergonomic shapes).
