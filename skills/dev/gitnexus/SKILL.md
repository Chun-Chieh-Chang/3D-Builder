---
name: gitnexus
description: Provide Antigravity with a "God's View" of the codebase using GitNexus knowledge graphs. Use this for impact analysis, tracing call chains, and complex refactoring.
---

# GitNexus for Antigravity

This skill empowers Antigravity to use structural awareness to navigate and modify codebases with 100% precision.

## Trigger Phrases
- "啟動 GitNexus", "分析影響範圍", "上帝視角", "爆炸半徑", "Impact Analysis", "Blast Radius"

## 1. Discovery Phase (Environmental Scan)
Before making complex changes, run the analysis to ensure the graph is current:
```bash
npx gitnexus analyze
```

## 2. Execution Phase (Surgical Logic)
Use the following commands to query the "Nervous System" of the project:

### Impact Analysis (Who depends on this?)
```bash
npx gitnexus query "impact_analysis(symbol: 'SYMBOL_NAME')"
```

### Flow Tracing (How is this called?)
```bash
npx gitnexus query "track_flow(from: 'START', to: 'END')"
```

### Semantic Reference (Where is this used?)
```bash
npx gitnexus query "find_references(symbol: 'SYMBOL_NAME')"
```

## 3. Verification Phase
After modifying code, run a re-index and verify the blast radius again to ensure no contracts are broken.
```bash
npx gitnexus analyze
```

## 4. Archive Phase (Wiki Synthesis)
Update the project `wiki/log.md` with the results of the impact analysis. If new architectural patterns are discovered, create/update the relevant `wiki/concepts/` page.

## Guardrails
- **Anti-Blindness**: If a task involves more than 3 files or changes a shared interface, Antigravity MUST run `gitnexus analyze` before proceeding.
- **Precision First**: Use the graph results to define the exact "Surgical Boundary" for `replace_file_content` calls.
