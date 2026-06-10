# Feature Gap Audit Report: Feature Tree Reordering Validation & Parent Dependencies

## 1. Context & Source
**Video**: SolidWorks Tutorial: Understanding Sketch Order during Modeling (Video ID: jWssBXy216g)
**Focus**: Sketch/Feature Timeline Order, Parent-Child Relationships, and FeatureManager Design Tree Reordering.

## 2. Analysis of the Gap
Based on the code audit:
- **UI Drag & Drop (`src/ui/FeatureManagerPanel.tsx`)**: The `handleDragEnd` function implements `@dnd-kit/sortable` for feature reordering. However, it completely lacks topological constraint checks. A user can freely drag a child feature (e.g., a Fillet or Extrude Cut) *above* its parent feature (the Base Extrude it modifies), which breaks chronological stability and causes backend failures.
- **Dependency Graph (`src/utils/feature-tree-relations.ts`)**: The `getParentsAndChildren` function correctly traverses and identifies descendant children recursively. However, the calculation of "Parents" is overly simplified; it only assigns a pseudo "Sketch" parent and fails to back-trace true topological parents (e.g., which previous features this feature depends on).

## 3. Recommended Corrective Action (PDCA - Plan)
### UI Update (`src/ui/FeatureManagerPanel.tsx`):
- Enhance `handleDragEnd` to compute the parents and children of the `active` feature being dragged.
- Determine the constraints: 
  - `minAllowedIndex` = the highest index among all its parents.
  - `maxAllowedIndex` = the lowest index among all its children.
- If the `newIndex` is `< minAllowedIndex` or `> maxAllowedIndex`, reject the drag operation and notify the user via a UI toast or console log that "A feature cannot be reordered before its parent or after its child."

### Dependency Parsing Update (`src/utils/feature-tree-relations.ts`):
- Implement `findAncestors` recursively: For the target feature, scan all prior features in the list. If `isDirectChild(priorFeature, currentFeature)` is true, then `priorFeature` is a parent. Recursively resolve all parents.
- Return the full list of topological parents, ensuring the Reorder logic has accurate boundaries.

## 4. Priority
- **Status**: Critical. Chronological integrity is the foundation of parameteric CAD. Unconstrained reordering guarantees B-Rep crash regressions during rebuilds.
