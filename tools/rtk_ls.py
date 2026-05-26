import os
import sys

def get_tree(path, prefix="", ignored=None):
    if ignored is None:
        ignored = {'.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', '.claude-plugin', '.cursor-plugin', '.codex-plugin', '.opencode'}
    
    output = []
    try:
        items = sorted(os.listdir(path))
    except PermissionError:
        return [f"{prefix}[Permission Denied]"]

    # Filter ignored items
    items = [item for item in items if item not in ignored]

    # Heuristic: if a directory has too many files, summarize it
    if len(items) > 50 and prefix != "":
        return [f"{prefix}└── [Summarized: {len(items)} items]"]

    for i, item in enumerate(items):
        full_path = os.path.join(path, item)
        is_last = (i == len(items) - 1)
        connector = "└── " if is_last else "├── "
        
        output.append(f"{prefix}{connector}{item}")
        
        if os.path.isdir(full_path):
            new_prefix = prefix + ("    " if is_last else "│   ")
            output.extend(get_tree(full_path, new_prefix, ignored))
            
    return output

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    if not os.path.isdir(target):
        print(f"Error: {target} is not a directory")
        return

    print(os.path.abspath(target))
    for line in get_tree(target):
        print(line)

if __name__ == "__main__":
    main()
