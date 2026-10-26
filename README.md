# Pages, Piled

A paged-reading prototype. The page you are reading stays in the middle of the screen, and the rest of the book stands
beside it in two piles, read on the left and still to come on the right, so you can always see where you are.

Live: https://zefenix.github.io/pages-piled/

## What it does

- **Views:** Flow (pages turned inward, after Cover Flow) and Pile (pages lying flat), as single or facing pages;
  Scroll as a column of pages or as plain web text; and All pages as thumbnails.
- **Finding your way:** contents with chapter topics, a minimap, a page slider, a page box, search (words, phrases,
  regular expressions, absolute pages such as `p8`, chapter pages such as `c4.2`, sections such as `s4.2`, and `c4.`
  or `4.` to list what they could become), and `r` to return after a jump.
- **Listen:** reads aloud with the browser's own voices, a sentence at a time, in any view; `q` `w` step by sentence
  and `Q` `W` by paragraph, and the page stays where you scroll while `r` brings you back to the sentence being read.
- **Phones:** the same controls in two bars sized for a thumb, Options in tabs, Zen to hide the menus, panels that peek
  from the screen's edges and swipe away, and a reading zone in Scroll.
- **Looks:** system, light or dark; four colour themes (Slate, Sepia, Paper, Gray); six page sizes from Pocket to US
  Letter; Expand, focus mode and full screen for small screens.
- **Keys:** vim-style throughout (`h` `j` `k` `l`, `gg`, `G`, `/`, `n`), with smooth Surfingkeys-style gliding.

The status beside the arrows names the chapter and page within it: `c4.2` is chapter 4's second page. Page numbers follow the page size.

The book that ships inside it explains each of these, with the keys to try as you read.

## How it is built

One HTML file. The text is plain HTML in a `<template>`; [paged.js](https://pagedjs.org) 0.4.3 lays it into pages from
CSS `@page` rules, and a short script arranges those pages with CSS 3D transforms. The same text also becomes the Scroll
column, and every block carries a number in both, which is how search, topics, Listen and the minimap agree on where a
sentence is.

No build step and no server code: any static host works. To run it locally, serve the folder (for example
`python -m http.server`) and open `index.html`.

## License

MIT, copyright (c) 2026 zefenix: see [LICENSE](LICENSE). It covers everything here except
`pages-piled/paged.min.js`, which is [Paged.js](https://pagedjs.org) 0.4.3, MIT-licensed by the Coko Foundation under
its own notice.
