import ast
import re
import sys
import os

def extract_python_signatures(content):
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return "Error: Syntax error in Python file."

    signatures = []
    
    def get_docstring(node):
        doc = ast.get_docstring(node)
        if doc:
            first_line = doc.split('\n')[0]
            return f'    """{first_line}..."""'
        return None

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            signatures.append(f"\nclass {node.name}:")
            doc = get_docstring(node)
            if doc: signatures.append(doc)
            
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    prefix = "async " if isinstance(item, ast.AsyncFunctionDef) else ""
                    arg_list = [a.arg for a in item.args.args]
                    if item.args.vararg: arg_list.append(f"*{item.args.vararg.arg}")
                    if item.args.kwarg: arg_list.append(f"**{item.args.kwarg.arg}")
                    
                    signatures.append(f"    {prefix}def {item.name}({', '.join(arg_list)}):")
                    doc = get_docstring(item)
                    if doc: signatures.append(f"    {doc}")
                    
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
            arg_list = [a.arg for a in node.args.args]
            signatures.append(f"\n{prefix}def {node.name}({', '.join(arg_list)}):")
            doc = get_docstring(node)
            if doc: signatures.append(f"    {doc}")
            
    return "\n".join(signatures).strip()

def extract_generic_signatures(content, ext):
    patterns = {
        '.js': [r'function\s+(\w+)', r'class\s+(\w+)', r'const\s+(\w+)\s*=\s*\(.*?\)\s*=>'],
        '.ts': [r'function\s+(\w+)', r'class\s+(\w+)', r'interface\s+(\w+)', r'type\s+(\w+)', r'const\s+(\w+)\s*=\s*\(.*?\)\s*=>'],
        '.md': [r'^#+ .*'],
        '.rs': [r'fn\s+(\w+)', r'struct\s+(\w+)', r'enum\s+(\w+)', r'trait\s+(\w+)', r'impl\s+']
    }
    
    applicable_patterns = patterns.get(ext, [r'function\s+\w+', r'class\s+\w+'])
    signatures = []
    for line in content.splitlines():
        clean_line = line.strip()
        if not clean_line: continue
        for p in applicable_patterns:
            if re.search(p, clean_line):
                signatures.append(clean_line)
                break
    return "\n".join(signatures)

def main():
    if len(sys.argv) < 2:
        print("Usage: python rtk_read.py <file_path>")
        return

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Error: {path} not found")
        return

    _, ext = os.path.splitext(path)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    if ext == '.py':
        print(extract_python_signatures(content))
    else:
        print(extract_generic_signatures(content, ext))

if __name__ == "__main__":
    main()
