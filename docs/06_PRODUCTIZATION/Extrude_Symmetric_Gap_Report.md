# Feature Gap Audit Report: Extrude Symmetric & Two Directions

## 1. Context & Source
**Video**: SolidWorks Tutorial: Extrude Symmetric Through All and Two Directions (Video ID: TO7suxvGIN4)
**Focus**: Extrude Feature with "Symmetric" (Mid Plane), "Through All" (Both ways), and "Two Directions".

## 2. Analysis of the Gap
Based on the manual code audit and `check_sw_gaps.py`:
- **UI (PartFeaturePropertyManager.tsx)**: The Extrude property manager only provides a dropdown for `End Condition` with values `BLIND` and `THROUGH_ALL`. It lacks the `MID_PLANE` condition and lacks a rollout/toggle for `Direction 2`.
- **Backend (geometry_service.py)**: The `EXTRUDE` logic (`f_type == 'EXTRUDE'`) uses a single vector `vec = gp_Vec(normal_dir.X() * mag, ...)` and a single `depth`. It does not support bidirectionality or splitting the extrusion vector for a mid-plane setup.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add `MID_PLANE` to the `endCondition` select options.
- Add a new "Direction 2" checkbox. When active, display another `End Condition` dropdown (Blind / Through All) and a `Depth` input specifically for `Direction 2`.

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `endCondition`, `endCondition2`, `depth`, `depth2`, `hasDirection2`.
- **Logic for MID_PLANE**: 
  - Change the `mag` to `depth / 2.0`.
  - Shift the starting wire/face backward by `-depth / 2.0` along the normal, then extrude forward by `depth`.
- **Logic for Direction 2**:
  - If `hasDirection2` is true, perform a second extrusion on the face but in the reverse normal direction (with `depth2`).
  - Then use Boolean Union (`BRepAlgoAPI_Fuse`) to combine the two extrusions (Direction 1 and Direction 2).

## 4. Priority
- **Status**: Critical (Core feature gap preventing successful recreation of the benchmark).
