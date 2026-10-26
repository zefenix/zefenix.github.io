# Testing Pages, Piled

Four scripts check the reader in real browsers through Playwright core. None needs a package install or a second test framework.

## Setup

Point Node at an installed Playwright core and its browsers:

```sh
export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core
export PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers
```

Build the reader first, then test the build:

```sh
python3 source/build_release.py source/reader-artifact.html pages-piled/paged.min.js OUT
```

The build lands in `OUT/site/pages-piled`, written `BUILD` below. `source/package.json` stops Node from reading a broken `package.json` in a folder above the repository.

Each script gives its browsers a HOME and TMPDIR of their own, so Firefox can make its profile inside a sandbox. Each closes every browser it opens and reports the browser process count before and after.

## The scripts

`node source/check_lists.js BUILD --browsers=chromium,firefox` is the existing check. It covers list markers, All pages, the header across widths, the desktop bar on every page, the theme and dock, Scroll, Listen's keys and chapter-relative page names. The `--lists-only`, `--header-only`, `--desktop-only`, `--tools-only`, `--listen-only` and `--names-only` flags run one part. Reader faults it has found print as `KNOWN FAULT`, and `--strict` makes them fail.

`node source/check_phone.js BUILD --baseline=OLD_BUILD` runs the feature tests for the phone design and text round. Each test runs in a fresh phone context, Chromium at 390 pixels unless the test says otherwise, with real touch sent through the DevTools protocol. With `--baseline`, every test also runs on the released build, where it must fail. A test marked `baselineMayPass` names why it cannot fail there. `--module=bars,reading,faults` picks the test files and `--only=id,id` picks tests.

- `phone_tests_bars.js` covers the bars, Options, Zen, the slider's sides, peeks, swipes and the minimap by touch.
- `phone_tests_reading.js` covers the reading zone, Listen, search jumps, sections, spreads, the pile, the colophon and the book's text.
- `phone_tests_faults.js` holds the reader faults the other scripts found.

A test marked `fault` shows a reader fault. It is expected to fail on the new build until the reader is fixed, and the runner says when it starts passing.

`node source/check_layout.js BUILD` sweeps the phone layout. It covers Chromium with phone emulation at 320 to 540 pixels in steps of 10, plus 360, 384, 390, 393, 402, 412, 414, 440, 522 and an 844 × 390 landscape phone. It also covers WebKit at 390, 393, 402 and 440, and Firefox, layout only, at 360, 412 and 522. In each of 14 reader states it checks for sideways scrolling and for controls that are cut off, covered, off screen or unreachable. It measures every visible control's tap area with the phone rig's sampled hit square (`hit_square.js`). `--tap-rule=44` fails a square confirmed below 44 pixels; the default only reports it. `--engines=`, `--widths=` and `--states=` narrow the sweep. A state the sweep cannot reach gets one more try from a fresh load; a layout fault is never retried. Known reader faults print as `KNOWN FAULT`, and `--strict` makes them fail. The JSON lands in `.evidence/layout/layout.json`.

WebKit needs eight system packages: libevent-2.1-7t64, libgstreamer-plugins-base1.0-0, libgstreamer-gl1.0-0, libgstreamer-plugins-bad1.0-0, libharfbuzz-icu0, libmanette-0.2-0, libenchant-2-2 and libhyphen0. The sweep refuses to launch it unless each reports `install ok installed`.

## Offline

`check_phone.js` and `check_layout.js` serve the build from a private HTTP origin and abort every other request, so Google Fonts and jsDelivr never load and fallback fonts set the book. `check_lists.js` opens the build from disk and blocks every web request. Speech is a silent stub, so Listen runs without voices.

## How long a full run takes

These times were measured one script at a time on a 12-core machine with a load average near 40:

| Command | Time |
| --- | --- |
| `check_phone.js BUILD --baseline=OLD_BUILD` | about 4 minutes (255 s) |
| `check_lists.js BUILD --browsers=chromium,firefox` | about 45 minutes (2724 s) |
| `check_layout.js BUILD` | about 20 minutes (1202 s); WebKit alone takes 5 |

Outputs go to `.evidence/` unless `--evidence=` names another folder.
