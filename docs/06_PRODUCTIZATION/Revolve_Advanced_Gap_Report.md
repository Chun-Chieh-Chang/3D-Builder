# Feature Gap Audit Report: Advanced Revolve Options (End Conditions, Thin Feature, Direction 2)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Basic Revolve Examples (Video ID: r6fwmZySSg0)
**Focus**: "Revolve Boss/Base" (旋轉特徵). Demonstrating standard revolve workflows:
- **Blind Revolve**: Rotation by a specific angle.
- **Mid Plane**: Symmetric rotation.
- **Direction 2**: Different angles in two directions.
- **Thin Feature**: Creating a hollow revolved part directly from the profile.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - The `REVOLVE` handler has a disabled "Revolve Type" dropdown fixed to `ONE_DIRECTION`.
    - Lacks options for `MID_PLANE`.
    - Lacks a toggle and parameters for `Direction 2`.
    - Lacks a "Thin Feature" rollout.
- **Backend (`geometry_service.py`)**: 
    - The `REVOLVE` handler (`f_type == 'REVOLVE'`) only reads a single `angle`.
    - Lacks logic to handle bi-directional rotation or symmetric rotation (`MID_PLANE`).
    - Lacks logic for "Thin Revolve" (offsetting the wire/face before or after revolution).

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Enable the "Revolve Type" dropdown with options: `BLIND` and `MID_PLANE`.
- Add a "Direction 2" rollout (similar to Extrude).
- Add a "Thin Feature" rollout (similar to Extrude/Loft) for Revolve.
- Move "Selected Contours" rollout into the Revolve block (already implemented but needs visibility).

### Backend Update (`backend/app/services/geometry_service.py`):
- Read `endCondition`, `hasDirection2`, `angle2`, `isThinFeature`, `thinThickness`.
- **Logic for MID_PLANE**: Perform revolution from `-angle/2` to `angle/2`.
- **Logic for Direction 2**: Perform two revolutions (one positive, one negative) and fuse them.
- **Logic for Thin Feature**: Use `BRepOffsetAPI_MakeOffset` on the 2D wires before revolution to create a hollow profile.

## 4. Priority
- **Status**: High. Revolve is a "tier-1" feature. Bi-directionality and Thin options are standard for professional parts.
