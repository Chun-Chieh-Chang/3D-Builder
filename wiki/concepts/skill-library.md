# Concept: Global Skill Library

## Overview
The Skill Library is the centralized repository for all AI agent capabilities in the `SkillsBuilder` ecosystem. It follows a "Single Source of Truth" model where skills are version-controlled in one place and deployed to the system via symbolic links.

## Directory Structure
- `skills/core/`: Essential productivity tools (Search, Summarize, Planning, YouTube).
- `skills/dev/`: Advanced development-specific tools (Skill Architect, GitNexus).
- `skills/experimental/`: New logic patterns under testing.

## Deployment Strategy (Symbolic Links)
Instead of copying files, the `INSTALL.ps1` script creates **Symbolic Links** from the system skills folder to the `SkillsBuilder` project.
- **Why?**: Any edit made in the `SkillsBuilder` repository is instantly active across all project sessions.
- **Workflow**: `Clone` → `Pull` → `Link`.

## How to Add a New Skill
1.  **Analyze**: Determine the category (Core vs. Dev).
2.  **Create**: Create a folder in `skills/[category]/[name]/`.
3.  **Define**: Author the `SKILL.md` using the [Skill Architect](../entities/skill-architect.md).
4.  **Register**: Re-run `INSTALL.ps1` to link the new folder.
5.  **Document**: Add an entry in the Wiki and the README.

## Best Practices
- **Atomic Skills**: Each skill should do one thing exceptionally well.
- **Keyword Hygiene**: Avoid overlapping trigger phrases between different skills.
- **Version Control**: Use Git commits to track the evolution of your agent's "capabilities."

## References
- `wiki/concepts/skill-lifecycle.md`: How skills are born and evolved.
- `INSTALL.ps1`: The deployment engine.
