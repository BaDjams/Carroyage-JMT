import markdown
import sys
from pathlib import Path

md_path = Path("DOCUMENTATION.md")
html_path = Path("DOCUMENTATION.html")

md_text = md_path.read_text(encoding="utf-8")

extensions = [
    "toc",
    "tables",
    "fenced_code",
    "codehilite",
    "pymdownx.superfences",
    "pymdownx.tilde",
    "attr_list",
]

extension_configs = {
    "toc": {"title": "Table des matières", "toc_depth": "2-4"},
    "codehilite": {"guess_lang": False, "noclasses": True},
}

md = markdown.Markdown(extensions=extensions, extension_configs=extension_configs)
html_body = md.convert(md_text)

css = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
@page :first { margin: 0; }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1a202c;
}

/* COVER */
.cover {
  page-break-after: always;
  height: 297mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%);
  color: white;
  padding: 0 30mm;
}
.cover h1 {
  font-size: 42pt;
  margin: 0 0 8mm 0;
  font-weight: 700;
  letter-spacing: -0.5pt;
}
.cover .subtitle {
  font-size: 18pt;
  font-weight: 300;
  margin-bottom: 30mm;
  opacity: 0.95;
}
.cover .meta {
  font-size: 11pt;
  opacity: 0.85;
  line-height: 1.8;
}
.cover .meta strong { font-weight: 600; }

/* CONTENT */
.content { padding: 0 4mm; }

h1 {
  font-size: 22pt;
  color: #1e3a8a;
  border-bottom: 3px solid #2563eb;
  padding-bottom: 4mm;
  margin-top: 12mm;
  margin-bottom: 6mm;
  page-break-before: always;
  page-break-after: avoid;
}
h1:first-of-type { page-break-before: auto; }

h2 {
  font-size: 16pt;
  color: #1e40af;
  margin-top: 8mm;
  margin-bottom: 3mm;
  page-break-after: avoid;
  border-left: 4px solid #3b82f6;
  padding-left: 4mm;
}

h3 {
  font-size: 13pt;
  color: #2563eb;
  margin-top: 6mm;
  margin-bottom: 2mm;
  page-break-after: avoid;
}

h4 {
  font-size: 11.5pt;
  color: #1e40af;
  margin-top: 4mm;
  margin-bottom: 2mm;
  page-break-after: avoid;
}

p { margin: 2mm 0; orphans: 3; widows: 3; }

a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }

/* CODE */
code {
  font-family: "Consolas", "Courier New", monospace;
  background: #f1f5f9;
  color: #be185d;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9.5pt;
  word-break: break-word;
}
pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 4mm 5mm;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 8.8pt;
  line-height: 1.45;
  page-break-inside: avoid;
  margin: 3mm 0;
}
pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}

/* TABLES */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 3mm 0;
  font-size: 9.5pt;
  page-break-inside: avoid;
}
th {
  background: #2563eb;
  color: white;
  font-weight: 600;
  text-align: left;
  padding: 2mm 3mm;
  border: 1px solid #1e40af;
}
td {
  padding: 1.5mm 3mm;
  border: 1px solid #cbd5e1;
  vertical-align: top;
}
tr:nth-child(even) td { background: #f8fafc; }

/* LISTS */
ul, ol { margin: 2mm 0; padding-left: 7mm; }
li { margin: 0.5mm 0; }
li > p { margin: 1mm 0; }

/* BLOCKQUOTE */
blockquote {
  border-left: 4px solid #f59e0b;
  background: #fef3c7;
  padding: 3mm 5mm;
  margin: 3mm 0;
  font-style: italic;
  color: #78350f;
  page-break-inside: avoid;
}
blockquote p { margin: 1mm 0; }

hr {
  border: 0;
  border-top: 1px solid #cbd5e1;
  margin: 6mm 0;
}

/* TOC */
.toc {
  page-break-after: always;
  padding: 0 4mm;
}
.toc-title {
  font-size: 22pt;
  color: #1e3a8a;
  border-bottom: 3px solid #2563eb;
  padding-bottom: 4mm;
  margin-bottom: 6mm;
}
.toc ul {
  list-style: none;
  padding-left: 0;
}
.toc > ul > li { margin: 2mm 0; font-weight: 600; font-size: 11pt; color: #1e3a8a; }
.toc ul ul { padding-left: 6mm; margin: 1mm 0; }
.toc ul ul li { font-weight: 400; font-size: 10pt; color: #334155; margin: 0.5mm 0; }
.toc ul ul ul { padding-left: 5mm; }
.toc ul ul ul li { font-size: 9.5pt; color: #64748b; }
.toc a { color: inherit; }

strong { font-weight: 600; color: #1e293b; }
em { font-style: italic; }
"""

# Generate TOC HTML
toc_html = md.toc

cover_html = """
<div class="cover">
  <h1>Carroyage-JMT</h1>
  <div class="subtitle">Documentation technique<br>développeurs &amp; maintenance</div>
  <div class="meta">
    <div><strong>Version</strong> 22.12</div>
    <div><strong>Mise à jour</strong> 2026-05-05</div>
    <div><strong>Dépôt</strong> github.com/BaDjams/Carroyage-JMT</div>
  </div>
</div>
"""

toc_section = f"""
<div class="toc">
  <div class="toc-title">Table des matières</div>
  {toc_html}
</div>
"""

full_html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Carroyage-JMT — Documentation technique</title>
<style>{css}</style>
</head>
<body>
{cover_html}
{toc_section}
<div class="content">
{html_body}
</div>
</body>
</html>
"""

html_path.write_text(full_html, encoding="utf-8")
print(f"OK -> {html_path.resolve()}")
