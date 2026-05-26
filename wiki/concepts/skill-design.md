# Concept: Skill Design Patterns

## Overview
Skill design follows modular patterns to extend AI agent capabilities. These patterns are inspired by Google's design systems and optimized for agentic workflows.

## The 6 Core Patterns
1.  **Tool Wrapper**: Encapsulating specialized knowledge or tools (e.g., API docs, brand guides).
2.  **Generator**: Enforcing specific output formats or templates (e.g., PRD, Code templates).
3.  **Reviewer**: Acting as a quality gatekeeper (e.g., Code review, security audit).
4.  **Inversion**: Asking clarifying questions before taking action (Think Before Coding).
5.  **Pipeline**: Breaking down complex tasks into sequential steps (Workflow).
6.  **Knowledge Artifact**: Synthesizing insights into a persistent wiki (LLM Wiki).

## Skill Structure
A standard skill consists of:
*   **SKILL.md**: Definition, keywords, and meta-logic.
*   **references/**: Domain-specific documentation or pattern matrix.
*   **scripts/**: Optional automation scripts.

## Metadata & Triggering
Skills are triggered via natural language keyword monitoring. Once a keyword is detected, the agent loads the corresponding `SKILL.md` and follows its instructions.

## When to Create a New Skill
*   **The 3-Time Rule**: If you find yourself repeating the same instructions three times, automate it.
*   **Workflow Bottlenecks**: Tasks that require strict multi-phase execution (Discovery-Execution-Verification).
*   **Knowledge Silos**: When you need to "teach" the AI a specific library's quirk to avoid hallucinations.

## Implementation Guardrails (Hermes + Karpathy)
*   **Surgical Edits**: Precise modifications only.
*   **Anti-Hallucination**: Explicit "Prohibited Actions" list.
*   **Verification Loops**: Automated checking of results.

## References
*   `raw/legacy/skill_usage_guide.md`: Original usage guide.
*   `skills/skill-architect/references/patterns.md`: Detailed pattern matrix.
