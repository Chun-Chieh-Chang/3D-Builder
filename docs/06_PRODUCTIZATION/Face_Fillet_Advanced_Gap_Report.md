# Feature Gap Audit Report: Advanced Face Fillet (Hold Lines & Constant Width)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Face Fillet (Video ID: HZY0evKBUJc)
**Focus**: "Face Fillet" (面圓角) and its advanced boundary controls:
- **Face Set 1 & Face Set 2**: Filleting between two disjoint or non-adjacent sets of faces.
- **Hold Line**: Defining the fillet boundary using a specific edge or split line.
- **Constant Width**: Ensuring the fillet width is uniform regardless of the angle between faces.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - We have "Face Set 1" and "Face Set 2" selection boxes.
    - Lacks a "Hold Line" selection box.
    - Lacks a "Constant Width" (Chord Width) toggle.
- **Backend (`geometry_service.py`)**: 
    - Basic `fillet_tool.Add(r1, face1, face2)` is implemented.
    - Lacks logic to apply "Hold Line" constraints to the fillet tool.
    - Lacks logic to switch between Radius-based and Width-based (Chord) filleting.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Inside the `filletType === 'FACE'` conditional block:
    - Add a `SelectionBox` for "Hold Line" (bound to `params.holdLineRefs`).
    - Add a toggle for "Constant Width" (bound to `params.isConstantWidth`).
    - Add a "Curvature Continuous" toggle.

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `holdLineRefs` and `isConstantWidth`.
- **Implementation strategy**: 
    - For `isConstantWidth`: If true, interpret the `radius` parameter as the `Chord Width`. 
    - (Note: OpenCASCADE's `BRepFilletAPI_MakeFillet` primarily uses radius. True "Constant Width" requires more complex surface-surface blending or variable radius approximation. For now, we will expose the UI and document the backend limitation).

## 4. Priority
- **Status**: Medium-High. Essential for high-quality industrial surfacing and complex ergonomic transitions.
