# ADR 0247 — Native drill points in Hole Wizard

## Context

Hole Wizard made a flat-bottomed cutter. Feature recognition could identify a blind drill cone from imported geometry, but reconstruction needed a flat hole and an additional revolved cut for every point.

## Decision

Part schema 94 adds the optional angle expression `HoleFeature.drillPointAngle`. An omitted value keeps the flat bottom. Migration from schema 93 preserves existing features and their references, including any revolved cuts previously created by recognition.

The angle is the included angle and applies to blind holes of any Hole Wizard kind. The blind depth measures to the cylindrical shoulder. The apex extends another `radius / tan(angle / 2)` along the drilling direction. The panel offers a 118° starting value when the option is enabled and clears the setting when switching to Through All. The parameter resolver rejects a drill angle on a through hole, an angle outside the open 0–180° interval, and profiles with degenerate or excessive dimensions before native geometry runs.

The cutter uses the existing native revolution and cut path. The tip face has the name `<hole>:side:<sketch>.<point>.tip`. The cylindrical wall, entrance treatment and flat bottom retain their existing naming conventions. The sketch supplies the existing location and direction references. The angle uses the existing expression dependency tracking.

Recognition stores the measured included angle on the reconstructed hole. Its grouping key includes that angle so holes with equal settings share a feature. The existing geometric reconstruction checks still compare the rebuilt solid with the import.
