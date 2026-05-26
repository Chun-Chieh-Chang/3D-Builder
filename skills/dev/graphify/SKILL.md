---
name: graphify
description: Transform project folders (code, schemas, media, docs) into a queryable local knowledge graph. Optimized for 71.5x token reduction during context scans.
---

# Graphify Local Knowledge Graph

This skill enables Antigravity to convert code, databases, documentation, and assets into a queryable local knowledge graph, eliminating token bloat during repository-wide scans.

## Trigger Phrases
- "啟動 Graphify", "建立圖譜", "圖譜查詢", "代碼圖譜化", "Graphify", "Token 節流", "Local Graph"

---

## 1. Discovery Phase (Environmental Scan)
Before conducting extensive queries, check if the graph exists and is updated.
- Verify installation:
  ```bash
  graphify --version
  ```
- Build the initial graph (or force a complete rebuild):
  ```bash
  graphify .
  ```
- Speed up rebuilds for large repositories by bypassing visualizer generation:
  ```bash
  graphify . --no-viz
  ```

---

## 2. Execution Phase (Surgical Logic)
Query the local graph or trigger incremental updates during development.

### Semantic Search & Low-Token Querying
When you need to understand cross-component logic, dependency paths, or architecture:
```bash
graphify query "How does component A interact with component B?"
```
*Token Savings*: This query retrieves semantic pathways using up to **71.5x fewer tokens** than reading raw source files directly.

### Incremental Synchronization
To keep the graph aligned with your current branch changes without rebuilding from scratch:
```bash
graphify . --update
```

### Community Granularity Fine-Tuning
To recalculate modular clusters without re-extracting all file entities:
```bash
graphify . --cluster-only --resolution 1.2
```

---

## 3. Verification & Safety Checks
- Ensure the output directory `graphify-out/` is correctly listed in the local `.gitignore` to prevent committing massive visualization files.
- Install merge driver hooks to prevent team merge conflicts on `graph.json` files:
  ```bash
  graphify hook install
  ```

---

## 4. Archive & Wiki Synthesis
- Extract concepts or cluster maps from `graphify-out/` and merge them into `wiki/index.md` or `wiki/concepts/`.
- Use Graphify's query results to trace the exact "Blast Radius" of any planned refactoring before applying code changes.

---

## Guardrails
- **Token Efficiency First**: If a task involves searching across more than 3 distinct modules, Antigravity MUST query the graph via `graphify query` rather than reading raw files or performing full-file regex searches.
- **Git Hygiene**: Never allow `graph.json` or `graphify-out/` to be staged for git commits.
