# Entity: GitNexus (Code Intelligence Engine)

## Description
GitNexus is an MCP-native knowledge graph engine that transforms source code into a structured "Nervous System." It allows Antigravity to have a "God's View" of the repository.

## Core Capabilities (7 MCP Tools)
GitNexus exposes tools to Antigravity via the Model Context Protocol (or direct CLI interaction):
1.  **Semantic Search**: High-precision context retrieval.
2.  **Impact Analysis (Blast Radius)**: Identifies downstream dependencies before a code change.
3.  **Reference Tracking**: Finds all usages of a symbol across the entire repo.
4.  **Flow Analysis**: Maps out execution paths and function call chains.
5.  **Schema Evaluation**: Validates interface and contract integrity.
6.  **Context Injection**: Automatically populates Antigravity's prompt with relevant graph nodes.
7.  **Auto-Reindexing**: Updates the knowledge graph post-commit via hooks.

## Integration Commands
- **Initialize Index**: `npx gitnexus analyze`
- **Antigravity Activation**: Invoke the `gitnexus` skill within Antigravity.

## Usage Patterns
- **Discovery Phase**: Run `analyze` to build the graph.
- **Verification Phase**: Use `Impact Analysis` to check for regressions before submitting a PR.
- **Archive Phase**: GitNexus updates project context which is then ingested into the Antigravity `wiki/`.

## References
- [Official GitHub](https://github.com/abhigyanpatwari/GitNexus)
- YouTube [Zy6tS-7xg9M](https://www.youtube.com/watch?v=Zy6tS-7xg9M)
