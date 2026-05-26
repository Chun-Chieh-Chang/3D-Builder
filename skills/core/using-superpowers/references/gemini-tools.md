# Gemini CLI Tool Mapping

Skills use Claude Code tool names. When you encounter these in a skill, use your platform equivalent:

| Skill references | Gemini CLI equivalent |
|-----------------|----------------------|
| `Read` (file reading) | `read_file` |
| `Write` (file creation) | `write_file` |
| `Edit` (file editing) | `replace` |
| `Bash` (run commands) | `run_shell_command` |
| `Grep` (search file content) | `grep_search` |
| `Glob` (search files by name) | `glob` |
| `TodoWrite` (task tracking) | Use `TODO.md` file (edit with `replace`/`write_file`) |
| `Skill` tool (invoke a skill) | `activate_skill` |
| `WebSearch` | `google_web_search` |
| `WebFetch` | `web_fetch` |
| `Task` tool (dispatch subagent) | `invoke_agent` (see [Subagent support](#subagent-support)) |

## Subagent support

Gemini CLI supports subagents via the `invoke_agent` tool. Use the appropriate subagent (e.g., `generalist`, `codebase_investigator`) to dispatch tasks.

When a skill says to dispatch a named agent type, map it to `invoke_agent` with the corresponding `agent_name`:

| Skill instruction | Gemini CLI equivalent |
|-------------------|----------------------|
| `Task tool (superpowers:implementer)` | `invoke_agent(agent_name='generalist', prompt='...')` with filled template |
| `Task tool (superpowers:spec-reviewer)` | `invoke_agent(agent_name='generalist', prompt='...')` with filled template |
| `Task tool (superpowers:code-reviewer)` | `invoke_agent(agent_name='generalist', prompt='...')` with filled template |
| `Task tool (superpowers:code-quality-reviewer)` | `invoke_agent(agent_name='generalist', prompt='...')` with filled template |
| `Task tool (general-purpose)` with inline prompt | `invoke_agent(agent_name='generalist', prompt='...')` |

### Prompt filling

Skills provide prompt templates with placeholders like `{WHAT_WAS_IMPLEMENTED}` or `[FULL TEXT of task]`. Fill all placeholders and pass the complete prompt as the `prompt` parameter to `invoke_agent`.

## Additional Gemini CLI tools

These tools are available in Gemini CLI but have no Claude Code equivalent:

| Tool | Purpose |
|------|---------|
| `list_directory` | List files and subdirectories |
| `update_topic` | Manage narrative flow and strategic intent |
| `ask_user` | Request structured input from the user |
| `enter_plan_mode` / `exit_plan_mode` | Switch to read-only research mode |
| `list_background_processes` | Monitor background shell tasks |
