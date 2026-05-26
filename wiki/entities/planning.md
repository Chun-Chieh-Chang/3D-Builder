# Entity: Planning (Manus-Style)

## Description
A sophisticated task management system that uses local files to track progress on multi-step projects.

## Artifacts
- **task_plan.md**: The master list of tasks and their statuses.
- **findings.md**: Key discoveries made during the project.
- **progress.md**: A log of completed sub-tasks.

## Magic Phrases
- 「幫我 **Plan** 一下...」
- 「規劃任務...」

## Usage Patterns
- **Discovery Phase**: Create the initial `task_plan.md` after environmental scanning.
- **Execution Phase**: Update statuses and log findings.
- **Archive Phase**: Use `findings.md` as the primary source for wiki synthesis.

## Integration
- Works seamlessly with the **Skill Lifecycle**. Every complex skill activation should trigger a `Plan` if it involves more than 5 steps.
