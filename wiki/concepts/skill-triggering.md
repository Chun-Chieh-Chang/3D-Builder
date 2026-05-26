# Concept: Skill Triggering & Magic Phrases

## Overview
Skills in Antigravity are not triggered by complex CLI commands or configuration files. Instead, they leverage **Natural Language Triggering** via "Magic Phrases."

## How Triggering Works
Every `SKILL.md` contains a `trigger_phrases` or `keywords` section. The agent's core logic monitors the conversation for these specific strings.

### 1. Implicit Triggering (Natural Conversation)
You don't need to specify the tool. Just describe the intent.
- **Intent**: Search for news.
- **Conversation**: "What's the latest on SpaceX?"
- **Result**: `Tavily Search` is automatically activated.

### 2. Explicit Triggering (Magic Phrases)
Using specific terms forces the agent to load a particular "Persona" or "Expert Mode."
- **Example**: "針對...進行 **Research**"
- **Example**: "啟動 **Skill Architect**"

## The "Combo Move" (Skill Chaining)
You can chain multiple triggers in a single request.
> "先幫我 **Search** 『Bland AI』 的最新評測，然後幫我把重點 **Summarize** 出來，最後幫我 **Plan** 一個測試計畫。"

The agent interprets this as a sequence of three skill activations:
1. `Tavily Search` (Discovery)
2. `Summarize` (Analysis)
3. `Planning-with-files` (Structuring)

## Governance & Safety
- **Vet Skill**: Before any new skill is installed or executed, the `vet_skill` logic checks the source code for security risks.
- **Anti-Hallucination**: Triggering a skill loads specific guardrails that prevent the agent from straying outside the defined "Surgical Boundary."

## References
- `raw/legacy/antigravity_skills_manual.md`: Original usage manual.
- `wiki/entities/antigravity-ide.md`: Core capabilities list.
