# ADR 0264: DWG conversion and editable detached 2D drawings

Status: Implemented, validation in progress (2026-11-23).

## Decision

Use external LibreDWG **0.14.9228** as a separate executable process. The desktop shell calls a narrow, bundled Node entry point over stdin/stdout; the MCP server uses the same conversion adapter. No shell evaluates filenames or user payloads. Conversion has a 60-second limit per process, isolated temporary directories, 64 MiB input limits and cleanup in `finally`. Export is **R2018 / AC1032** so Unicode and exact RGB survive. Every export reads the actual binary DWG back and compares geometry, dimension definitions and blocks, text, colors, lineweights and layer linetype patterns before offering/writing it. No artifact is accepted solely because an encoder returned exit code zero.

The app provides **檔案 → 安裝 DWG 引擎**, **匯入 DWG／DXF 工程圖…**, and **輸出 DWG**. The installer downloads a fixed official Windows archive and verifies SHA-256 `956d6ec5ac9333e0cbb7e08491b0b77f9b7a419ee7437a134d0be450b9267642`. It installs per user in `%LOCALAPPDATA%/3D-Builder/converters/libredwg`, retaining upstream notices. A separately installed engine can instead be selected with absolute `THREEDB_DWG_CONVERTER`, or located on PATH. An explicitly broken configuration never silently falls back. Linux/macOS use an independently installed compatible engine. Development setup: `npm run setup:dwg`; real-file acceptance: `npm run verify:dwg`.

Upstream sources: [official release](https://github.com/LibreDWG/libredwg/releases/tag/0.14.9228), [source](https://github.com/LibreDWG/libredwg/tree/0.14.9228). The engine is not redistributed in the application installer. The indexed color table is from [dxf-parser](https://github.com/gdsestimating/dxf-parser/blob/master/src/AutoCadColorIndex.ts), with its MIT notice shipped under `public/licenses` and retained in the source.

## Editable imported data

Drawing schema **44** adds a dedicated `DrawingPage.cad` representation, separate from model-derived views. It records 2D polylines, filled polygons, text, native dimension definitions and cached graphics, layer names/colors/lineweights/dashes/visibility, and original coordinate offset. Each layout is a separate page (maximum 64). The editor supports selection, dragging, text and dimension text overrides, line vertices, RGB or ByLayer colors, layer color/visibility/width, deletion, undo/redo, and .3dbd save/reopen. DXF/DWG preserve original coordinate placement; paper display is translated to a bounded, visible sheet. Hidden layer contents remain in CAD output.

MCP `drawing_open` accepts DWG/DXF and imported .3dbd without a 3D part. `drawing_inspect` lists editable entities, and `drawing_apply` accepts `setCadEntity`, `setCadDrawing`, `deleteCadEntities`. An import starts unsaved; `drawing_save` chooses its .3dbd. `drawing_export` adds `format: "dwg"`, one file per page. Native model-based drawing workflows retain their existing responses and release checks. Detached imports cannot claim model-based manufacturing certification or use `release: true`.

The existing DXF writer also now writes explicit RGB (group 420 in AC1021) and emits a rotated dimension's group 50 **after** `AcDbRotatedDimension`. The previous placement was interpreted as an aligned dimension's oblique angle by the external engine: vertical dimensions had cached graphics but incorrect regeneration parameters.

## Supported scope and explicit limitations

- DWG conversion is available in the desktop app and MCP. Browser-only deployments import DXF, edit/save imported .3dbd, and export DXF/PDF/SVG. They do not have an executable converter.
- Millimetre planar LINE, straight LWPOLYLINE, SOLID/TRACE, ordinary TEXT, supported linear/radius/diameter/two-line angular DIMENSION, and nested positive uniformly scaled INSERT blocks. Dimensions inside transformed INSERTs are refused. Cycles, excessive expansion, non-planar geometry, nonuniform/mirrored inserts, arrays, bulged polylines, unsupported dimension types, rich text (MTEXT), splines, hatches, proxy entities and other unsupported content **refuse the whole import with reasons**. No silent partial drawing is presented as complete.
- ARC/CIRCLE become editable polylines with maximum chord error 0.001 mm, explicitly reported at import. They are not native arc/circle objects after import. The original DWG remains untouched.
- Units other than millimetres must be converted in the source CAD first. Unitless inputs explicitly report the millimetre interpretation.
- Imported dimensions are detached 2D dimensions, not reconstructed 3D model references. The label editor changes the text override. Cached geometry and definition points are retained; re-export uses the app's standard CAD font/dimension style, explicitly reported at import. SHX/rich formatting/custom CAD style fidelity is not certified.
- An external consumer such as the user's AutoCAD must still adjudicate its own rendering/regeneration behavior. A LibreDWG read-back check is not independent AutoCAD certification.

## Red-team evidence

The old stable LibreDWG 0.14 returned exit 0 and a binary header, while its read-back exposed **zero** model-space entities. The supported pinned release and a nonempty/content comparison prevent shipping that result. Tests deliberately remove geometry, change RGB, rotate dimensions, introduce unsupported entities/NaN/invalid widths/colors, and corrupt persisted data. A deterministic 150-case fuzz loop traverses actual DXF parsing, editable model serialization, reopening, and coordinate/color-preserving output. The real-file acceptance uses the existing locating-plate model, not hardcoded fake CAD output; it converts, reads back, imports, edits Chinese/RGB, saves/reopens, and produces another DWG.
