# Concept: Graph-Driven Development (GDD)

## Overview
Graph-Driven Development is an evolution of traditional AI coding where Antigravity's context is supplied by a pre-computed knowledge graph rather than raw text search or RAG.

## The Problem: "Blind Coding"
AI agents often hallucinate or break dependencies because they can only see the current file or a few "top results" from a search. They lack **Structural Awareness**.

## The Solution: The Knowledge Graph
By mapping every function call, import, and class inheritance into a graph, the AI can perform **Blast Radius Analysis**.
- **Blast Radius**: The set of components that will be affected by a specific change.
- **Impact Query**: "If I change the signature of `auth.login()`, which 12 services will break?"

## GDD Workflow (4-Phase Integration)
1. **Discovery**: AI queries the graph to understand the system's architecture.
2. **Execution**: AI makes surgical changes with high confidence.
3. **Verification**: AI uses the graph to verify that all call sites have been updated.
4. **Archive**: The updated graph reflects the new project state.

## Strategic Value
- **Zero Token Waste**: Indexing happens locally; the AI only reads the relevant branches of the graph.
- **Complex Refactoring**: Makes large-scale changes safe for AI.
- **Onboarding**: Allows new agents (or humans) to understand a legacy codebase in minutes.

## References
- `wiki/entities/gitnexus.md`: Implementation tool.
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io): The communication layer.
