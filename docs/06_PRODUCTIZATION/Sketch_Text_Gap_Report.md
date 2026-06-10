# Feature Gap Audit Report: Sketch Text & Single Line (Stick) Fonts

## 1. Context & Source
**Video**: [SolidWorks教學] 同學提問篇!! 老師,CNC用的單線字體該怎麼做? (Video ID: hIf4Q7qq08c)
**Focus**: "Sketch Text" (草圖文字) and "Stick Fonts" (單線字體). Essential for CNC engraving and part marking where a single tool path is preferred over an outline-based extrusion.

## 2. Analysis of the Gap
- **UI (`SketchTool` / `HeadsUpToolbar`)**: 
    - The system completely lacks a `TEXT` tool in Sketch mode.
    - No UI to enter text, select fonts, or set text height/alignment.
- **Backend (`geometry_service.py`)**: 
    - No handler for `SKETCH_TEXT` entities.
    - Lacks integration with font-to-geometry libraries (e.g., freetype-py or OCCT's internal `Font_BRepFont`).
- **Functionality**: Users cannot add text to their models, which is a standard requirement for industrial part numbering and branding.

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/RibbonBar/RibbonController.tsx` & `src/store/useCadStore.ts`):
- Add a "Text" button to the Sketch tab.
- Implement a `TextTool` in the sketch engine.
- Update `SketchPropertyManager.tsx` to handle text input, font choice (limited set), and height.

### Backend Update (`backend/app/services/geometry_service.py`):
- Implement `SKETCH_TEXT` geometric construction.
- Integrate `OCC.Core.Font` and `OCC.Core.BRepFont` to convert text strings into `TopoDS_Wire` or `TopoDS_Compound`.
- Support "Stick Fonts" by mapping specific CNC-friendly fonts (e.g., OLF Fonts) if available, or providing a "Single Line" toggle that uses center-line extraction.

## 4. Priority
- **Status**: High. Essential for product labeling, CNC manufacturing, and professional CAD workflows shown in the user's requested tutorial.
