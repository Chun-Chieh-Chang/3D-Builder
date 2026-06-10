# Feature Gap Audit Report: Extrude End Condition - Up To Vertex

## 1. Context & Source
**Video**: SolidWorks Tutorial: Extrude Up To Vertex (Video ID: 92pdQxriubk)
**Focus**: "Up To Vertex" (成型至一頂點) end condition. This allows an extrusion to terminate at a plane that passes through a selected vertex and is parallel to the sketch plane.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - The `endCondition` dropdown is missing `UP_TO_VERTEX`.
    - Lacks a `SelectionBox` to select the reference vertex.
- **Backend (`geometry_service.py`)**: 
    - The `EXTRUDE` logic does not support calculating depth based on a vertex reference.
    - Needs to project the selected vertex onto the extrusion normal to find the required distance from the sketch plane.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add `UP_TO_VERTEX` to the `endCondition` dropdown.
- When `UP_TO_VERTEX` is selected, show a `SelectionBox` labeled "Reference Vertex" bound to `selectedFeature.parameters.upToVertexRef`.

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `upToVertexRef` from parameters.
- **Logic for UP_TO_VERTEX**:
    1. Retrieve the 3D coordinates of the selected vertex.
    2. Define the extrusion direction vector `D`.
    3. Define a point `P_origin` on the sketch plane.
    4. The required depth `depth = (P_vertex - P_origin) · D` (dot product).
    5. Use this calculated depth for the extrusion.

## 4. Priority
- **Status**: High. Essential for maintaining design intent where features must align with specific model points.
