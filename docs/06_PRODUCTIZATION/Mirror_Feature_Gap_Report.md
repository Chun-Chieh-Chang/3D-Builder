# Feature Gap Audit Report: Mirror Feature (3D)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Mirror Feature (Example 0112-3) (Video ID: IEcKPlUYpNM)
**Focus**: Mirroring features (Extrude, Cut, etc.) across a plane or planar face.

## 2. Analysis of the Gap
- **UI (`PartFeaturePropertyManager.tsx`)**: The property manager lacks a handler for `selectedFeature.type === 'MIRROR'`. There is no way for the user to select the "Mirror Plane" or the "Features to Mirror".
- **Interaction**: The `RibbonController.tsx` has a Mirror button, but it doesn't lead to a functional property manager.
- **Backend (`geometry_service.py`)**: The `MIRROR` logic exists but is limited to mirroring individual feature shapes and then fusing/cutting. It needs to be verified against multi-feature mirrors and body-mirrors.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Add a dedicated section for `MIRROR` feature type.
- **Mirror Plane Selection**: A `SelectionBox` or `select` dropdown to pick FRONT/TOP/RIGHT planes or a specific face ref.
- **Features to Mirror Selection**: A `SelectionBox` to select multiple target features from the tree.
- **Mirror Body Toggle**: A checkbox to mirror the entire body instead of specific features.

### Backend Update (`backend/app/services/geometry_service.py`):
- Ensure `MIRROR` correctly handles a list of `target_feature_ids`.
- Support mirroring the `final_shape` if no specific features are selected (Body Mirror).

## 4. Priority
- **Status**: High (Mirroring is essential for symmetric parts and common in tutorials).
