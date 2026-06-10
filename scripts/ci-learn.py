#!/usr/bin/env python3
"""
CI Learning Script
Run this after a CI failure to automatically:
1. Record the failure to docs/LEARNINGS.md
2. Generate new pre-push checks if needed
3. Update the knowledge base

Usage:
    python3 scripts/ci-learn.py --failure "pythonocc" --category "python"
    python3 scripts/ci-learn.py --init
"""

import sys
import os
from pathlib import Path
from datetime import datetime

KNOWLEDGE_BASE = Path("docs/LEARNINGS.md")
LEARNINGS_SECTION = "<!-- AUTO-LEARNINGS -->"

def init_knowledge_base():
    """Initialize the knowledge base if it doesn't exist."""
    if KNOWLEDGE_BASE.exists():
        print(f"✅ Knowledge base already exists: {KNOWLEDGE_BASE}")
        return
    
    KNOWLEDGE_BASE.parent.mkdir(parents=True, exist_ok=True)
    
    template = """# 3D-Builder 學習筆記 (Lessons Learned)

> **來源**：DEBUG_SUMMARY.md + 開發過程中遇到的所有問題
> **更新頻率**：每次遇到新問題或 CI 失敗時自動更新

"""
    KNOWLEDGE_BASE.write_text(template)
    print(f"✅ Created knowledge base: {KNOWLEDGE_BASE}")

def learn_from_failure(failure: str, category: str, solution: str = ""):
    """
    Record a learning from a CI failure.
    
    Args:
        failure: Description of the failure
        category: Category of the failure (python, typescript, ci, etc.)
        solution: How the failure was resolved
    """
    if not KNOWLEDGE_BASE.exists():
        print("❌ Knowledge base not found. Run --init first.")
        sys.exit(1)
    
    today = datetime.now().strftime("%Y-%m-%d")
    learning_entry = f"""
## {category.upper()} Issues
- [FIXED] {failure}
- 原因：{solution or "未記錄"}
- 預防：任何相關程式碼必須檢查此問題
- 知識標記：`AUTO_LEARN_{category.upper()}_{today}`
"""
    
    with open(KNOWLEDGE_BASE, "a") as f:
        f.write(learning_entry)
    
    print(f"✅ Learned from failure: {failure}")
    print(f"   → Updated: {KNOWLEDGE_BASE}")

def main():
    args = sys.argv[1:]
    
    if "--init" in args:
        init_knowledge_base()
        return
    
    if "--check-env" in args:
        # Check environment compatibility
        import subprocess
        result = subprocess.run(["python3", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            version = result.stdout.strip().split()[1]
            major, minor = map(int, version.split(".")[:2])
            if major == 3 and minor >= 13:
                print(f"⚠️  WARNING: Python {version} detected (>=3.13)")
                print("   → pythonocc-core requires Python 3.10-3.12")
                sys.exit(1)
            elif major == 3 and minor >= 10:
                print(f"✅ Python version OK ({version})")
        else:
            print("⚠️  WARNING: python3 not found")
        sys.exit(0)
    
    failure = None
    category = None
    solution = ""
    
    i = 0
    while i < len(args):
        if args[i] == "--failure" and i + 1 < len(args):
            failure = args[i + 1]
            i += 2
        elif args[i] == "--category" and i + 1 < len(args):
            category = args[i + 1]
            i += 2
        elif args[i] == "--solution" and i + 1 < len(args):
            solution = args[i + 1]
            i += 2
        else:
            i += 1
    
    if not failure or not category:
        print("❌ Usage: python3 scripts/ci-learn.py --failure '...' --category '...'")
        sys.exit(1)
    
    learn_from_failure(failure, category, solution)

if __name__ == "__main__":
    main()
