# External DXF samples (bjnortier/dxf)

Test-only DXF files downloaded 2026-10-29 from the test resources of the open-source JavaScript DXF parser [bjnortier/dxf](https://github.com/bjnortier/dxf), commit `cb571d1d7631dd0daaf923a256d75ef0917ff806`, folder `test/resources`. That project is MIT-licensed (`LICENSE.txt` here, copyright Ben Nortier). Keep the license and this attribution with the files; they are not product assets.

They were saved by other CAD programs, not by 3D-Builder: the files that begin with a `999` comment name the writer (`dxfrw` is LibreCAD's DXF library, `dxflib` QCAD's); the others carry no writer's comment and are AutoCAD-format files (AC1018 and AC1032 with the `ACDSDATA` section AutoCAD 2013 and later write). They check the sketch import of ADR 0219 in `tests/phase5/dxf-import-external.test.ts` and `tests/phase5/dxf-import-solid.test.ts`.

| Fixture | `$ACADVER` | Writer | What it checks | SHA-256 |
|---|---|---|---|---|
| `issue42.dxf` | AC1009 (R12) | — | R12, no units, dimensions left out; extents | `24ca55104af8e7d42cd236643bf79851636756faf1e8c7f83d216eeaeca20964` |
| `supported_entities.dxf` | AC1015 (2000) | dxflib 3.12.2.0 | a leading `999` comment; many kinds of entity | `8601dfdfa258445a9347b873403d4bda489f26340899baad5ba1caaad1d860d9` |
| `issue27b.dxf` | AC1018 (2004) | — | 214 splines; extents | `d6c18a060529926a877b06d4a2feb82a55fb5b2f26304f3ee368746b6b0695ee` |
| `issue21.dxf` | AC1021 (2007) | dxfrw 0.6.3 | closed polylines with positive and negative bulges, extruded | `756b5a3901e6a77d74793d7ef0eb4d609d299a1beedf60c1658b4375fea8e92a` |
| `blocks1.dxf` | AC1021 | dxfrw 0.6.1 | blocks; extents | `ba33677808f6a534d64a5898803649caca30eccb543092e3e5a102043b9d1c2e` |
| `arrayed-holes.dxf` | AC1021 | dxfrw 0.6.3 | arrayed INSERTs, inches; extents | `29856a0eb2b8412527bef8be612200662ea5bb80fadc8decec1eccf79b8ec058` |
| `arc15.dxf` | AC1021 | dxfrw 0.6.3 | one ARC, against the DXF reference | `2e46b1fc5925d916ef25eb0df8301d2f75aa0f720c2204336c27ebd1fbe2d891` |
| `elliptical-arc7.dxf` | AC1021 | dxfrw 0.6.3 | a part of an ellipse, approximated | `9f40190864797ed6e9151fb7b7dfff777af0082536e0bf9d93639a19182953fa` |
| `elliptical-arc11.dxf` | AC1021 | dxfrw 0.6.3 | an ELLIPSE that is a circle's arc | `f36768b851f3c01430f0489e9f05cbb553a6442ea397269c7cd70833a71a9806` |
| `testModelPaperSpace.dxf` | AC1032 (2018) | — | `ACDSDATA`; paper space left out; two zero-length lines reported | `c150ba46518b553d2fec08d1680ff6a66862f6708753946b8454c82bcadf417c` |
| `alu-profile.dxf` | AC1032 (2018) | — | a real profile drawing with dimensions and hatches | `b73d4a5671d7d2bdad16f89fa21413f4f89cbd42673f54af97332041fd8e7e8c` |

`.gitattributes` keeps the bytes as they were downloaded (some use CRLF, some LF), so the hashes hold on every checkout.

What the tests compare against is independent of the importer: the extents `$EXTMIN`/`$EXTMAX` the writing program recorded (only for the files whose writer recorded tight ones: LibreCAD wrote placeholders such as 1e+20 or loose extents in others, which is why those are not used), the DXF reference evaluated on an entity's own groups, and areas worked out from the raw polyline vertices and bulges. Passing them shows the importer reads these files; it does not certify every DXF any program writes.
