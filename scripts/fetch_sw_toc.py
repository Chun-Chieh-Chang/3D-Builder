#!/usr/bin/env python3
"""
Fetch and parse SolidWorks 2025 Help TOC structure - Enhanced version
"""

import sys
import json
import urllib.request
from html.parser import HTMLParser
import re

class SolidWorksTOCParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = []
        self.in_toc = False
        self.toc_depth = 0
        
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        # Look for TOC-related elements
        if tag in ['div', 'li', 'span']:
            classes = attrs_dict.get('class', '')
            if 'toc' in classes.lower() or 'nav' in classes.lower():
                self.in_toc = True
        
        # Find section links
        if tag == 'a':
            href = attrs_dict.get('href', '')
            title = ''
            
            # Check for data attributes
            data_title = attrs_dict.get('data-title', '')
            if data_title:
                title = data_title
            
            # Look for href patterns
            if href and ('r_' in href or 'sldworks' in href.lower()):
                self.sections.append({
                    'href': href,
                    'title': title or 'Unknown'
                })

def fetch_with_proxies():
    """Fetch with better headers and potential proxy support"""
    url = "https://help.solidworks.com/2025/chinese/SolidWorks/sldworks/r_welcome_sw_online_help.htm"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching: {e}", file=sys.stderr)
        return None

def parse_fallback(html_content):
    """Fallback parsing method"""
    import re
    
    sections = []
    
    # Try multiple patterns
    patterns = [
        r'href=["\']([^"\']*r_[^"\']*\.(?:htm|html))["\'][^>]*>.*?</a>',
        r'<a[^>]*href=["\']([^"\']+)["\'][^>]*>.*?</a>',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, html_content, re.IGNORECASE)
        for match in matches:
            if 'r_' in match or 'sldworks' in match.lower():
                sections.append({
                    'href': match,
                    'title': f'Section from {match}'
                })
    
    return sections

def save_toc_structure(sections, output_file="docs/solidworks-toc.json"):
    """Save the TOC structure"""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(sections, f, ensure_ascii=False, indent=2)
    
    print(f"✅ Saved {len(sections)} sections to {output_file}")
    return len(sections)

def main():
    print("🌐 Fetching SolidWorks 2025 Help (Chinese) TOC...")
    
    # Try main fetch
    html = fetch_with_proxies()
    
    if not html:
        print("❌ Failed to fetch page")
        sys.exit(1)
    
    print(f"📄 Fetched {len(html)} characters")
    
    # Parse using multiple methods
    print("🔍 Parsing TOC structure...")
    sections = []
    
    # Method 1: HTML Parser
    parser = SolidWorksTOCParser()
    parser.feed(html)
    sections.extend(parser.sections)
    
    # Method 2: Fallback regex
    if len(sections) < 5:
        print("⚠️  HTML parser found few sections, trying regex...")
        sections.extend(parse_fallback(html))
    
    # Remove duplicates
    seen = set()
    unique_sections = []
    for section in sections:
        if section['href'] not in seen:
            seen.add(section['href'])
            unique_sections.append(section)
    
    if unique_sections:
        count = save_toc_structure(unique_sections)
        
        print(f"\n📊 Found {count} sections:")
        print("-" * 80)
        
        # Group by common patterns
        main_sections = [s for s in unique_sections if 'r_' in s['href'] and 'sldworks' in s['href']]
        print(f"🔗 Main sections: {len(main_sections)}")
        
        # Show first 30
        for i, section in enumerate(main_sections[:30], 1):
            print(f"{i:2d}. {section['href'][:60]:60s}")
        
        if len(main_sections) > 30:
            print(f"   ... and {len(main_sections) - 30} more")
    else:
        print("❌ No sections found. Saving raw HTML for manual inspection...")
        with open("docs/solidworks_raw.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("   → Saved to docs/solidworks_raw.html")

if __name__ == "__main__":
    main()
