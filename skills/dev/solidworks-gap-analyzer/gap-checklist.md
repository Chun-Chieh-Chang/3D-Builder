# SOLIDWORKS Compatibility Gap Database & Checklist

This document tracks implementation status, file paths, and alignment strategies for UI/UX compatibility between 3D-Builder and standard SOLIDWORKS conventions.

---

## 1. Keyboard Shortcuts (快速鍵)

| SolidWorks Feature | Key / Interaction | Current Status | Relevant Files | Priority | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Shortcut Box** | `S` key | ⚠️ Partial | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | High | Opens shortcut toolbar at current cursor. Currently only closes on Esc but listener doesn't open it. |
| **OK / Cancel Corner** | `D` key | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | Medium | Moves confirmation corner closer to the cursor location. |
| **Exit Command** | `Esc` key |  Implemented | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | Critical | Stops active line chain, deselects tools, and exits active dialogs. |
| **Normal To Plane** | `Ctrl + 8` | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | High | Automatically rotates camera to look directly normal to active plane/face. |
| **Isometric View** | `Ctrl + 7` | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | Medium | Smoothly transitions view to standard Isometric position. |
| **Zoom to Fit** | `F` key | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | High | Fits entire model bounding box within current graphics area. |
| **Orientation Selector** | `Spacebar` | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | Low | Pops up the view orientation cube / selector menu. |

---

## 2. Right-Click Context Menus (右鍵快捷選單)

| SolidWorks Feature | Scope | Current Status | Relevant Files | Priority | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Select Pointer** | Sketch Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | Critical | Right-click select options to exit drawing tool and return to pointer. |
| **End Chain** | Sketch Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | Critical | Terminates active Line/Spline segment chain but keeps Line tool active. |
| **Normal To Plane** | Sketch Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | Medium | Align camera normal to the active plane during sketch. |
| **Exit Sketch** | Sketch Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | High | Closes current sketch and commits nodes. |
| **Construction Geometry**| Sketch Mode | ❌ Missing | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | High | Toggles selected lines between solid modeling lines and dashed construction lines. |
| **Edit Sketch / Feature**| 3D Part Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | Critical | Allows right-clicking an item in tree/viewport to edit. |
| **Suppress / Delete** | 3D Part Mode |  Implemented | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | High | Toggle suppression or delete selected features in FeatureManager. |
| **Appearances** | 3D Part Mode | ⚠️ Partial | [ContextMenu.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/ContextMenu.tsx) | Low | Right-click to edit colors or materials. Button exists but lacks popup page. |

---

## 3. Viewport Snapping & Cursor Indicators (草圖鎖點與指示)

| SolidWorks Feature | Mode | Current Status | Relevant Files | Priority | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cursor Badges** | Sketch Mode |  Implemented | [DatumPlanes.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) | High | Shows cursor icon suffix representing active tool (Line, Trim, Dimension, etc.). |
| **Coincident Badge** | Sketch Mode |  Implemented | [DatumPlanes.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) | High | Displays yellow point icon when snapped to a node or origin. |
| **Horizontal / Vertical** | Sketch Mode |  Implemented | [DatumPlanes.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) | High | Displays yellow indicator icons for horizontal (`-`) and vertical (`\|`) constraints. |
| **Tangent Badge** | Sketch Mode | ❌ Missing | [DatumPlanes.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) | Medium | Snap indicator when a line is drawn tangent to a circle. |
| **Inference Lines** | Sketch Mode |  Implemented | [DatumPlanes.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) | High | Displays orange dashed alignment lines tracking X/Y of other nodes. |

---

## 4. UI Elements & Configuration (介面佈局)

| SolidWorks Feature | UI Element | Current Status | Relevant Files | Priority | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Confirmation Corner** | Viewport Top-Right | ❌ Missing | [Viewport.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/renderer/Viewport.tsx) | High | Transparent check/cross buttons at top-right of graphics view to finish/cancel sketch/feature editing. |
| **Design Tree** | Side Panel |  Implemented | [FeatureManagerPanel.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/FeatureManagerPanel.tsx) | Critical | Displays history/tree hierarchy. |
| **PropertyManager** | Left Side panel | ⚠️ Partial | [SketchPropertyManager.tsx](file:///c:/Users/USER/Downloads/3D-Builder/src/ui/SketchPropertyManager.tsx) | High | Panel showing active parameters for Extrude/Revolve/Fillet with check/cross header. |
