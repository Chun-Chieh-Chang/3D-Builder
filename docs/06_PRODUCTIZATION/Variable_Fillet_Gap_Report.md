# Feature Gap Audit Report: Variable Size Fillet Enhancements

## 1. Context & Source
**Video**: SolidWorks Tutorial: Variable Fillet (Video ID: AIVDFBfG4s4)
**Focus**: "Variable Size Fillet" (變化大小圓角). The ability to set different radii at different points along an edge.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - Currently only shows two points (P1, P2) for start and end.
    - Lacks a way to add intermediate control points (Number of Instances).
    - Lacks a toggle for "Smooth Transition" vs "Straight Transition".
- **Backend (`geometry_service.py`)**: 
    - The `VARIABLE` logic only handles the first and last vertex of the edge.
    - Intermediate points are ignored.
    - Transition type is not implemented.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Number of Control Points" numeric input.
- Dynamically generate the `variablePoints` array based on this count.
- Add a "Transition Type" toggle: `SMOOTH` vs `STRAIGHT`.

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `transitionType` from parameters.
- Read all `variablePoints`.
- **Logic for intermediate points**:
    - OpenCASCADE's `BRepFilletAPI_MakeFillet` supports `Add(R1, V1, R2, V2, Edge)`. For intermediate points, it usually requires a `ChLaw` or custom law. 
    - For the current prototype, we will focus on supporting the UI representation and ensuring the start/end variable radii are robustly handled with the requested transition type (using OpenCASCADE's default smooth interpolation).

## 4. Priority
- **Status**: Medium. Highly useful for advanced industrial design but secondary to core prismatic modeling.
