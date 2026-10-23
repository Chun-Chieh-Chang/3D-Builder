# OSF sheet-press STEP samples

These are test-only geometry samples downloaded 2026-10-09 from the OSF files listed in the open-access article [Open-source cold and hot scientific sheet press for investigating polymer-based material properties](https://pmc.ncbi.nlm.nih.gov/articles/PMC11647965/), Table 2. The article identifies the CAD files in this project as GNU GPL version 3.0. Keep these files in the test-fixture area and preserve this attribution and license notice; they are not product assets.

| Fixture | OSF file | Article item | SHA-256 |
|---|---|---:|---|
| `mounting-bracket.step` | [v749z](https://osf.io/v749z/) | 9 | `5875faeb8caff27242e92c88ea970706e0da899ebe9572aff1f537e86a51f1b8` |
| `upper-sheet-metal-enclosure.step` | [qbmch](https://osf.io/qbmch/) | 10 | `d4867334b5c179ced4129a0333d6c333cf5bfcbd845f994de609c31c2ce9c972` |
| `upper-sheet-metal-enclosure-flat-pattern.step` | [e6mfj](https://osf.io/e6mfj/) | 11 | `e0655d6c1b35e4921cd296b732957bb0e982b8cd562b32883a4a071bfa93db68` |
| `sheet-press-assembly.step` | [nbxzq](https://osf.io/nbxzq/) | 25 | `334286309490685981929f69e71b4bdf99d23bc5f7ccd65fd4db48e1f823cb51` |
| `astm-d695-mold.step` | [qr4m9](https://osf.io/qr4m9/) | 28 | `52b076fd12633e39796ffad2afc2da2d71eb840399787b6c2e47e943488da4a5` |
| `astm-d638-mold.step` | [ka875](https://osf.io/ka875/) | 29 | `3abc8fdb188a61869b53f1ec26c3dca329849b51a48406d209f96bfded2167d4` |
| `mounting-bracket.sldprt` | [9zy3u](https://osf.io/9zy3u/) | 9 | `1c5c8f29412ba9325378ba8d22e387240f81d6fd870786c7b8faf7fc0f5d60a9` |
| `upper-sheet-metal-enclosure.sldprt` | [5pyu6](https://osf.io/5pyu6/) | 10 | `7633a83aa8d61bcb703ef0493d35d1bd18a25104a6a2495dc3749b6e57d4cc7f` |
| `astm-d695-mold.sldprt` | [becr7](https://osf.io/becr7/) | 28 | `6d68e2c7d1ea29a7e3547f7d0049f3a778c76c26ed1cdd3997ab73ba32c9f9a9` |

The checks exercise external STEP part import, sheet enclosure and flat-pattern geometry, and an external assembly STEP with product hierarchy. Passing these tests demonstrates importer behavior on these samples; it does not establish equivalence to SolidWorks feature history, mass-property settings, or manufacturing acceptance.

Run the automated import and same-kernel STEP round-trip probe for the folded enclosure and its flat-pattern reference with:

```powershell
$env:SHEET_METAL_ACCEPTANCE_REPORT = 'C:\absolute\path\sheet-metal-acceptance.json'
npm test -- tests/phase7/public-sheet-metal-acceptance.test.ts
```

The JSON records the fixture hash, import diagnostics, extracted topology counts, mass properties, and round-trip differences. These are reproducible facts about this repository's importer/exporter. They are not an independent SolidWorks comparison. For that, add a separately generated and reviewed baseline from the paired `.sldprt` file and record its units, sheet thickness, bend radius, K-factor, and export settings.

The corresponding native SolidWorks part files are also included for future feature-tree and model-to-STEP comparison in SolidWorks. Their SHA-256 values are recorded above. The repository does not parse `.sldprt` files.
