# Feature Gap Audit Report: Extrude End Condition - Up To Surface & Offset From Surface

## 1. Context & Source
**Video**: SolidWorks Tutorial: Extrude Up To Surface & Offset From Surface (Video ID: e3OuNWmRTl8)
**Focus**: 
- "Up To Surface" (成型至某一面): Extrusion terminates exactly at a selected model face.
- "Offset From Surface" (成型至離某面平移處): Extrusion terminates at a specified distance from a selected model face.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - The `endCondition` dropdown is missing `UP_TO_SURFACE` and `OFFSET_FROM_SURFACE`.
    - Lacks a `SelectionBox` to select the reference face.
    - Lacks an `Offset` input for the termination distance.
- **Backend (`geometry_service.py`)**: 
    - The `EXTRUDE` logic does not support calculating depth based on a face reference.
    - Needs to calculate the projection distance from the sketch plane to the selected face.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add `UP_TO_SURFACE` and `OFFSET_FROM_SURFACE` to the `endCondition` dropdown.
- When active, show a `SelectionBox` labeled "Reference Face" bound to `selectedFeature.parameters.upToSurfaceRef`.
- When `OFFSET_FROM_SURFACE` is active, show a `ParamInput` for "Offset Distance".

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `upToSurfaceRef` and `offsetDistance` from parameters.
- **Logic for UP_TO_SURFACE**:
    1. Retrieve the origin and normal of the selected face.
    2. Calculate the distance between the sketch plane and the face plane along the extrusion vector.
    3. `depth = (P_face_origin - P_sketch_origin) · D_normal`.
- **Logic for OFFSET_FROM_SURFACE**:
    1. Calculate base depth as above.
    2. Apply `offsetDistance`.
    3. (Advanced): If it's a non-planar surface, use `BRepOffsetAPI_MakeOffset` or similar to create a termination boundary. For now, planar projection is the first priority.

## 4. Priority
- **Status**: High. These are standard end conditions for complex mechanical assemblies.
