# Concept: Cross-Device Migration & Sync

## Overview
SkillsBuilder is designed to be a "Portable Brain." This document explains how to move your entire development environment between different machines while maintaining context and skill synchronization.

## The Sync Strategy: Git + Symbolic Links

### 1. The Single Source of Truth
Keep the `SkillsBuilder` repository in a synced location (e.g., GitHub, GitLab, or a Cloud Drive). This ensures that any changes you make to the `wiki/` or `skills/` are version-controlled and available everywhere.

### 2. Local Registration (The "Bootstrap" Step)
Antigravity searches for skills in a specific system folder (`$HOME\.gemini\antigravity\skills`). To avoid duplicating files and losing sync:
- **Solution**: Use **Symbolic Links (Symlinks)**.
- **Benefit**: When you edit a skill in your project folder, the system-level skill is updated instantly.

## Migration Steps (New Machine)
1. **Clone the Repo**: `git clone [your-repo-url]`
2. **Run Installer**: Execute `.\INSTALL.ps1` in PowerShell (as Administrator).
3. **Verify**: Say 「啟動 SkillsBuilder 開發模式」 to the new AI agent.

## Persistence Hierarchy
1. **Wiki (Git)**: Stores high-level knowledge and logic.
2. **Skills (Symlinks)**: Stores executable capabilities.
3. **Knowledge Items (Metadata)**: Stores the system-level index.

## Troubleshooting
- **Symlink Permission**: If `INSTALL.ps1` fails, ensure you are running PowerShell as Administrator.
- **Path Drift**: If you move the `SkillsBuilder` folder, re-run `INSTALL.ps1` to update the links.
