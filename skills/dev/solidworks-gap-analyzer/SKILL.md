---
name: solidworks-gap-analyzer
description: Systematically scan, audit, analyze, and enforce UX/UI compatibility alignment between 3D-Builder and standard SOLIDWORKS conventions.
---

# SolidWorks Gap Analyzer

Use this skill to identify, analyze, and propose corrective actions for functional and usability gaps between this web CAD system and SOLIDWORKS.

## Trigger Phrases
- "檢查 SolidWorks 差異", "SW gaps check", "SW compatibility audit", "solidworks-gap-analyzer"

## Audit Workflow (PDCA)

1. **[Plan] Run Automated Auditor**:
   Run the scanner to identify implemented vs. missing hotkeys, context menu triggers, widgets, and cursors:
   ```bash
   python skills/dev/solidworks-gap-analyzer/scripts/check_sw_gaps.py
   ```
2. **[Do] Update the Gap Database**:
   Cross-reference scanner output with [gap-checklist.md](file:///c:/Users/USER/Downloads/3D-Builder/skills/dev/solidworks-gap-analyzer/gap-checklist.md) to log files involved, priority rating, and implementation strategies.
3. **[Check] Refine Agent Prompts**:
   Verify that the **SolidWorks Expert** has accurately mapped standard operations and that the **QA Subagent** has validated UX shortcuts.
4. **[Act] Close Gaps (Refinement)**:
   For any detected gap:
   - Identify the source file (e.g. `Viewport.tsx` for hotkeys, `ContextMenu.tsx` for right-click menus, `DatumPlanes.tsx` for snapping cursors).
   - Write clean, non-regressive state bindings in Zustand store.
   - Run verification tests to update the Compatibility Score.
