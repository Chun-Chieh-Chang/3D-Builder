# Feature Gap Audit Report: Extrude End Condition - Up To Next

## 1. Context & Source
**Video**: SolidWorks Tutorial: Extrude Up To Next (Video ID: tq0tYpXLIXQ)
**Focus**: "Up To Next" (成型至下一面) end condition. This allows an extrusion to automatically terminate when it hits the first encountered surface of an existing solid, which is crucial for building ribs, bosses, or features that adapt to non-planar or varying geometries.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: The `endCondition` dropdown only contains `BLIND`, `THROUGH_ALL`, and `MID_PLANE`. It is missing `UP_TO_NEXT`.
- **Backend (`geometry_service.py`)**: The `EXTRUDE` logic assumes a fixed `depth` (or `9999` for `THROUGH_ALL`). It lacks a boundary-finding algorithm.
- **Algorithm Challenge**: Implementing "Up To Next" requires:
    1. Extruding the profile by an infinite/large distance.
    2. Finding the first face of the `parent_shape` that intersects the extrusion.
    3. Trimming the extrusion at that exact topological boundary.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add `UP_TO_NEXT` to the `endCondition` and `endCondition2` dropdowns in the Extrude property manager.

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `UP_TO_NEXT` from params.
- **Logic for UP_TO_NEXT**:
    - Extrude a "Probe" solid (temporary prism) along the normal.
    - Use `BOPAlgo_Splitter` or `BRepAlgoAPI_Common` between the Probe and the `parent_shape`.
    - Extract the resulting solid that is adjacent to the start face.
    - (Simplified fallback for now): If `UP_TO_NEXT` is selected, perform a boolean intersection with the existing solid body to define the end cap.

## 4. Priority
- **Status**: High. This is a fundamental parametric modeling capability used in nearly every non-trivial SolidWorks assembly component.
