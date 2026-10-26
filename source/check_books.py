# Check that every book the site hosts carries its licence and notice, and that nothing else is hosted.
# usage: python3 source/check_books.py pages-piled
import json, os, sys

site = sys.argv[1]
books = os.path.join(site, 'books')
shelf = json.load(open(os.path.join(books, 'shelf.json'), encoding='utf-8'))
fails = []
listed = {b['id'] for b in shelf}
for name in sorted(os.listdir(books)):
    if os.path.isdir(os.path.join(books, name)) and name not in listed:
        fails.append(f'{name}: a folder under books/ that shelf.json does not list')
for entry in shelf:
    folder = os.path.join(books, entry['id'])
    book = json.load(open(os.path.join(folder, 'book.json'), encoding='utf-8'))
    for key in ('title', 'url', 'copyright', 'notice', 'licenses'):
        if not book.get(key):
            fails.append(f"{entry['id']}: book.json has no {key}")
    if book.get('url', '').count('/') < 4 or not book['url'].startswith('https://github.com/') or '/tree/' not in book['url']:
        fails.append(f"{entry['id']}: the source link does not name a commit on GitHub")
    if 'endorsed' not in book.get('notice', ''):
        fails.append(f"{entry['id']}: the notice does not say the book is not endorsed")
    for lic in book.get('licenses', []):
        path = os.path.join(folder, lic)
        if not os.path.isfile(path) or os.path.getsize(path) < 200:
            fails.append(f"{entry['id']}: licence file {lic} is missing or empty")
    text = ' '.join(open(os.path.join(folder, l), encoding='utf-8').read() for l in book.get('licenses', []) if os.path.isfile(os.path.join(folder, l)))
    if 'Permission is hereby granted' not in text and 'Apache License' not in text:
        fails.append(f"{entry['id']}: no recognised licence text")
    if {k: entry.get(k) for k in ('title', 'url', 'copyright', 'notice')} != {k: book.get(k) for k in ('title', 'url', 'copyright', 'notice')}:
        fails.append(f"{entry['id']}: shelf.json and book.json disagree")
    print(f"{entry['id']}: {len(book['chapters'])} chapters; licences {', '.join(book['licenses'])}; source {book['url']}")
for f in fails:
    print('FAIL', f)
print('books check:', 'FAILED' if fails else 'ok')
sys.exit(1 if fails else 0)
