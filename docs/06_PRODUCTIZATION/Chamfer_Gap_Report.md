# Feature Gap Audit Report: Advanced Chamfer Types (Angle-Distance & Distance-Distance)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Chamfer (Video ID: 7OmSaYCYBhw)
**Focus**: "Chamfer" (倒角). Standard types in SolidWorks:
1. **Angle Distance** (Default)
2. **Distance Distance** (Equal or unequal)
3. **Vertex**
4. **Offset Face**
5. **Face-Face**

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: 
    - Chamfer currently shares the UI with Fillet.
    - It only supports a single `distance` parameter.
    - Lacks a "Chamfer Type" selector.
    - Lacks an `angle` input for Angle-Distance.
    - Lacks a `distance2` input for unequal Distance-Distance.
- **Backend (`geometry_service.py`)**: 
    - The `CHAMFER` handler only supports `chamfer_tool.Add(distance, matched_edge)`.
    - It does not support `Add(distance, angle, edge)` or `Add(dist1, dist2, edge)`.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Separate Chamfer UI from Fillet UI.
- Add a "Chamfer Type" toggle (Angle-Distance, Distance-Distance).
- For **Angle-Distance**: Show `Distance` and `Angle` (default 45 deg) inputs.
- For **Distance-Distance**: Show `Distance 1` and `Distance 2` inputs, with an "Equal Distance" checkbox.

### Backend Update (`backend/app/services/geometry_service.py`):
- Update `CHAMFER` handler to check `params.get('chamferType', 'ANGLE_DISTANCE')`.
- **Logic for ANGLE_DISTANCE**: Call `chamfer_tool.Add(distance, angle_rad, edge, face)` where `face` is a reference face to define the angle direction.
- **Logic for DISTANCE_DISTANCE**: Call `chamfer_tool.Add(dist1, dist2, edge, face)`.

## 4. Priority
- **Status**: High. Chamfers are fundamental mechanical finishing features used in almost every machined part.
