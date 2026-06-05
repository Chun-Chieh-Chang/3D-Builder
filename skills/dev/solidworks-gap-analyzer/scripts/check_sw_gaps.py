import os
import re
import sys
import io

# Force UTF-8 output encoding for compatibility with emojis on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# File Paths
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
VIEWPORT_PATH = os.path.join(ROOT_DIR, "src", "renderer", "Viewport.tsx")
CONTEXT_MENU_PATH = os.path.join(ROOT_DIR, "src", "ui", "ContextMenu.tsx")
DATUM_PLANES_PATH = os.path.join(ROOT_DIR, "src", "renderer", "DatumPlanes.tsx")

# Audit Items Configuration: (Display Name, Regex Target, File Path, Weight)
AUDIT_ITEMS = {
    # 1. Keyboard Shortcuts (35%)
    "Esc Key (Exit Cmd)": (r"e\.key\s*===\s*['\"]Escape['\"]", VIEWPORT_PATH, 5),
    "S Key (Shortcut Box)": (r"e\.key\s*===\s*['\"][sS]['\"](?!.*Escape)", VIEWPORT_PATH, 5),
    "D Key (Confirmation Corner)": (r"e\.key\s*===\s*['\"][dD]['\"]", VIEWPORT_PATH, 5),
    "Ctrl+8 (Normal To View)": (r"ctrlKey.*['\"]8['\"]|['\"]8['\"].*ctrlKey", VIEWPORT_PATH, 5),
    "Ctrl+7 (Isometric View)": (r"ctrlKey.*['\"]7['\"]|['\"]7['\"].*ctrlKey", VIEWPORT_PATH, 5),
    "F Key (Zoom to Fit)": (r"e\.key\s*===\s*['\"][fF]['\"]", VIEWPORT_PATH, 5),
    "Spacebar (Orientation Menu)": (r"e\.key\s*===\s*['\"] ['\"]|e\.key\s*===\s*['\"]Space['\"]", VIEWPORT_PATH, 5),

    # 2. Context Menu Options (35%)
    "Select Option": (r"SELECT|選擇", CONTEXT_MENU_PATH, 5),
    "End Chain Option": (r"End Chain|結束鏈", CONTEXT_MENU_PATH, 5),
    "Normal To Plane Option": (r"Normal To|正視於", CONTEXT_MENU_PATH, 5),
    "Exit Sketch Option": (r"Exit Sketch|退出草圖", CONTEXT_MENU_PATH, 5),
    "Construction Geometry Option": (r"Construction|構造幾何|isConstruction", CONTEXT_MENU_PATH, 5),
    "Edit Sketch/Feature": (r"Edit|編輯", CONTEXT_MENU_PATH, 5),
    "Suppress/Delete Option": (r"Suppress|Delete|壓縮|刪除", CONTEXT_MENU_PATH, 5),

    # 3. Viewport Indicators (20%)
    "Tool Cursor Badge": (r"sketchTool\s*===\s*['\"]LINE['\"]", DATUM_PLANES_PATH, 5),
    "Coincident Badge": (r"['\"]COINCIDENT['\"]", DATUM_PLANES_PATH, 5),
    "Horizontal/Vertical Badge": (r"['\"]HORIZONTAL['\"]|['\"]VERTICAL['\"]", DATUM_PLANES_PATH, 5),
    "Inference Lines": (r"inferenceLines", DATUM_PLANES_PATH, 5),

    # 4. UI Widgets & General (10%)
    "Geometric Origin Visual": (r"SolidWorks-style Geometric Origin|Geometric Origin", DATUM_PLANES_PATH, 5),
    "Confirmation Corner Widget": (r"Confirmation Corner|ConfirmationCorner", VIEWPORT_PATH, 5),
}

def scan_file(file_path, pattern):
    if not os.path.exists(file_path):
        return False
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return bool(re.search(pattern, content))
    except Exception:
        return False

def main():
    print("# SOLIDWORKS UX/UI Compatibility Audit Report\n")
    print("| Audit Item | Target File | Status | Score | Description |")
    print("| :--- | :--- | :--- | :--- | :--- |")

    total_score = 0
    max_score = 0

    for name, (pattern, file_path, weight) in AUDIT_ITEMS.items():
        max_score += weight
        relative_path = os.path.relpath(file_path, ROOT_DIR).replace("\\", "/")
        file_url = f"[{os.path.basename(file_path)}](file:///{file_path.replace('\\', '/')})"
        
        implemented = scan_file(file_path, pattern)
        if implemented:
            status = "✅ Implemented"
            score = weight
            total_score += weight
            desc = "Matching pattern found in code."
        else:
            status = "❌ Missing"
            score = 0
            desc = "Required code pattern/listener is missing."

        print(f"| **{name}** | {file_url} | {status} | {score}/{weight} | {desc} |")

    score_pct = (total_score / max_score) * 100
    print(f"\n## Compatibility Summary")
    print(f"- **Total SolidWorks Compatibility Score (SCS)**: **{total_score}/{max_score} ({score_pct:.1f}%)**")
    
    if score_pct < 50:
        print("- **Status**: 🔴 Critical UX Alignment Needed")
    elif score_pct < 85:
        print("- **Status**: 🟡 Moderate UX Alignment Gaps Exist")
    else:
        print("- **Status**: 🟢 Fully Aligned with SOLIDWORKS")

if __name__ == "__main__":
    main()
