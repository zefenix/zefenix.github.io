# Build the shelf's hosted books from their sources at pinned commits.
# usage: python3 source/books/build_books.py RUST_BOOK_CLONE COOKBOOKS_CLONE OUT
#   RUST_BOOK_CLONE  a clone of https://github.com/rust-lang/book at RUST_COMMIT
#   COOKBOOKS_CLONE  a clone of https://github.com/anthropics/claude-cookbooks at COOKBOOKS_COMMIT
#   OUT              the books folder, pages-piled/books
# Each book is one book.json with its chapters' Markdown, beside its licence files and any images it uses.
import json, os, re, shutil, subprocess, sys

RUST_COMMIT = "1500248d8f230566e4ec9f27fcbb8fe9e2898ab1"
COOKBOOKS_COMMIT = "bfe50e59dbb4f5546a0af9ca36ebb77e637c9ce1"

# The cookbook selection: first-party notebooks that are mostly prose and code, with no image, HTML or attachment
# outputs, so they read cleanly as Markdown.
NOTEBOOKS = [
    "tool_use/memory_cookbook.ipynb",
    "tool_use/automatic-context-compaction.ipynb",
    "tool_use/tool_choice.ipynb",
    "capabilities/contextual-embeddings/guide.ipynb",
    "patterns/agents/orchestrator_workers.ipynb",
    "claude_agent_sdk/08_Dynamic_workflows.ipynb",
    "claude_agent_sdk/scheduled_repository_reviewer/scheduled_repository_reviewer.ipynb",
    "observability/opentelemetry_tracing.ipynb",
]
OUTPUT_LINES = 24   # a code cell's text output is shown up to this many lines


def head(clone, want):
    got = subprocess.run(["git", "-C", clone, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    if got != want:
        sys.exit(f"{clone} is at {got}, not the pinned {want}")


def fences(lines):
    """Yield (line, info) where info is the open fence's info string, or None outside code."""
    info = None
    for line in lines:
        m = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
        if m:
            yield line, None if info is None else info
            info = m.group(2).strip() if info is None else None
            continue
        yield line, info


# ---------- The Rust Programming Language ----------

def include(spec, base):
    path, _, sel = spec.partition(":")
    lines = open(os.path.join(base, path), encoding="utf-8").read().split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if sel and not re.fullmatch(r"\d*(:\d*)?", sel):
        out, on = [], False
        for line in lines:
            if re.search(rf"ANCHOR:\s*{re.escape(sel)}\b", line):
                on = True
                continue
            if re.search(rf"ANCHOR_END:\s*{re.escape(sel)}\b", line):
                on = False
                continue
            if on:
                out.append(line)
        lines = out
    elif sel:
        a, _, b = sel.partition(":")
        start = int(a) - 1 if a else 0
        lines = lines[start:int(b)] if b else (lines[start:] if ":" in sel else lines[start:start + 1])
    return [l for l in lines if not re.search(r"ANCHOR(_END)?:", l)]


FERRIS = {"does_not_compile": "This code does not compile!", "panics": "This code panics!", "not_desired_behavior": "This code does not produce the desired behavior."}


def rust_chapter(path, src):
    base = os.path.dirname(path)
    lines = []
    for line in open(path, encoding="utf-8").read().split("\n"):
        m = re.fullmatch(r"\s*\{\{#(?:rustdoc_)?include\s+([^}]+?)\s*\}\}\s*", line)
        lines.extend(include(m.group(1), base) if m else [line])
    out, note = [], None
    for line, info in fences(lines):
        is_fence = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if is_fence and info is None:          # an opening fence
            tags = [t.strip() for t in re.split(r"[,\s]+", line.strip().lstrip("`~"))]
            note = next((FERRIS[t] for t in tags if t in FERRIS), None)
            out.append(line)
            continue
        if is_fence:                           # the closing fence, then the Ferris note
            out.append(line)
            if note:
                out += ["", f"*{note}*"]
            note = None
            continue
        if info is not None and info.startswith("rust"):
            if line.strip() == "#" or line.lstrip().startswith("# "):
                continue                       # a line rustdoc hides
            line = re.sub(r"^(\s*)##", r"\1#", line)
        out.append(line)
    md = "\n".join(out)
    # mdBook's listing blocks become a file name before the code and a caption after it.
    def listing(m):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        top = f"*Filename: {attrs['file-name']}*\n\n" if "file-name" in attrs else ""
        cap = f"\n\n*Listing {attrs.get('number', '')}: {attrs['caption']}*" if "caption" in attrs else ""
        return top + m.group(2).strip("\n") + cap
    md = re.sub(r"<Listing([^>]*)>\n?(.*?)\n?</Listing>", listing, md, flags=re.S)
    md = re.sub(r'<img src="img/ferris/[^"]*"[^>]*>', "", md)
    return md


def build_rust(clone, out):
    head(clone, RUST_COMMIT)
    src = os.path.join(clone, "src")
    dest = os.path.join(out, "rust-book")
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    # The book's own structure: front matter unnumbered, chapters 1 to 21 with their subchapters as 5.1, 5.2,
    # and appendices A to G. Each chapter and its subchapters are one group, which the reader keeps in one part.
    chapters, used = [], set()
    top, sub, group = 0, 0, "Front matter"
    for line in open(os.path.join(src, "SUMMARY.md"), encoding="utf-8").read().split("\n"):
        m = re.match(r"^(\s*)(?:-\s*)?\[([^\]]+)\]\(([^)\s]+\.md)\)", line)
        if not m:
            continue
        indent, title, file = len(m.group(1)), m.group(2), m.group(3)
        bullet = line.lstrip().startswith("-")
        if not bullet:
            shown, label = "", ""
        elif indent == 0 and title == "Appendix":
            group, shown, label = "Appendix", "", ""
        elif indent == 0:
            top, sub, group = top + 1, 0, re.sub(r"`([^`]*)`", r"\1", title)
            shown, label = str(top), f"Chapter {top}"
        elif group == "Appendix":
            letter = re.match(r"^([A-Z])\s*-\s*", title)
            shown, label = (letter.group(1), f"Appendix {letter.group(1)}") if letter else ("", "Appendix")
            if letter:
                title = title[letter.end():]
        else:
            sub += 1
            shown, label = f"{top}.{sub}", f"{top}.{sub}"
        title = re.sub(r"`([^`]*)`", r"\1", title)   # titles are plain text, without Markdown's code marks
        md = rust_chapter(os.path.join(src, file), src)
        used.update(re.findall(r'(?:src="|\]\()(img/[^")\s]+)', md))
        chapters.append({"title": title, "path": file, "group": group, "shown": shown, "label": label, "markdown": md})
    for img in sorted(used):
        os.makedirs(os.path.join(dest, os.path.dirname(img)), exist_ok=True)
        shutil.copyfile(os.path.join(src, img), os.path.join(dest, img))
    for f in ["LICENSE-MIT", "LICENSE-APACHE", "COPYRIGHT"]:
        shutil.copyfile(os.path.join(clone, f), os.path.join(dest, f))
    book = {
        "v": 1, "id": "rust-book", "title": "The Rust Programming Language", "byline": "Steve Klabnik, Carol Nichols and Chris Krycho, with contributions from the Rust Community",
        "site": "github.com/rust-lang/book", "url": f"https://github.com/rust-lang/book/tree/{RUST_COMMIT}",
        "copyright": "Copyright (c) 2010 The Rust Project Developers. Licensed under the MIT license or the Apache License, Version 2.0, at your option.",
        "notice": "Shown here unchanged apart from layout, from the book's source at commit " + RUST_COMMIT[:12] + ". Not affiliated with or endorsed by the Rust Project.",
        "licenses": ["LICENSE-MIT", "LICENSE-APACHE", "COPYRIGHT"], "chapters": chapters,
    }
    json.dump(book, open(os.path.join(dest, "book.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return book, len(used)


# ---------- Claude Cookbooks, a selection ----------

def notebook_md(path, repo_path):
    nb = json.load(open(path, encoding="utf-8"))
    lang = (nb.get("metadata", {}).get("kernelspec", {}).get("language") or "python").lower()
    blob = f"https://github.com/anthropics/claude-cookbooks/blob/{COOKBOOKS_COMMIT}/"
    parts = []
    for cell in nb["cells"]:
        text = "".join(cell.get("source", "")).rstrip()
        if not text:
            continue
        if cell["cell_type"] == "markdown":
            # Links to other files in the repository point to them on GitHub at the pinned commit.
            def fix(m):
                target = m.group(2)
                if re.match(r"^(https?:|mailto:|#)", target):
                    return m.group(0)
                full = os.path.normpath(os.path.join(os.path.dirname(repo_path), target))
                return f"{m.group(1)}({blob}{full})"
            parts.append(re.sub(r"(\[[^\]]*\])\(([^)\s]+)\)", fix, text))
        elif cell["cell_type"] == "code":
            parts.append(f"```{lang}\n{text}\n```")
            outs = []
            for o in cell.get("outputs", []):
                t = o.get("text") or o.get("data", {}).get("text/plain") or ""
                outs.append("".join(t) if isinstance(t, list) else t)
            out = "".join(outs).rstrip("\n")
            if out:
                lines = out.split("\n")
                if len(lines) > OUTPUT_LINES:
                    lines = lines[:OUTPUT_LINES] + [f"… {len(lines) - OUTPUT_LINES} more lines of output"]
                parts.append("*Output:*\n\n```text\n" + "\n".join(lines) + "\n```")
    return "\n\n".join(parts) + "\n"


def build_cookbooks(clone, out):
    head(clone, COOKBOOKS_COMMIT)
    dest = os.path.join(out, "claude-cookbooks")
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    registry = open(os.path.join(clone, "registry.yaml"), encoding="utf-8").read()
    chapters = []
    for p in NOTEBOOKS:
        m = re.search(r"- title: (.+)\n(?:  .*\n)*?  path: " + re.escape(p) + r"\n", registry)
        title = m.group(1).strip().strip("'\"").replace("''", "'") if m else os.path.basename(p)
        md = notebook_md(os.path.join(clone, p), p)
        if re.search(r"!\[|<img|data:image", md):
            sys.exit(f"{p} has images; it would not read cleanly")
        if not md.lstrip().startswith("#"):
            md = f"# {title}\n\n{md}"
        chapters.append({"title": title, "path": p.replace(".ipynb", ".md"), "markdown": md,
                         "source": f"https://github.com/anthropics/claude-cookbooks/blob/{COOKBOOKS_COMMIT}/{p}"})
    shutil.copyfile(os.path.join(clone, "LICENSE"), os.path.join(dest, "LICENSE"))
    book = {
        "v": 1, "id": "claude-cookbooks", "title": "Claude Cookbooks, a selection", "byline": "Eight notebooks from anthropics/claude-cookbooks, as Markdown",
        "site": "github.com/anthropics/claude-cookbooks", "url": f"https://github.com/anthropics/claude-cookbooks/tree/{COOKBOOKS_COMMIT}",
        "copyright": "Copyright (c) 2023 Anthropic. MIT License.",
        "notice": "Selected and converted from notebooks to Markdown for Pages, Piled, from commit " + COOKBOOKS_COMMIT[:12] + "; long outputs are shortened. Not affiliated with or endorsed by Anthropic.",
        "licenses": ["LICENSE"], "chapters": chapters,
    }
    json.dump(book, open(os.path.join(dest, "book.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return book


def main():
    rust_clone, cook_clone, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    rust, images = build_rust(rust_clone, out)
    cook = build_cookbooks(cook_clone, out)
    shelf = [{k: b[k] for k in ("id", "title", "byline", "site", "url", "copyright", "notice", "licenses")} | {"chapters": len(b["chapters"])} for b in (rust, cook)]
    json.dump(shelf, open(os.path.join(out, "shelf.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for b in (rust, cook):
        size = sum(len(c["markdown"]) for c in b["chapters"])
        print(f"{b['id']}: {len(b['chapters'])} chapters, {size:,} characters")
    print(f"rust images: {images}")


if __name__ == "__main__":
    main()
