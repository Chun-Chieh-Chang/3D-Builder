# Automated acceptance evidence

This project keeps two kinds of evidence separate:

| Verification need | Agent-run evidence | Remaining independent input |
|---|---|---|
| Public STEP samples and sheet-metal geometry | `npm run verify:external-samples`; SHA-256, import diagnostics, topology, mass properties, folded/flat volume and STEP round trip | A reviewed external CAD baseline only when equivalence with that CAD is required |
| PDF and DXF output | `tests/phase5/drawing-output.test.ts`, `tests/e2e/phase5-output.js`, and `npm run verify:drawing-export` (FreeCAD DXF import & Chromium PDF rendering) | A different CAD/PDF consumer if a named third-party compatibility target is required |
| UI commands and visual state | `npm run verify:ui` replays the workflows and checks application state, downloads and browser errors | Physical-device ergonomics and accessibility testing when those are requirements |
| Native SolidWorks feature history and analysis | None: `.sldprt` is not parsed by this repository | A reviewed SolidWorks export or a machine-readable measurement baseline with units and settings |
| Company standards and drafting wording | Parameterized tests can enforce a supplied table | The approved table, tolerance policy and terminology |

## External drawing export probe (DXF & PDF)

Run:

```powershell
npm run verify:drawing-export
```

To retain the evidence as JSON, choose an absolute output path:

```powershell
$env:DRAWING_ACCEPTANCE_REPORT = 'D:\reports\drawing-acceptance.json'
npm run verify:drawing-export
```

Optionally override the FreeCAD executable or Chromium binary:

```powershell
$env:FREECAD_CMD = 'C:\Program Files\FreeCAD 26.3\bin\FreeCADCmd.exe'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run verify:drawing-export
```

This probe establishes verifiable external consumer facts for representative production drawings (`凸緣襯套加工圖` and `壓花旋鈕銷加工圖`):
- **FreeCAD DXF Import**: runs FreeCAD command-line to import the generated DXF, verifying that FreeCAD creates 100+ native geometry objects, preserves required ISO layers (`VISIBLE`, `HIDDEN`, `CENTER`, `THIN`, `FRAME`, `DIMENSION`, `TEXT`), and validates that the drawing boundary geometry adheres strictly to ISO A3 margin boundaries (`20..410 mm` along X, `10..287 mm` along Y).
- **Chromium PDF Rendering**: runs headless Chromium via Chrome DevTools Protocol (CDP) to load the generated PDF in the built-in PDF reader, confirming `contentType === 'application/pdf'` and non-empty rendering without renderer crash.

## External sheet-metal probe

Run:

```powershell
npm run verify:external-samples
```

To retain the evidence as JSON, choose an absolute output path:

```powershell
$env:SHEET_METAL_ACCEPTANCE_REPORT = 'D:\reports\sheet-metal-acceptance.json'
npm run verify:external-samples
```

The report is deliberately limited to facts the agent can establish: fixture identity, importer diagnostics, topology counts, mass properties and STEP round-trip differences. It does not assert SolidWorks equivalence or manufacturing acceptability.

### FreeCAD command-line check

When FreeCAD is installed, an agent can also check that application reads the same two public STEP files:

```powershell
$env:FREECAD_CMD = 'C:\Program Files\FreeCAD 26.3\bin\FreeCADCmd.exe'
$env:FREECAD_ACCEPTANCE_REPORT = 'D:\reports\freecad-sheet-metal-acceptance.json'
npm run verify:freecad-sheet-metal
```

This command requires an absolute executable path and writes an absolute JSON report. It checks that both files load to solids with positive volume, then compares their material volumes. FreeCAD currently uses OCCT too, so this is an external-application import check rather than independent-kernel validation.

## Adding an independent baseline

Add the source file hash and the following metadata beside any baseline before writing a comparison assertion:

- exporting application and version;
- source units, sheet thickness, bend radius and K-factor;
- export settings;
- measured dimensions or a separately exported neutral format;
- reviewer and review date.

Tests must fail on a missing baseline. They must not substitute a zero value or derive their expected result from the same implementation being tested.
