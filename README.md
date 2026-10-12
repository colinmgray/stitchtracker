# StitchTracker

A local-first web companion for cross-stitch PDF patterns. The current MVP reads
the embedded stitch symbols from the bundled pattern, renders the original PDF,
and lets you toggle highlights for every occurrence of one or more symbols.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Pattern processing happens entirely in the browser.

## Current scope

- Loads the bundled two-page pattern automatically.
- Accepts another unlocked PDF with individually positioned stitch glyphs.
- Extracts and counts stitch symbol classes without OCR.
- Displays native glyphs from the PDF's embedded cross-stitch font.
- Samples each symbol's thread-color swatch from the color chart.
- Switches between symbol and color views.
- Toggles color-matched highlights for any combination of symbols.
- Supports zooming and responsive layouts.

Progress painting and persistent completion state are planned for the next slice.
