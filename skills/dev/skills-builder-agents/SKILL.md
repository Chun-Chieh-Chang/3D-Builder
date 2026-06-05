---
name: skills-builder-agents
description: Dispatch customized SkillsBuilder Subagents (Architect, Art Director, QA, Implementer, SolidWorks Expert) to collaboratively develop the 3D-Builder project.
---

# SkillsBuilder Collaborative Agents Workflow (Closed-Loop PDCA)

Use this skill when developing complex features that require deep architectural planning, premium UI design, strict QA, precise execution, or SolidWorks CAD expertise.

## The Closed-Loop Process

1. **[規劃] SolidWorks Expert Phase**
   - Dispatch the **SolidWorks Expert Subagent** (`./solidworks-expert-prompt.md`) to translate user requirements into step-by-step CAD instructions.
   - If the user provides a YouTube video, the Expert MUST invoke the global `youtube` skill to fetch the transcript, analyze the video's workflow, and synthesize the CAD steps before proceeding.

2. **[自動化測試] Automation Robot Phase**
   - Dispatch the **Automation Robot Subagent** (`./automation-robot-subagent-prompt.md`) to execute the Expert's steps in the UI (via `browser_subagent`).
   - If successful, the task is complete.
   - If blocked (UI error, missing feature, logic crash), the Robot stops and reports the blocker.

3. **[架構對標] Architecture Phase (Triggered by Blocker)**
   - Dispatch the **Architect Subagent** (`./architect-subagent-prompt.md`) with the Robot's blocker report. It proposes a structural fix ensuring state (Zustand) safety and MECE compliance.
   - If UI/UX aesthetics are involved, parallel dispatch the **Art Director Subagent** (`./art-director-subagent-prompt.md`).

4. **[精準修復] Execution Phase**
   - Dispatch the **Core Implementer Subagent** (`./core-implementer-prompt.md`) to apply surgical code edits based on the Architect's fix.

5. **[回歸檢核] QA Phase**
   - Dispatch the **PDCA QA Subagent** (`./pdca-qa-subagent-prompt.md`) to verify builds and horizontal expansion.

6. **[重試循環] Retry Phase**
   - Return to **Step 2** (Automation Robot) to retry the operation. This loop continues until the Robot confirms success.

## How to Dispatch
Use the standard subagent pattern: supply the selected subagent prompt along with the specific task requirements and project context. Wait for their specialized response and integrate their output into the overall implementation plan or codebase.
