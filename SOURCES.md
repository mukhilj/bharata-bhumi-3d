# Sources

## Elevation & bathymetry
- **SRTM30_PLUS** (Scripps Institution of Oceanography, UC San Diego): global 30-arc-second
  (~1 km) topography and bathymetry. Land elevations derive from NASA/NGA **SRTM** (Shuttle
  Radar Topography Mission) and GTOPO30; ocean depths from ship soundings fused with
  satellite-gravity predictions. This is the dataset rendered as terrain, sea floor, and
  the source for the watershed (basin) computation.

## Rivers, lakes, seas, peak coordinates
- **Natural Earth 1:10m** public-domain dataset (rivers & lake centerlines, lakes,
  marine-region labels, elevation points). naturalearthdata.com

## Framing of physical features (used for layer design & labels)
- **NCERT Class 9 Geography, Ch. 2 "Physical Features of India"** — the six physiographic
  divisions (Himalayan Mountains, Northern Plains, Peninsular Plateau, Indian Desert,
  Coastal Plains, Islands) and the three parallel Himalayan ranges: **Himadri** (Greater,
  avg ~6,000 m), **Himachal** (Lesser, 3,700–4,500 m), **Shiwalik** (Outer, 900–1,200 m).
- **NCERT Class 11 "India: Physical Environment"** — Trans-Himalaya (Karakoram, Ladakh,
  Zanskar), Purvanchal, coastal-plain subdivisions.

## River basins
- Basin polygons were **computed from the elevation data** (D8 flow routing with river-course
  burning, watershed delineation). Each delineated basin's area was validated against
  official total-basin areas published by the **Central Water Commission / India-WRIS**
  (indiawris.gov.in), e.g. Ganga ~10.9, Indus ~11.2, Godavari 3.13, Krishna 2.59,
  Mahanadi 1.42, Narmada 0.99, Kaveri 0.81, Tapi 0.65 lakh km². Computed areas are shown
  beside official ones in the app legend.

## Peak heights (official spot heights)
- Mount Everest **8,848.86 m** — 2020 joint Nepal–China survey (shown as 8,849 m).
- K2 8,611 m; Kangchenjunga 8,586 m (highest in India); Nanda Devi 7,816 m (highest
  entirely within India); Anamudi 2,695 m (highest of the Western Ghats and peninsular
  India); Doddabetta 2,637 m; Guru Shikhar 1,722 m (Aravalli); Mahendragiri 1,501 m
  (Eastern Ghats) — per Survey of India–derived published values.

## Deccan Traps
- Extent (~5 lakh km² of flood basalts, ~66 million years old) after **Geological Survey
  of India** descriptions; the outline drawn in the app is an approximation for teaching.

## Known approximations
- 1 km cells average away summit spikes: the terrain under Everest reads ~8,650 m while the
  label carries the official 8,849 m. Narrow gorges (e.g. Srisailam) are also smoothed.
- Range crest-lines and the Deccan Traps outline are hand-digitised teaching aids, not
  survey products.
- Natural Earth river courses are generalised to 1:10m scale.
