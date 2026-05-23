# 3D-Builder Knowledge Base Map

Welcome to the central intelligence hub of **3D-Builder**. This wiki compiles our core architectural decisions, data structures, mathematics, and styling guidelines under the `SkillsBuilder` paradigm.

---

## 🗺️ Index of Technical Entities

### Core Architecture & State
*   [Graph State Model](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/entities/graph_model.md): Documenting our core Zustand data structures (`sketchNodes`, `sketchEdges`, `sketchConstraints`) that represent 2D parametric geometry.
*   [PBD Constraint Solver](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/entities/constraint_solver.md): Technical breakdown of our Position-Based Dynamics relaxation math and supported constraint types (`COINCIDENT`, `HORIZONTAL`, `VERTICAL`, `DISTANCE`, `EQUAL`).

### Frontend Viewport & User Interface
*   [Viewport & Snapping Engine](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/entities/viewport_renderer.md): Highlighting the Three.js / React Three Fiber renderer, Datum Planes coordinate projection, and the multi-priority O-Snap snapping cursor.
*   [User Interface & Control Panel](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/entities/user_interface.md): Guide to our premium glassmorphism layouts, Ribbon tools, FeatureManager design trees, and `SketchPropertyManager` parameter control panel.

### AI & Agentic Skills (Integrated from SkillsBuilder)
*   [skill-architect](entities/skill-architect.md): The core tool for building new AI skills.
*   [antigravity-ide](entities/antigravity-ide.md): The host environment for these skills.
*   [skills-builder](entities/skills-builder.md): This project's meta-structure.
*   [tavily](entities/tavily.md): Search & Research engines.
*   [summarize](entities/summarize.md): Insights extraction tool.
*   [planning](entities/planning.md): Task management system.
*   [youtube](entities/youtube.md): Visual knowledge acquisition tool.
*   [gitnexus](entities/gitnexus.md): Code intelligence & graph engine.

---

## 🎨 Index of Design & Quality Concepts

*   [Premium Color & Style System](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/concepts/color_system.md): Morandi watercolor palettes, Glass Order rules, and accessible contrast thresholds.
*   [PDCA & Quality SOP](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/concepts/pdca_sop.md): Outlining our strict local testing, type validation (`npx tsc --noEmit`), and zero-console regression guardrails.
*   [Glass Order](concepts/glass-order.md): Principles of glassmorphism layering.
*   [Graph-Driven Development](concepts/graph-driven-dev.md): Structural awareness & blast radius analysis.
*   [LLM Wiki](concepts/llm-wiki.md): Compounding knowledge pattern.
*   [Skill Design](concepts/skill-design.md): The 6 design patterns and Hermes/Karpathy guardrails.
*   [Skill Lifecycle](concepts/skill-lifecycle.md): Agent-Driven Development (ADD) & the 4-phase workflow.
*   [Nexus Protocols](concepts/nexus-protocols.md): Standards for agentic handovers and quality gates.

---

## 📜 Governance Reference
*   [Wiki Schema & Governance](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/SCHEMA.md): General principles and INGEST/QUERY workflow requirements.
*   [Global Rules](wiki/global_rules.md): Global constraints and token efficiency mandates.
*   [Project Changelog](file:///C:/Users/3kids/Downloads/3D-Builder/wiki/log.md): Chronological logs of versions, milestones, and architectural pivots.
