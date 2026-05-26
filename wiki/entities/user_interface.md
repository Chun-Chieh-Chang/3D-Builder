# User Interface & Design System Panels

The user interface of **3D-Builder** is structured to resemble SolidWorks, customized with a premium glassmorphism theme ("Sea Salt Blue") designed for highly intensive engineering productivity.

---

## 1. Top Ribbon Command Bar
Located in `src/app/page.tsx`, the top bar is split into dynamic tabs matching standard CAD phases:
- **FEATURES**: Controls for 3D extrusion (`EXTRUDE`), rotation (`REVOLVE`), reference geometries (planes/axes), and feature arrays.
- **SKETCH**: Controls for sketch tool selection (`LINE`, `CENTER_LINE`, `CIRCLE`, `RECTANGLE`, `ARC`, `MIDPOINT_LINE`), dimensions, and reference entities.
- **EVALUATE**: Operations for quality checks, volume/重心 measurements, and step/STL file export.

---

## 2. FeatureManager Design Tree
The left sidebar contains a chronological list of基準面, origin points, and structural feature operations.
- **Parent-Child Highlighting**: When the user hovers over any node in the tree, `getTreeRelation` dynamically highlights parent nodes in Sky Blue (`#3B82F6`) and child nodes in Lavender Purple (`#8B5CF6`) with clean status badges.
- **Sub-sketch Nesting**: Features (such as an extrude block) nest their parent 2D sketches (such as `↳ 草圖1`) directly beneath them. Clicking a nested sketch swaps active inspectors.

---

## 3. PropertyManager Parameter Panels
Replacing the FeatureManager tree when an operation is triggered, the **PropertyManager** is a modal sidebar that guides users through active CAD tasks:
- **SketchPropertyManager (`src/ui/SketchPropertyManager.tsx`)**: Shows details of selected Nodes/Edges. Provides action buttons to apply geometric relations. When relations are selected, it dynamically invokes the PBD `solveConstraints` solver and updates the canvas.
- **RefPlane/RefAxis Inspectors**: Collects selected references (such as three coordinates or cylinder surfaces) and exposes parameters like offsets or cylinder angles.

---

## 4. Contextual HUD Quick-menu
A light-weight overlay menu that pops up when a plane or sketch element is clicked in the viewport.
- **HUD mechanics**: Uses absolute pixel positioning mapping 3D space to DOM coordinates.
- **Event propagation block**: All mouse events (`onPointerDown`, `onClick`, etc.) on the HUD DOM are strictly stopped (`e.stopPropagation()`) from bubbling into the canvas underneath. This ensures OrbitControls do not pan or rotate while clicking HUD menus.
