"""Build the public, data-free standalone page using only the Python stdlib."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'

def build():
    html = (SRC / 'template.html').read_text(encoding='utf-8')
    meta = json.loads((SRC / 'reference-meta.json').read_text(encoding='utf-8'))
    # Only schema definitions belong to the public artifact. Never ingest workbook values.
    allowed = {'index', 'key', 'category', 'ticker', 'id', 'field', 'unit', 'notation', 'column', 'label', 'mode'}
    assert len(meta) == 260 and all(set(m) <= allowed for m in meta)
    data = {'meta': [{**m, 'count': 0, 'zero_count': 0, 'note': ''} for m in meta],
            'dates': [], 'values': [], 'sourceRows': [],
            'source': {'name': '업로드 대기', 'sheet': 'DailyRate'}}
    css = (SRC / 'style.css').read_text(encoding='utf-8')
    html, count = re.subn(r'<link rel="stylesheet" href="style.css">', lambda _: '<style>\n' + css + '\n</style>', html)
    assert count == 1, 'Expected one stylesheet'
    html, count = re.subn(r'<script id="dataset" type="application/json">.*?</script>',
        lambda _: '<script id="dataset" type="application/json">' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c') + '</script>', html, flags=re.S)
    assert count == 1, 'Expected one empty dataset'
    def inline(match):
        filename = match[1]
        assert filename in {'jszip.min.js', 'excel-import.js', 'quant.js', 'spread-math.js', 'date-ranges.js', 'app.js'}, filename
        script = (SRC / filename).read_text(encoding='utf-8')
        assert not re.search(r'</script', script, re.I), filename
        return '<script data-module="' + filename + '">\n' + script + '\n</script>'
    html, count = re.subn(r'<script src="([^"]+)"></script>', inline, html)
    assert count == 6, 'Expected six scripts'
    assert not re.search(r'<script[^>]+src=', html)
    assert 'drive.google.com/' not in html and 'docs.google.com/spreadsheets/' not in html
    (ROOT / 'index.html').write_text(html, encoding='utf-8')
    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    (out / 'index.html').write_text(html, encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')
    print(f'Built data-free index.html ({len(html.encode()):,} bytes).')

if __name__ == '__main__':
    build()
