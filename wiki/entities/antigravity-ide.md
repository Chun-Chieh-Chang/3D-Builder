# Entity: Antigravity IDE & Agent

## Description
Antigravity is an agentic AI coding assistant designed for advanced agentic coding. It operates within a workspace and leverages a suite of "Skills" to perform complex tasks.

## Core Capabilities (Magic Phrases)
The agent integrates multiple skills that can be triggered by natural language keywords:
*   **Search/Research**: `Tavily Search` & `Tavily Research` for live web data.
*   **Summarization**: `Summarize` for long-form content.
*   **Planning**: `Planning-with-files` for multi-step projects.
*   **Media**: `YouTube Search` for video transcripts.
*   **Social**: `X-Trends` for real-time social trends.
*   **Meta**: `Skill Creator` for building new agent capabilities.
*   **Evolution**: `Soul Evolution` for self-optimization.
*   **Intelligence**: `GitNexus` for structural awareness and "God's View" of the codebase.

## Skill Management
*   **Skills Directory**: `.gemini/antigravity/skills/`
*   **Skill Creation**: Managed via the [Skill Architect](skill-architect.md).

## Skill Lifecycle (When & How)

### When to Create a New Skill
*   **Repetition**: When a task is repeated more than 3 times.
*   **Complexity**: When a workflow is too complex for basic chat memory.
*   **Precision**: When specific industrial standards or guardrails are required.
*   **Portability**: When you want to reuse a logic across different projects.

### How to Use Skills
*   **Natural Trigger**: Mention keywords defined in `SKILL.md`.
*   **Explicit Call**: Directly ask to "Run [Skill Name]".
*   **Compounding Loop**: After a skill task is done, always ensure the insights are updated in the `wiki/`.

## Usage Best Practices
*   **Combined Skills**: Use multiple tools in sequence (e.g., Search → Summarize → Plan).
*   **Context Awareness**: The agent has access to the local filesystem and workspace context.

## References
*   `raw/legacy/antigravity_skills_manual.md`: Original usage manual.
