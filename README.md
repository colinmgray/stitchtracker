# StitchTracker

A local-first web companion for cross-stitch PDF patterns. The current MVP reads
the embedded stitch colors from the bundled pattern, renders the original PDF,
lets you toggle highlights for every occurrence of one or more colors, and
tracks completed stitches locally on the device.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Pattern processing happens entirely in the browser.

## Current scope

- Loads the bundled two-page pattern automatically.
- Accepts another unlocked PDF with individually positioned stitch glyphs.
- Extracts and counts stitch colors without OCR.
- Displays glyph previews rasterized directly from the PDF to avoid font substitution.
- Samples each thread-color swatch from the color chart.
- Switches between pattern and color-chart views.
- Toggles color-matched highlights for any combination of colors.
- Paints and erases completed stitches for the active color.
- Shows per-color and whole-project completion totals.
- Saves progress automatically in browser storage and, during local development,
  an ignored `stitchtracker.progress.json` backup file.
- Can hide completed-cell overlays without changing saved progress.
- Shares a portable progress file through the native share sheet or download,
  and imports it on another device running the same pattern.
- Supports buttons or pinch gestures for zooming and two-finger panning.
- Supports both touchscreen pinch gestures and trackpad pinch-to-zoom.
- Keeps the color palette fixed beside the chart on tablet-sized screens.
- Filters the palette to colors present in the currently visible chart area.

Progress is stored per PDF fingerprint, so opening a different compatible chart
does not mix the two projects together.
