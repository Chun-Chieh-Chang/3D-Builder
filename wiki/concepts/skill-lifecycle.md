# Concept: Skill Lifecycle (ADD)

## Overview
The Skill Lifecycle defines the stages of a skill's existence, from identification to perpetual refinement. This follows the **Agent-Driven Development (ADD)** philosophy.

## Stage 1: Identification (The 3-Time Rule)
A skill is born when a task is repeated **3 times** manually.
- **Criteria**: Is it repetitive? Is it complex? Does it require specific standards?
- **Action**: Invoke the [Skill Architect](../entities/skill-architect.md).

## Stage 2: Development (Multi-Phase Workflow)
Every skill developed in this ecosystem must follow the 4-phase execution logic:
1. **Discovery (Phase 1)**: Scan environment, check dependencies, and identify the "Surgical Boundary."
2. **Execution (Phase 2)**: Perform the task using precision edits and RCA/CAPA logging.
3. **Verification (Phase 3)**: Use automated loops (`[Step] → verify: [check]`) to ensure zero-error outcomes.
4. **Archive (Phase 4)**: Synthesize insights back into the project `wiki/`.

## Stage 3: Deployment & Registration
- **Local**: Saved to `.gemini/antigravity/skills/`.
- **Global**: Registered in the `skills_builder` Knowledge Item (KI) for cross-project accessibility.

## Stage 4: Continuous Evolution
Skills are not static. As the codebase evolves or new "Legacy" materials are ingested:
- **Lint**: Periodically check if skill guardrails are still valid.
- **Merge**: Combine small, redundant skills into a single "Master Skill."

## Goal: Knowledge compounding
The ultimate goal of the lifecycle is not just task completion, but **Knowledge Compounding**. Every time a skill runs, the project's "Brain" (Wiki) should get smarter.

## References
- `raw/legacy/implementation_plan.md`: Skill Architect's design origins.
- `wiki/concepts/llm-wiki.md`: The storage pattern for insights.
