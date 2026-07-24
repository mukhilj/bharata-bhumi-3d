# Bhārata Bhūmi — Physical Features of the Indian Subcontinent in 3D

An interactive 3D physical map of the Indian subcontinent (60–100°E, 5°S–40°N) built from
real satellite-derived elevation data — land relief **and** ocean-floor bathymetry at
~1 km resolution — for Montessori elementary presentations.

## Running it (Windows / PowerShell)

The app must be served over HTTP (browsers block local binary files opened directly).
Python is all you need:

```powershell
cd path\to\india3d
python -m http.server 8000
```

Then open **http://localhost:8000** in Chrome or Edge. Everything runs locally and
offline — no internet needed after setup.

First load fetches ~55 MB of elevation tiles from disk (a few seconds), then it is fully
interactive.

## Using it

- **Drag** to rotate, **scroll/pinch** to zoom, **right-drag** to pan.
- **Click/tap the land** to read the exact elevation at that point (or the sea-floor depth).
- **Overlays panel** — each layer works like one page of the teacher-made transparency
  overlay maps: lift one at a time.
- **Vertical exaggeration** — at true scale the Earth is astonishingly smooth (Everest is a
  0.08 mm bump on a 1 m globe). The slider lets you show both truths: set it to 1× to see
  reality, raise it to ~12× to see structure. This contrast is itself a presentation.
- **Journeys** — preset camera flights to the Himalaya, the Northern Plains, the Deccan,
  and the coasts.

## What is real and what is approximate

| Element | Nature |
|---|---|
| Terrain & ocean floor | Real measured data (SRTM30_PLUS, ~1 km cells) |
| Rivers, lakes | Real mapped courses (Natural Earth 10 m) |
| River basins | Computed from the elevation data itself by watershed analysis; every basin's area was verified against official CWC/India-WRIS figures (shown in the legend, in lakh km²) |
| Peak heights | Official spot heights (e.g. Everest 8,849 m per the 2020 India–Nepal–China joint survey); the terrain cell under a peak reads slightly lower because each cell averages ~1 km² |
| Range crest-lines, Deccan Traps outline, region labels | Approximate, hand-placed for teaching clarity |

Political boundaries are deliberately absent — this is a physical map. If you later want
the official Survey of India boundary, it can be added as a layer.

## Files

```
index.html          app shell
css/style.css       interface
js/main.js          terrain engine + overlays (ES modules, no build step)
vendor/             three.js r170, vendored for offline use
data/tiles/*.bin    72 elevation tiles, 601×601 signed 16-bit metres
data/*.json|png     rivers, lakes, peaks, ranges, labels, basins
```
