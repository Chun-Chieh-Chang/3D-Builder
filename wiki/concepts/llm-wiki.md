# Concept: LLM Wiki (Compounding Knowledge)

## Description
A knowledge management pattern where an AI agent maintains a persistent, structured markdown wiki for a project, rather than relying on session-based memory or fragmented RAG chunks.

## Key Principles
*   **Synthesis over Retrieval**: Knowledge is compiled once into structured pages (Entities/Concepts) and kept current, not re-derived on every query.
*   **Compounding Growth**: Every interaction, ingest, and query adds value to the central artifact.
*   **Shared Memory**: Provides a common context for multiple agents or multiple sessions on the same project.

## Workflow (Karpathy Pattern)
1.  **Ingest**: Raw source → Extraction → Page Updates.
2.  **Query**: Index Search → Page Drill-down → Synthesis.
3.  **Lint**: Consistency check → Contradiction resolution → Link repair.

## Implementation in SkillsBuilder
Implemented via the `wiki/` directory and governed by `wiki/SCHEMA.md`.
