# Wiki Schema & Governance (3D-Builder)

This document defines the rules for maintaining the `3D-Builder` Knowledge Base. It is aligned with the `SkillsBuilder` dual-role architecture standard (Senior Full-stack Architect & Top Digital Art Director).

---

## 1. Core Principles
*   **Persistent & Compounding**: The wiki is not just a documentation repository; it is a live synthesis of everything the AI agent and developer have established about this CAD engine.
*   **Interlinked**: All entities (code modules, React state) and concepts (SOPs, mathematics) should be linked. Avoid orphan pages.
*   **Cited**: Every claim in the wiki should trace back to specific files in the `src/` codebase or `handover_resume_guide.md`.
*   **Offline & Precision-First**: Maintain records of architectural stubs, robust fallbacks, and performance-minded design metrics.

---

## 2. Governance Workflows

### INGEST
1. Read a new system update (such as `handover_resume_guide.md`, a git status, or a refactored class).
2. Distill key changes into specific Entities (under `wiki/entities/`) or Concepts (under `wiki/concepts/`).
3. Update `wiki/index.md` and append to `wiki/log.md`.

### QUERY
1. Scan `wiki/index.md` to locate the source of truth for the target module.
2. Navigate directly to the corresponding entity/concept file to prevent blind, token-heavy file scanning.
3. If new patterns or insights emerge during development, compile and document them back in the wiki.

### LINT
1. Validate that all wiki links are valid and active.
2. Periodically clean out stale files or outdated specifications that do not align with the current refactored code state.

---

## 3. Directory Structure
*   `wiki/entities/`: Pages for technical modules, files, data models, or engines.
*   `wiki/concepts/`: Pages for high-level design systems, math solvers, color palettes, and SOPs.
*   `wiki/index.md`: The central directory mapping the entire knowledge base.
*   `wiki/log.md`: Chronological log of major architectural changes and milestones.
