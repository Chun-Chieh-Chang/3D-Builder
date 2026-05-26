# Entity: Tavily (Search & Research)

## Description
Tavily is the primary external knowledge acquisition tool for Antigravity. It provides LLM-optimized search results and deep research capabilities.

## Tools
*   **tavily-search**: Quick fact-finding with content snippets.
*   **tavily-research**: Comprehensive multi-source synthesis with citations.

## Magic Phrases
- 「幫我 **Search**...」
- 「針對...進行 **Research**」

## Usage Patterns
- **Discovery Phase**: Used to scan the latest industry standards or API documentation.
- **Verification Phase**: Used to verify claims or check for breaking changes in dependencies.

## Guardrails
- **Time Filter**: Always prioritize results from the last 30 days unless historical context is needed.
- **Citation**: Must cite URLs for all research claims.

## References
- `raw/legacy/archive/antigravity_skills_manual.md`
