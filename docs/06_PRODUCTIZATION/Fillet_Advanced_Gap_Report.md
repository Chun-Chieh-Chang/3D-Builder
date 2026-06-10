# Feature Gap Audit Report: Fillet Advanced Options (Setback & Options)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Constant Fillet 2 (Video ID: njuUaiRvhQs)
**Focus**: 
- **Tangent Propagation Toggle**: Controlling whether fillets extend along tangent edges.
- **Setback Parameters**: Adjusting the transition at vertices where 3 or more filleted edges meet.
- **Fillet Options**: "Keep Features" and "Round Corners".

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - Lacks a checkbox for "Tangent Propagation" (it is currently hardcoded to `true` in the backend but not exposed).
    - Lacks a "Setback Parameters" rollout to select vertices and assign distances.
    - Lacks a "Fillet Options" rollout for "Keep Features" and "Round Corners".
- **Backend (`geometry_service.py`)**: 
    - Does not support `SetSetback` on the `BRepFilletAPI_MakeFillet` tool.
    - Does not support "Keep Features" (Boolean persistence during fillet).

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a "Tangent Propagation" checkbox in the Fillet Parameters rollout.
- Add a "Setback Parameters" rollout.
    - `SelectionBox` for vertices.
    - Distance input for the selected vertex setback.
- Add a "Fillet Options" rollout with toggles for "Keep Features" and "Round Corners".

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `setbackVertices` and `keepFeatures` from params.
- **Logic for Setback**: Call `fillet_tool.SetSetback(vertex, distance)` for each defined vertex.
- **Logic for Keep Features**: Implement a post-fillet boolean check or use the standard `BRepFilletAPI` flags if applicable.

## 4. Priority
- **Status**: Medium. These are "finishing" features that improve model aesthetics and robustness in complex corners.
