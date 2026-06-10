#!/usr/bin/env python3
"""
3D-Builder 檔案清理掃描工具
識別: 過時檔案、空檔案、測試/除錯檔、臨時檔、重複檔
"""

import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
import subprocess

BASE = Path("/c/Users/3kids/Downloads/3D-Builder")

# ── 排除目錄 ──
SKIP_DIRS = {
    "node_modules", ".git", ".next", "out", "electron/node_modules",
    "backend/.venv", "release", "__pycache__", ".pytest_cache", ".eslintcache",
    "vendor", "skills", ".opencode",
}

# ── 排除檔案 (keep) ──
KEEP_FILES = {
    # 原始碼
    "gap-audit-report.md",
    "DEBUG_SUMMARY.md",
    "package.json", "package-lock.json", "next.config.ts", "tsconfig.json",
    "tsconfig.node.json", "next-env.d.ts", "tailwind.config.ts",
    "postcss.config.mjs", "tailwind.css",
    "electron/main.ts", "electron/preload.ts", "electron/tsconfig.json",
    "electron/package.json",
    "backend/pyproject.toml", "backend/requirements.txt", "backend/SETUP.md",
    "docs/LEARNINGS.md", "docs/SELF_EVOLVING_GUARD.md",
    "docs/SOLIDWORKS_*.md", "docs/DEVELOPMENT_*.md",
    "docs/INTEGRATION_REPORT.md", "docs/governance/*.md",
    "docs/architecture/*.md", "docs/benchmarks/*.md",
    "docs/productization/*.md", "docs/spec/*.md",
    "docs/master_workflow_hook.md", "docs/skill_usage_guide.md",
    "docs/constraint_solver_spec.md", "docs/karpathy_coding_standards.md",
    "docs/pdca-system.html", "docs/verification_exercise_*.md",
    "docs/antigravity_skills_manual.md",
    "scripts/ci-learn.py",
    ".gitignore", ".gitattributes",
    ".eslintrc.json", ".prettierrc",
    ".cursor/rules/*.md", ".cursor/mcp.json", ".cursor/commands/",
    ".github/workflows/*.yml",
    "app.vue", "nuxt.config.ts",
    "tailwind.css",
}

# ── 檔案類別定義 ──
DANGEROUS_EXTS = {".pyc", ".pyo", ".pyd", ".wasm", ".dll", ".so", ".dylib", ".o", ".obj", ".exe"}
TEMP_EXTS = {".tmp", ".temp", ".bak", ".swp", ".swo", ".orig", ".save", ".old", ".backup", ".copy"}
DUMP_EXTS = {".log", ".txt", ".dat", ".bin", ".dump", ".crash"}
DOC_EXTS = {".md", ".rst", ".txt", ".html", ".pdf", ".doc", ".docx"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".psd", ".ai", ".eps"}
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".wmv", ".mkv", ".flv", ".webm"}
AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".flac", ".aac", ".wma"}
COMPRESSED = {".zip", ".tar", ".gz", ".rar", ".7z", ".bz2", ".xz", ".tgz"}
ENV_EXTS = {".env", ".env.local", ".env.production"}

# ── 檔案名稱模式 ──
TEMP_NAMES = {"TODO", "FIXME", "HACK", "WORKAROUND", "TEMP", "临时", "暫存", "unused", "backup", "test_only", "debug_"}
SKIP_PATTERNS = {
    "screenshot", "snapshot", "dump", "backup", "copy", "temp", "temp_",
    "TODO", "FIXME", "HACK", "test_", "debug_", "scratch", "tmp_",
}

# ── 最小檔案大小 (低於此值可能是 stub) ──
MIN_CODE_SIZE = 50  # bytes for .ts/.tsx/.py/.js/.jsx

# ── 最大檔案大小 (可能為 dump) ──
MAX_CODE_SIZE = 100_000  # bytes for source files

def is_in_skip_dir(path: Path) -> bool:
    parts = path.parts
    for skip in SKIP_DIRS:
        if skip in parts:
            return True
    return False

def scan():
    results = {
        "empty_files": [],
        "tiny_code_files": [],
        "temp_dump_files": [],
        "old_files": [],
        "doc_files_outside_docs": [],
        "image_files_outside_public": [],
        "video_audio_files": [],
        "compressed_files": [],
        "environment_files": [],
        "test_scripts_in_root": [],
        "python_scripts_in_root": [],
        "html_files_outside_app": [],
    }
    
    now = datetime.now()
    old_cutoff = now - timedelta(days=90)
    
    for root, dirs, files in os.walk(BASE):
        root_path = Path(root)
        
        # Skip directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        
        for filename in files:
            filepath = root_path / filename
            rel = filepath.relative_to(BASE)
            rel_str = str(rel)
            
            # Skip keep files
            if filename in {k.split("/")[-1] for k in KEEP_FILES}:
                continue
            
            try:
                stat = filepath.stat()
                size = stat.st_size
                mtime = datetime.fromtimestamp(stat.st_mtime)
            except (OSError, FileNotFoundError):
                continue
            
            # 1. Empty files
            if size == 0:
                results["empty_files"].append((rel_str, size))
                continue
            
            # 2. Dangerous extensions
            ext = filepath.suffix.lower()
            if ext in DANGEROUS_EXTS:
                results["temp_dump_files"].append((rel_str, size, "dangerous_ext"))
                continue
            
            # 3. Temp/backup files
            if ext in TEMP_EXTS:
                results["temp_dump_files"].append((rel_str, size, "temp_ext"))
                continue
            
            # 4. Dump files (log/dat/bin outside proper locations)
            if ext in DUMP_EXTS:
                results["temp_dump_files"].append((rel_str, size, "dump_ext"))
                continue
            
            # 5. Small code files
            if ext in {".ts", ".tsx", ".py", ".js", ".jsx", ".mjs"}:
                if size < MIN_CODE_SIZE:
                    results["tiny_code_files"].append((rel_str, size))
                if size > MAX_CODE_SIZE:
                    results["temp_dump_files"].append((rel_str, size, "too_large"))
            
            # 6. Doc files outside docs/
            if ext in DOC_EXTS and not str(rel).startswith("docs/") and not str(rel).startswith("skills/"):
                results["doc_files_outside_docs"].append((rel_str, size))
            
            # 7. Image files outside public/ and assets/
            if ext in IMAGE_EXTS:
                if not (str(rel).startswith("public/") or str(rel).startswith("assets/")):
                    results["image_files_outside_public"].append((rel_str, size))
            
            # 8. Video/audio files (likely junk)
            if ext in VIDEO_EXTS or ext in AUDIO_EXTS:
                results["video_audio_files"].append((rel_str, size))
            
            # 9. Compressed files (likely junk in source)
            if ext in COMPRESSED and not str(rel).startswith("vendor/"):
                results["compressed_files"].append((rel_str, size))
            
            # 10. Environment files
            if ext in ENV_EXTS:
                results["environment_files"].append((rel_str, size))
            
            # 11. Python scripts in root (outside scripts/, backend/, skills/)
            if ext == ".py" and not str(rel).startswith("scripts/") and \
               not str(rel).startswith("backend/") and not str(rel).startswith("skills/"):
                results["python_scripts_in_root"].append((rel_str, size, mtime))
            
            # 12. HTML files outside src/app/
            if ext == ".html" and not str(rel).startswith("src/app/") and not str(rel).startswith("docs/"):
                results["html_files_outside_app"].append((rel_str, size))
            
            # 13. Temp names
            name_lower = filename.lower().replace(".", "_").replace("-", "_")
            for pattern in SKIP_PATTERNS:
                if pattern.lower() in name_lower:
                    results["temp_dump_files"].append((rel_str, size, f"temp_name:{pattern}"))
                    break
    
    return results

def print_report(results):
    total = sum(len(v) for v in results.values())
    print("=" * 70)
    print(f"📊 3D-Builder 檔案清理掃描報告")
    print(f"   掃描日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"   總發現問題: {total} 個")
    print("=" * 70)
    
    categories = [
        ("empty_files", "空檔案"),
        ("tiny_code_files", "過小程式檔 (可能是 stub)"),
        ("temp_dump_files", "臨時/測試/ dump 檔案"),
        ("doc_files_outside_docs", "文件檔不在 docs/ 目錄"),
        ("image_files_outside_public", "圖片檔不在 public/"),
        ("video_audio_files", "音訊/影片檔案"),
        ("compressed_files", "壓縮檔 (來源目錄)"),
        ("environment_files", "環境設定檔"),
        ("python_scripts_in_root", "Python 腳本在根目錄"),
        ("html_files_outside_app", "HTML 檔不在 src/app/"),
    ]
    
    for key, label in categories:
        items = results[key]
        if items:
            print(f"\n🔴 {label}: {len(items)} 個")
            for item in sorted(items, key=lambda x: x[0]):
                rel, size = item[0], item[1]
                extra = ""
                if len(item) > 2:
                    extra = f" ({item[2]})"
                print(f"  {rel:<70s} {size:>10,}B{extra}")

if __name__ == "__main__":
    results = scan()
    print_report(results)
    
    # Save JSON for programmatic use
    import json
    output = {}
    for key, items in results.items():
        output[key] = [item[0] for item in items]
    
    report_path = str(BASE / ".cleanup_report.json").replace("\\\\", "/").replace("/c/", "C:/")
    with open(report_path, "w", encoding="utf-8") as f:
        os.makedirs(BASE, exist_ok=True)
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\n📄 JSON 報告已儲存至 .cleanup_report.json")
    print(f"   總計: {sum(len(v) for v in results.values())} 個問題檔案")
    
    sys.exit(0)
