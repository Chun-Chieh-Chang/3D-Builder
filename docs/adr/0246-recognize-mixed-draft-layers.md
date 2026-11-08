# ADR 0246 — Recognize separate drafts in one extrusion layer

**Date** 2026-11-08

Feature recognition used one draft per height interval. A single imported solid can have two bosses attached to the same base, with overlapping height intervals and different taper angles or directions.

Classify each analytic wall by its signed lean relative to the extrusion axis. When the active walls disagree, intersect the source with the bounded slab for that interval and split the result into solids. Each piece must have a uniform draft and a usable bottom profile. The analytic path recovers the profile from the cap's boundary edges, including arcs and inner loops. The existing opt-in spline approximation remains available for straight spline walls.

Emit a sketch and blind extrusion for each piece using the existing draft parameters. The original exact acceptance gate still checks relative volume, surface area, and symmetric difference at `1e-6`. If a connected piece still needs more than one draft, recognition fails atomically with the existing mixed-draft diagnostic. The 30° wall limit, work budget, and document schema are unchanged.

A narrow horizontal cap surrounded by uniformly drafted walls can resemble a chamfer strip between opposite walls. Preserve such a cap during blend detection so its layer can be recognized. Ordinary chamfers still follow the existing blend path.
