# Testing Pages, Piled

Four scripts check the reader in real browsers through Playwright core: WebKit, Chromium with phone emulation, and Firefox, at phone and desktop widths. None needs a package install or a second test framework.

## Setup

Point Node at an installed Playwright core and its browsers:

```sh
export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core
export PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers
```

Inside a sandbox, Firefox also needs its own sandboxes off and a writable HOME:

```sh
export MOZ_DISABLE_CONTENT_SANDBOX=1 MOZ_DISABLE_GMP_SANDBOX=1 MOZ_DISABLE_RDD_SANDBOX=1 MOZ_DISABLE_SOCKET_PROCESS_SANDBOX=1
export HOME=/a/writable/folder
```

Build the reader first, then test the build:

```sh
python3 source/build_release.py source/reader-artifact.html pages-piled/paged.min.js OUT
```

The build lands in `OUT/site/pages-piled`, written `BUILD` below. `RELEASED` is the `pages-piled` folder of the released site, the build the phone tests compare against. `source/package.json` stops Node from reading a broken `package.json` in a folder above the repository.

Each script gives its browsers a HOME and TMPDIR of their own, closes every browser it opens, and reports the browser process count before and after. Start each with `timeout -k 10 SECONDS` so a stuck browser cannot hold the run.

WebKit needs eight system packages: libevent-2.1-7t64, libgstreamer-plugins-base1.0-0, libgstreamer-gl1.0-0, libgstreamer-plugins-bad1.0-0, libharfbuzz-icu0, libmanette-0.2-0, libenchant-2-2 and libhyphen0. The scripts refuse to launch it unless each reports `install ok installed`.

## The scripts

`node source/check_phone.js BUILD --baseline=RELEASED` runs the feature tests. Each test runs in a fresh context, Chromium at 390 pixels unless the test says otherwise, with real touch sent through the DevTools protocol. With `--baseline`, every test also runs on the released build, where it must fail through a failed assertion; a test marked `baselineMayPass` names why it may pass there, usually that the release already has the feature. `--module=bars,reading,faults,open` picks the test files, `--only=id,id` picks tests and `--jobs=N` sets how many run at once (4 by default).

- `phone_tests_bars.js` covers the bars, Options, Zen, the slider's sides, peeks, swipes and the minimap by touch.
- `phone_tests_reading.js` covers Listen, including its carrying on into a book's next part, search jumps, sections, spreads, the pile, the colophon and the book's text.
- `phone_tests_open.js` covers opening your own book in WebKit, Chromium and Firefox, each at 390 and 1440 pixels: Markdown files and a folder through the Library's own pickers and the browser's file chooser, a docs page handed over by the Library's real bookmarklet through `postMessage`, and a whole site gathered by the bookmarklet with two of its pages blocked, which the reader reports as pages that couldn't be read.
- `phone_tests_faults.js` holds the reader faults the other scripts found.

A test marked `fault` shows a reader fault. It is expected to fail on the new build through a failed assertion until the reader is fixed, and the runner says when it starts passing. A fault test that times out fails the run, since a timeout shows nothing about the fault.

`node source/check_lists.js BUILD --browsers=chromium,firefox` covers list markers, All pages, the header across widths, the desktop bar on every page, the theme and dock, Scroll, Listen's keys and chapter-relative page names. The `--lists-only`, `--header-only`, `--desktop-only`, `--tools-only`, `--listen-only` and `--names-only` flags run one part.

`node source/check_layout.js BUILD` sweeps the phone layout. It covers Chromium with phone emulation at 320 to 540 pixels in steps of 10, plus 360, 384, 390, 393, 402, 412, 414, 440, 522 and an 844 × 390 landscape phone. It also covers WebKit at 390, 393, 402 and 440, and Firefox, layout only, at 360, 412 and 522. In each of 14 reader states it checks for sideways scrolling and for controls that are cut off, covered, off screen or unreachable. It measures every visible control's tap area with the phone rig's sampled hit square (`hit_square.js`). `--tap-rule=44` fails a square confirmed below 44 pixels; the default only reports it. `--engines=`, `--widths=` and `--states=` narrow the sweep. A state the sweep cannot reach gets one more try from a fresh load; a layout fault is never retried. One known reader fault, `code-scroll`, prints as `KNOWN FAULT`: in plain text a code block scrolls sideways inside its own box, as it always has. `--strict` makes it fail.

`node source/check_shelf.js BUILD` runs the shelf's feature tests in `source/shelf_tests/`, each file as its own process per engine, with a HOME of its own and a 900-second limit. They cover r and R, the page dial, the bottom bar's fold, the Library's finding, keys, clicks and hiding, gn and gp across parts, the keys page, Listen into the next part, the outline's find, Options' readouts, search by keys, Strip's rest, the swipe up, the highlighter and Zen. `--engines=chromium,webkit,firefox` picks engines, `--only=name,name` picks tests, `--jobs=N` sets how many browsers run at once (3 by default) and `--limit=SECONDS` sets each process's limit. `gngp` and `findmore` time key pairs, so they run one at a time after the rest: with other browsers beside them the pairs split on a busy machine. `gngp` measures when its keys reached the page and presses a pair again, saying so, only when the two arrived 500 ms or more apart, which the reader rightly takes as two single keys. A test×engine in the runner's `FAULTS` shows a reader fault; none is listed now.

## Offline

`check_phone.js` and `check_layout.js` serve the build from a private HTTP origin and abort every other request, so Google Fonts and jsDelivr never load and fallback fonts set the book. The open tests also serve a docs site of their own at `http://docs.test` for the bookmarklet. `check_shelf.js` serves the build at `http://pp.test/pages-piled/` the same way. `check_lists.js` opens the build from disk and blocks every web request. Speech is a silent stub, so Listen runs without voices.

## How long a full run takes

These times were measured on build d89c52f, on a 12-core machine shared with other work, at the load averages shown:

| Command | Time | Load |
| --- | --- | --- |
| `check_phone.js BUILD --baseline=RELEASED` | about 42 minutes (2531 s) | 31 to 40, beside `check_lists.js` |
| `check_lists.js BUILD --browsers=chromium,firefox` | about 1 hour 54 minutes (6833 s) | 31 to 40, beside `check_phone.js` for 42 minutes |
| `check_layout.js BUILD` | about 32 minutes (1937 s), the three engines side by side: Chromium 1933 s, WebKit 1619 s, Firefox 915 s | not recorded, beside `check_lists.js` |
| `check_shelf.js BUILD` | about 40 minutes (2396 s) | 20 to 25, alone |

The times grow with the load: two suites at once, or other work on the machine, can double them. At these loads each full `check_shelf.js` run so far has failed one or two tests on timing, a different one each time and mostly in WebKit (hideshelf, readouts, searchkeys, trace, findmore), and each passed when run again with `--only`. Outputs go to `.evidence/` unless `--evidence=` names another folder.
