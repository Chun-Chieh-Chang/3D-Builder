---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

You write test cases (pressure scenarios), watch them fail (baseline), write the skill, watch tests pass (compliance), and refactor (close loopholes).

**REQUIRED BACKGROUND:** You MUST understand superpowers:test-driven-development. This skill adapts TDD to documentation.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools.

**Skills are:** Reusable techniques, patterns, tools, reference guides.
**Skills are NOT:** Narratives about how you solved a problem once.

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **RED Phase** | Agent violates rule without skill (baseline) |
| **GREEN Phase** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |

**The Iron Law:** NO SKILL WITHOUT A FAILING TEST FIRST. See [Testing Methodology](#testing-methodology).

## When to Create a Skill

**Create when:**
- Technique wasn't intuitively obvious.
- Pattern applies broadly (not project-specific).
- Others would benefit.

**Don't create for:** One-off solutions, standard practices, or project-specific conventions (use GEMINI.md).

## Directory Structure

\\\
skills/
  skill-name/
    SKILL.md              # Main reference (required)
    supporting-file.*     # Only if needed (heavy reference/tools)
\\\

## SKILL.md Structure

**Frontmatter (YAML):**
- \
ame\: Letters, numbers, hyphens only.
- \description\: Third-person, starts with "Use when...". **NEVER summarize the workflow.**

**Body Sections:**
- # Skill Name
- ## Overview (1-2 sentences)
- ## When to Use (Symptoms/Flowchart)
- ## Core Pattern (Before/After comparison)
- ## Quick Reference (Table/Bullets)
- ## Implementation (Inline or link)
- ## Common Mistakes

## Discovery & Efficiency (CSO)

### 1. Rich Description Field
Claude reads the description to decide whether to load the skill. Describe the **problem/symptoms**, not the solution.

### 2. Token Efficiency
- Target < 200 words for frequently-loaded skills.
- Move heavy details to supporting files.
- Use cross-references instead of repeating instructions.

### 3. Descriptive Naming
Use active voice, verb-first: \creating-skills\, \oot-cause-tracing\.

## Flowchart & Code Usage

- **Flowcharts:** Use ONLY for non-obvious decision points or loops. Use Graphviz (DOT).
- **Code Examples:** One excellent, runnable, well-commented example beats many mediocre ones.

## Testing Methodology

**You MUST follow the RED-GREEN-REFACTOR cycle for documentation.**

1. **RED:** Run a pressure scenario WITHOUT the skill. Document failures verbatim.
2. **GREEN:** Write the minimal skill to address those specific failures.
3. **REFACTOR:** Identify new rationalizations, add explicit counters, and re-test.

**REQUIRED REFERENCE:** See \	esting-skills-with-subagents.md\ for:
- Writing pressure scenarios (Time, Sunk Cost, Authority).
- Building rationalization tables.
- The mandatory deployment checklist.

## Anti-Patterns
- **Narrative Storytelling:** "In session X, we found..."
- **Multi-Language Dilution:** Providing examples in 5 languages.
- **Generic Labels:** \helper1\, \step2\. Use semantic names.
