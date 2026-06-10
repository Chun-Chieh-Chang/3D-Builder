# Feature Gap Audit Report: Revolved Cut (旋轉除料)

## 1. Context & Source
**Video**: SolidWorks Tutorial: Revolved Cut (Example 0115-3) (Video ID: XuWCbMGqsZE)
**Focus**: "Revolved Cut" (旋轉除料). Using a profile and an axis to remove material from an existing solid by revolution.

## 2. Analysis of the Gap
- **UI (`RibbonController.tsx`)**: Missing a dedicated button for "Revolved Cut". Currently only "Revolve Boss/Base" exists.
- **UI (`PartFeaturePropertyManager.tsx`)**: The property manager for `REVOLVE` doesn't explicitly distinguish between Boss and Cut in its header or UI (though the backend supports it via the `operation` parameter).
- **Backend (`geometry_service.py`)**: The `REVOLVE` logic correctly produces a shape, and the `process_features` loop correctly applies `BRepAlgoAPI_Cut` if `op == 'CUT'`. However, `handleRevolveFromSketch` in the frontend doesn't currently support passing an operation override.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/RibbonBar/RibbonController.tsx`):
- Add a "Revolved Cut" button next to "Revolve Boss/Base".
- It should use a red icon (standard for Cut features) and call `handleRevolveFromSketch('CUT')`.

### UI Update (`src/hooks/useFeatureBuilders.ts`):
- Update `handleRevolveFromSketch` to accept an `operationOverride` parameter (`'ADD'` | `'CUT'`).
- Ensure the feature name reflects the operation (e.g., "Revolve Cut" instead of "Revolve").

### UI Update (`src/ui/PartFeaturePropertyManager.tsx`):
- Update the `REVOLVE` block to show a "Cut" vs "Boss" indicator or at least ensure the title matches the feature name.

## 4. Priority
- **Status**: High. Essential for symmetric subtraction operations, very common in engine parts and rotational assemblies.
