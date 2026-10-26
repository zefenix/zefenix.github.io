# Build the GitHub Pages release of the reader from the artifact source.
# usage: python build_release.py stack-reader.html paged.min.js out_dir
import sys, os, shutil
src, paged, out = sys.argv[1:4]
s = open(src, encoding='utf-8').read()

head_end = s.index('<div class="app loading"')
head, body = s[:head_end], s[head_end:]
head = head.replace('<title>Pages, Piled</title>\n', '').replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
assert body.count('<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.js"></script>') == 1
# The official paged.min.js names its global PagedModule; the reader calls Paged.
body = body.replace('<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.js"></script>', '<script src="paged.min.js"></script>\n<script>window.Paged = window.Paged || window.PagedModule;</script>')

icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2320384a'/%3E"
        "%3Crect x='4' y='11' width='4' height='12' rx='1' fill='%23eef2f3' opacity='.45'/%3E%3Crect x='9' y='8' width='5' height='17' rx='1' fill='%23eef2f3' opacity='.7'/%3E"
        "%3Crect x='14' y='5' width='4' height='22' rx='1' fill='%23eef2f3'/%3E%3Crect x='18' y='8' width='5' height='17' rx='1' fill='%23eef2f3' opacity='.7'/%3E"
        "%3Crect x='24' y='11' width='4' height='12' rx='1' fill='%23eef2f3' opacity='.45'/%3E%3C/svg%3E")
page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pages, Piled</title>
<meta name="description" content="A paged-reading prototype built on paged.js: the page you are reading stays in the middle, the rest of the book piled beside it.">
<link rel="icon" href="{icon}">
<style>body {{ margin: 0; }} [hidden] {{ display: none !important; }}</style>
{head.rstrip()}
</head>
<body>
{body.rstrip()}
</body>
</html>
'''
site = os.path.join(out, 'site', 'pages-piled')
os.makedirs(site, exist_ok=True)
open(os.path.join(site, 'index.html'), 'w', encoding='utf-8', newline='\n').write(page)
shutil.copyfile(paged, os.path.join(site, 'paged.min.js'))
print('built', os.path.join(site, 'index.html'), len(page))
