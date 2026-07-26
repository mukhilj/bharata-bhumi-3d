/* ————————————————————————————————————————————————————————————
   India: Relief & Physical Features — Indian subcontinent in 3D
   Terrain: SRTM30_PLUS (Scripps/UCSD) 30-arc-second land + ocean elevation
   Frame:   60–100°E, 5°S–40°N · 72 tiles of 5°×5° · int16 metres
   ———————————————————————————————————————————————————————————— */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ————— geographic frame constants ————— */
const LON0 = 60, LON1 = 100, LAT0 = -5, LAT1 = 40;
const COLS = 8, ROWS = 9, TILE = 5, TP = 600;      // tile grid, samples per side (601 incl. edge)
const CLON = 80, CLAT = 17.5;                      // projection centre
const KLON = Math.cos(20 * Math.PI / 180);         // E–W metre compression at mid-latitudes
const M = 1 / 111320;                              // metres → world units (1 unit ≈ 1° ≈ 111 km)

let EXAG = 12;                                     // vertical exaggeration (slider)
const hpm = () => EXAG * M;                        // world-height per metre

const toX = lon => (lon - CLON) * KLON;
const toZ = lat => (CLAT - lat);                   // north = −Z

/* ————— renderer / scene / camera ————— */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 55, 140);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 400);
camera.position.set(0, 30, 34);
const clock = new THREE.Clock();

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.getElementById('labels').appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.15;
controls.maxDistance = 90;
controls.target.set(0, 0, 2);
controls.screenSpacePanning = true;
// one-finger drag pans the map (like a real map app); two fingers rotate/tilt & zoom
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
// mouse: left drag pans (Google-Maps style), right drag (or two-finger trackpad) rotates/tilts
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  lineMats.forEach(m => m.resolution.set(w, h));
}
addEventListener('resize', resize);

/* ————— CPU elevation store + bilinear sampler ————— */
const tileData = new Array(COLS * ROWS).fill(null);   // Int16Array(601*601), row 0 = tile's north edge

function heightAt(lon, lat) {                          // metres (negative = sea floor)
  if (lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) return null;
  const c = Math.min(COLS - 1, Math.floor((lon - LON0) / TILE));
  const r = Math.min(ROWS - 1, Math.floor((LAT1 - lat) / TILE));
  const d = tileData[r * COLS + c];
  if (!d) return 0;
  const fx = (lon - (LON0 + c * TILE)) / TILE * TP;
  const fy = (LAT1 - r * TILE - lat) / TILE * TP;
  const x0 = Math.max(0, Math.min(TP - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(TP - 1, Math.floor(fy)));
  const tx = fx - x0, ty = fy - y0, W = TP + 1;
  const a = d[y0 * W + x0],     b = d[y0 * W + x0 + 1];
  const e = d[(y0 + 1) * W + x0], f = d[(y0 + 1) * W + x0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (e * (1 - tx) + f * tx) * ty;
}

/* ————— terrain shaders: per-pixel hypsometric tint + shading from the
         full-resolution elevation texture, independent of mesh density ————— */
const VERT = /* glsl */`
uniform sampler2D uElev;
uniform vec2  uOrigin;      // lon of west edge, lat of north edge
uniform float uExag;
attribute float aSkirt;
varying vec2 vUV;
varying vec2 vLL;
void main(){
  vec2 q = position.xy;                          // 0..1 across the tile
  vUV = (q * 600.0 + 0.5) / 601.0;
  float e = texture2D(uElev, vUV).r;
  float lon = uOrigin.x + q.x * ${TILE.toFixed(1)};
  float lat = uOrigin.y - q.y * ${TILE.toFixed(1)};
  vLL = vec2(lon, lat);
  float y = e * uExag / 111320.0 - aSkirt * 0.15;
  vec3 p = vec3((lon - ${CLON.toFixed(1)}) * ${KLON.toFixed(6)}, y, (${CLAT.toFixed(1)} - lat));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uElev;
uniform sampler2D uBasins;
uniform float uExag;
uniform float uBasinMix;
uniform vec3  uSun;
varying vec2 vUV;
varying vec2 vLL;

vec3 seg(float e, float a, float b, vec3 ca, vec3 cb){ return mix(ca, cb, clamp((e-a)/(b-a),0.,1.)); }
vec3 ramp(float e){
  // ocean
  if (e < 0.0){
    if (e < -4000.0) return seg(e,-6500.,-4000., vec3(.027,.149,.290), vec3(.067,.251,.420));
    if (e < -2000.0) return seg(e,-4000.,-2000., vec3(.067,.251,.420), vec3(.161,.369,.588));
    if (e <  -200.0) return seg(e,-2000., -200., vec3(.161,.369,.588), vec3(.369,.620,.796));
    return               seg(e, -200.,     0., vec3(.369,.620,.796), vec3(.573,.773,.871));
  }
  // land — school-atlas hypsometric convention
  if (e <  150.) return seg(e,    0.,  150., vec3(.239,.478,.247), vec3(.388,.631,.380));
  if (e <  300.) return seg(e,  150.,  300., vec3(.388,.631,.380), vec3(.616,.757,.514));
  if (e <  600.) return seg(e,  300.,  600., vec3(.616,.757,.514), vec3(.851,.820,.471));
  if (e < 1000.) return seg(e,  600., 1000., vec3(.851,.820,.471), vec3(.910,.769,.435));
  if (e < 1500.) return seg(e, 1000., 1500., vec3(.910,.769,.435), vec3(.851,.620,.337));
  if (e < 2500.) return seg(e, 1500., 2500., vec3(.851,.620,.337), vec3(.690,.435,.259));
  if (e < 3800.) return seg(e, 2500., 3800., vec3(.690,.435,.259), vec3(.541,.353,.235));
  if (e < 5000.) return seg(e, 3800., 5000., vec3(.541,.353,.235), vec3(.659,.604,.549));
  if (e < 5600.) return seg(e, 5000., 5600., vec3(.659,.604,.549), vec3(1.,1.,1.));
  return vec3(1.);
}

void main(){
  float e = texture2D(uElev, vUV).r;
  float ts = 1.0/601.0;
  float ex1 = texture2D(uElev, vUV + vec2(ts,0.)).r;
  float ex0 = texture2D(uElev, vUV - vec2(ts,0.)).r;
  float ey1 = texture2D(uElev, vUV + vec2(0.,ts)).r;
  float ey0 = texture2D(uElev, vUV - vec2(0.,ts)).r;
  float k = uExag / 111320.0;
  float dx = 2.0 * ${(TILE / TP).toFixed(6)} * ${KLON.toFixed(6)};
  float dz = 2.0 * ${(TILE / TP).toFixed(6)};
  vec3 dPdx = vec3(dx, (ex1-ex0)*k, 0.0);
  vec3 dPdz = vec3(0.0, (ey1-ey0)*k, dz);
  vec3 n = normalize(cross(dPdz, dPdx));
  float diff = max(dot(n, normalize(uSun)), 0.0);
  vec3 col = ramp(e) * (0.55 + 0.55 * diff);
  // river-basin overlay, sampled by global lon/lat
  if (uBasinMix > 0.001){
    vec2 buv = vec2((vLL.x - 60.0) / 40.0, 1.0 - (40.0 - vLL.y) / 45.0);
    vec4 b = texture2D(uBasins, buv);
    col = mix(col, b.rgb * (0.6 + 0.5 * diff), b.a * uBasinMix);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/* shared tile grid geometry with a perimeter skirt (hides LOD seams) */
function makeGrid(n) {
  const verts = [], skirt = [], idx = [];
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { verts.push(i / n, j / n, 0); skirt.push(0); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  let base = (n + 1) * (n + 1);
  const edges = [
    Array.from({ length: n + 1 }, (_, i) => at(i, 0)),
    Array.from({ length: n + 1 }, (_, i) => at(i, n)),
    Array.from({ length: n + 1 }, (_, j) => at(0, j)),
    Array.from({ length: n + 1 }, (_, j) => at(n, j)),
  ];
  for (const e of edges) {
    for (const v of e) { verts.push(verts[v * 3], verts[v * 3 + 1], 0); skirt.push(1); }
    for (let k = 0; k < n; k++) {
      const a = e[k], b = e[k + 1], a2 = base + k, b2 = base + k + 1;
      idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);   // both windings — always visible
    }
    base += n + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  g.setIndex(idx);
  return g;
}
const GEO_HI = makeGrid(240), GEO_MID = makeGrid(96), GEO_LO = makeGrid(30);

const basinTex = new THREE.TextureLoader().load('data/basins.png');
basinTex.colorSpace = THREE.NoColorSpace;
const SUN = new THREE.Vector3(-0.55, 0.72, -0.55);   // from the north-west, as on printed maps
const tileMats = [];

function buildTile(c, r, int16) {
  const f = new Float32Array((TP + 1) * (TP + 1));
  for (let i = 0; i < f.length; i++) f[i] = int16[i];
  const tex = new THREE.DataTexture(f, TP + 1, TP + 1, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  const canLinear = renderer.extensions.get('OES_texture_float_linear');
  tex.magFilter = canLinear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.minFilter = canLinear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uElev: { value: tex },
      uBasins: { value: basinTex },
      uOrigin: { value: new THREE.Vector2(LON0 + c * TILE, LAT1 - r * TILE) },
      uExag: { value: EXAG },
      uBasinMix: { value: 0 },
      uSun: { value: SUN },
    },
  });
  tileMats.push(mat);

  const lod = new THREE.LOD();
  for (const [geo, dist] of [[GEO_HI, 0], [GEO_MID, 7.5], [GEO_LO, 19]]) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;                       // GPU displacement breaks CPU bounds
    lod.addLevel(mesh, dist);
  }
  // place LOD anchor at tile centre so distance switching is honest
  lod.position.set(toX(LON0 + c * TILE + TILE / 2), 0, toZ(LAT1 - r * TILE - TILE / 2));
  lod.children.forEach(m => m.position.set(-lod.position.x, 0, -lod.position.z));
  scene.add(lod);
}

/* translucent sea surface at 0 m */
const water = new THREE.Mesh(
  new THREE.PlaneGeometry((LON1 - LON0) * KLON, LAT1 - LAT0),
  new THREE.MeshBasicMaterial({ color: 0x3a7fb8, transparent: true, opacity: 0.22, depthWrite: false })
);
water.rotation.x = -Math.PI / 2;
water.position.set(toX((LON0 + LON1) / 2), 0.001, toZ((LAT0 + LAT1) / 2));
scene.add(water);

/* ————— draped line + label helpers ————— */
const lineMats = [];
const draped = [];                                    // registry for re-draping on exaggeration change

function lineMaterial(color, width, dashed = false) {
  const m = new LineMaterial({ color, linewidth: width, dashed,
    dashSize: 0.28, gapSize: 0.14, alphaToCoverage: false });
  m.resolution.set(innerWidth, innerHeight);
  lineMats.push(m);
  return m;
}

function drapePositions(lonlat, lift) {
  const pos = [];
  for (const [lon, lat] of lonlat) {
    const e = Math.max(heightAt(lon, lat) ?? 0, 0);
    pos.push(toX(lon), e * hpm() + lift * hpm() * 8 + 0.004, toZ(lat));
  }
  return pos;
}

function drapedLine(lonlat, mat, lift = 4) {          // lift ≈ metres ×8×exag visual clearance
  const pts = [];
  for (let i = 0; i < lonlat.length; i++) {           // resample long segments for faithful draping
    pts.push(lonlat[i]);
    if (i < lonlat.length - 1) {
      const [x0, y0] = lonlat[i], [x1, y1] = lonlat[i + 1];
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const n = Math.floor(d / 0.05);
      for (let k = 1; k <= n; k++) pts.push([x0 + (x1 - x0) * k / (n + 1), y0 + (y1 - y0) * k / (n + 1)]);
    }
  }
  const inFrame = pts.filter(p => p[0] >= LON0 && p[0] <= LON1 && p[1] >= LAT0 && p[1] <= LAT1);
  if (inFrame.length < 2) return null;
  const g = new LineGeometry();
  g.setPositions(drapePositions(inFrame, lift));
  const line = new Line2(g, mat);
  line.computeLineDistances();
  draped.push({ line, lonlat: inFrame, lift });
  return line;
}

function redrape() {
  for (const d of draped) {
    d.line.geometry.setPositions(drapePositions(d.lonlat, d.lift));
    d.line.computeLineDistances();
  }
  for (const p of peakPins) {
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm();
  }
  for (const p of capitalPins) {
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm() + 0.01;
  }
  for (const p of cityPins) {
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm() + 0.008;
  }
  for (const p of monsoonPins) {
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm() + p.lift * hpm() * 8 + p.off;
  }
  for (const p of [...rainJulPins, ...rainJanPins, ...rainAnnualPins]) {
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm() + 0.009;
  }
  for (const l of surfaceLabels) {
    const e = Math.max(heightAt(l.lon, l.lat) ?? 0, 0);
    l.obj.position.y = e * hpm() + 0.02;
  }
  water.position.y = 0.001;
}

function makeLabel(html, cls, lon, lat, yWorld) {
  const div = document.createElement('div');
  div.className = 'lbl ' + cls;
  div.innerHTML = html;
  const o = new CSS2DObject(div);
  o.position.set(toX(lon), yWorld, toZ(lat));
  return o;
}

const surfaceLabels = [];                             // labels that sit on the terrain
function surfaceLabel(html, cls, lon, lat) {
  const e = Math.max(heightAt(lon, lat) ?? 0, 0);
  const o = makeLabel(html, cls, lon, lat, e * hpm() + 0.02);
  surfaceLabels.push({ obj: o, lon, lat });
  return o;
}

/* ————— layer groups ————— */
const G = {
  peaks: new THREE.Group(), him3: new THREE.Group(), ranges: new THREE.Group(),
  rivers: new THREE.Group(), physio: new THREE.Group(), seas: new THREE.Group(),
  basins: new THREE.Group(), states: new THREE.Group(), cities: new THREE.Group(),
  monsoon: new THREE.Group(),
  rainJul: new THREE.Group(), rainJan: new THREE.Group(), rainAnnual: new THREE.Group(),
};
Object.values(G).forEach(g => { g.visible = false; scene.add(g); });

const peakPins = [];
const capitalPins = [];
const cityPins = [];
const monsoonPins = [];                               // floating labels + calendar rings (height only)
const monsoonFlows = [];                               // guide line + drifting arrow sprites per flow
const monsoonMarkers = [];                             // per-place onset/withdrawal rings
const rainJulPins = [], rainJanPins = [], rainAnnualPins = [];
const fmtIN = n => n.toLocaleString('en-IN');

/* rainfall dot colour: dry tan → green → blue → violet for extreme totals */
function rainColor(mm) {
  if (mm < 200) return 0xd9a066;
  if (mm < 500) return 0xd9c467;
  if (mm < 1000) return 0x8bc34a;
  if (mm < 1500) return 0x4fc3f7;
  if (mm < 2500) return 0x2f80ce;
  if (mm < 5000) return 0x7e57c2;
  return 0xff4da6;
}
const rainRadius = mm => THREE.MathUtils.clamp(0.018 + Math.sqrt(mm) / 500, 0.018, 0.055);

function buildRainfallLayer(rainfall, group, pins, field) {
  for (const st of rainfall) {
    const mm = st[field];
    const dot = new THREE.Mesh(new THREE.CircleGeometry(rainRadius(mm), 16),
      new THREE.MeshBasicMaterial({ color: rainColor(mm) }));
    dot.rotation.x = -Math.PI / 2;
    const e = Math.max(heightAt(st.lon, st.lat) ?? 0, 0);
    dot.position.set(toX(st.lon), e * hpm() + 0.009, toZ(st.lat));
    const note = st.note ? ` <span class="note">${st.note}</span>` : '';
    const label = makeLabel(`${st.n} <span class="mm">${mm.toLocaleString('en-IN')} mm</span>${note}`,
      'rain', st.lon, st.lat, 0);
    label.position.set(0, 0.035, 0);
    label.center.set(0, 0.5);
    dot.add(label);
    pins.push({ obj: dot, lon: st.lon, lat: st.lat });
    group.add(dot);
  }
}

async function buildOverlays() {
  const [peaks, ranges, rivers, lakes, labels, trap, basins, states, capitals, cities, monsoon, calendar, rainfall] = await Promise.all(
    ['peaks', 'ranges', 'rivers', 'lakes', 'labels', 'trap', 'basins', 'states', 'capitals', 'cities', 'monsoon', 'monsoon_calendar', 'rainfall']
      .map(n => fetch('data/' + n + '.json').then(r => r.json()))
  );

  /* peaks — pin + name + official spot height */
  const pinGeo = new THREE.ConeGeometry(0.018, 0.09, 6);
  for (const p of peaks) {
    const major = ['Mount Everest', 'K2 (Godwin-Austen)', 'Kangchenjunga', 'Nanda Devi', 'Anamudi', 'Nanga Parbat'].includes(p.n);
    const colr = p.g === 'karakoram' ? 0xb39ddb : p.g === 'peninsula' ? 0x80cbc4 : 0xffffff;
    const pin = new THREE.Mesh(pinGeo, new THREE.MeshBasicMaterial({ color: colr }));
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    pin.position.set(toX(p.lon), e * hpm(), toZ(p.lat));
    pin.rotation.x = Math.PI;
    const note = p.note ? `<span class="note">${p.note}</span>` : '';
    const lbl = makeLabel(`▲ ${p.n} <span class="h">${fmtIN(p.h)} m</span>${note}`, 'peak', p.lon, p.lat, 0);
    lbl.position.set(0, 0.05, 0);      // relative to the pin, not the world
    lbl.center.set(0.5, 1.35);
    pin.add(lbl);
    pin.userData.major = major;
    peakPins.push({ obj: pin, lon: p.lon, lat: p.lat });
    G.peaks.add(pin);
  }

  /* the three Himalayan ranges + other ranges — crest lines with labels */
  for (const rg of ranges) {
    const grp = rg.g === 'him3' ? G.him3 : G.ranges;
    const mat = lineMaterial(rg.c, rg.g === 'him3' ? 4.5 : 3.2, rg.g === 'him3');
    const ln = drapedLine(rg.pts, mat, 12);
    if (ln) grp.add(ln);
    const mid = rg.pts[Math.floor(rg.pts.length / 2)];
    const l = surfaceLabel(rg.n, 'range', mid[0], mid[1]);
    l.element.style.color = rg.c;
    grp.add(l);
  }

  /* rivers + display-name corrections (Indian usage) */
  const rename = { 'Ganges': 'Ganga', 'Cauvery': 'Kaveri', 'Penner': 'Pennar',
    'Mahäna Nadï': 'Mahanadi', 'Godävari': 'Godavari', 'Ghäghara': 'Ghaghara',
    'Sapt': 'Kosi', 'Dihang': 'Dihang (Brahmaputra)', 'Kolidam': 'Kollidam', 'Tista': 'Teesta' };
  const labelThese = new Set(['Indus', 'Jhelum', 'Chenab', 'Ravi', 'Beas', 'Sutlej', 'Ganga', 'Yamuna',
    'Ghaghara', 'Gandak', 'Kosi', 'Son', 'Chambal', 'Betwa', 'Brahmaputra', 'Teesta', 'Narmada', 'Tapi',
    'Mahanadi', 'Godavari', 'Krishna', 'Bhima', 'Tungabhadra', 'Kaveri', 'Pennar', 'Mahi', 'Luni',
    'Indravati', 'Wainganga', 'Brahmani', 'Subarnarekha', 'Dihang (Brahmaputra)', 'Irrawaddy', 'Salween', 'Mahaweli']);
  const rvMat = lineMaterial(0x41b6f0, 2.4);
  const rvMatMajor = lineMaterial(0x64ccff, 3.2);
  const seen = new Set();
  for (const rv of rivers) {
    const name = rename[rv.name] || rv.name;
    const major = ['Indus', 'Ganga', 'Brahmaputra', 'Godavari', 'Krishna', 'Narmada', 'Kaveri', 'Mahanadi', 'Tapi'].includes(name);
    let longest = null;
    for (const line of rv.lines) {
      const ln = drapedLine(line, major ? rvMatMajor : rvMat, 3);
      if (ln) G.rivers.add(ln);
      if (!longest || line.length > longest.length) longest = line;
    }
    if (name && labelThese.has(name) && !seen.has(name) && longest) {
      seen.add(name);
      const mid = longest[Math.floor(longest.length / 2)];
      if (mid[0] > LON0 && mid[0] < LON1 && mid[1] > LAT0 && mid[1] < LAT1)
        G.rivers.add(surfaceLabel(name, 'river', mid[0], mid[1]));
    }
  }

  /* lakes — filled at surface height */
  for (const lk of lakes) {
    for (const ring of lk.rings) {
      if (ring.length < 4) continue;
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(shape);
      const pos = g.attributes.position;
      const base = [];
      for (let i = 0; i < pos.count; i++) {
        const lon = pos.getX(i), lat = pos.getY(i);
        base.push([lon, lat]);
        const e = Math.max(heightAt(lon, lat) ?? 0, 0);
        pos.setXYZ(i, toX(lon), e * hpm() + 0.006, toZ(lat));
      }
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2f8fce, side: THREE.DoubleSide }));
      mesh.userData.base = base;
      G.rivers.add(mesh);
      draped.push({ line: { geometry: g, computeLineDistances(){} }, lonlat: base, lift: 0,
        // lake meshes re-drape through the same registry via a custom setPositions shim
      });
      draped[draped.length - 1].line.geometry.setPositions = arr => {
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, arr[i * 3], arr[i * 3 + 1] + 0.002, arr[i * 3 + 2]);
        pos.needsUpdate = true;
      };
    }
  }

  /* region + sea labels */
  for (const lb of labels) {
    if (lb.k === 'sea') G.seas.add(surfaceLabel(lb.n, 'sea', lb.lon, lb.lat));
    else G.physio.add(surfaceLabel(lb.n, 'physio', lb.lon, lb.lat));
  }

  /* Deccan Traps outline */
  const trapLn = drapedLine(trap.outline, lineMaterial(0xff7043, 3.4, true), 10);
  if (trapLn) G.physio.add(trapLn);
  G.physio.add(surfaceLabel('DECCAN TRAPS · lava plateau', 'trap', 76.2, 19.6));

  /* basin legend + labels */
  const ul = document.getElementById('basin-list');
  for (const b of basins) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${b.color}"></span>${b.name}<span class="a">${b.area_lakh_km2.toFixed(2)}</span>`;
    ul.appendChild(li);
    if (b.lon) G.basins.add(surfaceLabel(b.name + ' basin', 'basin', b.lon, b.lat));
  }

  /* state / UT boundaries — dashed outline draped over the terrain */
  const stateMat = lineMaterial(0xe8edf4, 1.6, true);
  for (const st of states) {
    for (const ring of st.rings) {
      const ln = drapedLine(ring, stateMat, 6);
      if (ln) G.states.add(ln);
    }
  }

  /* state / UT capitals — dot marker + name, gold star for the national capital */
  const capGeo = new THREE.CircleGeometry(0.026, 16);
  const capGeoNat = new THREE.CircleGeometry(0.045, 5);
  for (const cap of capitals) {
    const isNat = !!cap.national;
    const dot = new THREE.Mesh(isNat ? capGeoNat : capGeo,
      new THREE.MeshBasicMaterial({ color: isNat ? 0xffd54f : 0xf2dfae }));
    dot.rotation.x = -Math.PI / 2;
    const e = Math.max(heightAt(cap.lon, cap.lat) ?? 0, 0);
    dot.position.set(toX(cap.lon), e * hpm() + 0.01, toZ(cap.lat));
    const html = (isNat ? '★ ' : '● ') + cap.n +
      (isNat ? ` <span class="note">National Capital</span>` : ` <span class="note">${cap.s}</span>`);
    const label = makeLabel(html, 'capital' + (isNat ? ' national' : ''), cap.lon, cap.lat, 0);
    label.position.set(0, 0.045, 0);
    label.center.set(0, 0.5);
    dot.add(label);
    capitalPins.push({ obj: dot, lon: cap.lon, lat: cap.lat });
    G.states.add(dot);
  }

  /* other important cities — smaller, dimmer dot than a capital */
  const cityGeo = new THREE.CircleGeometry(0.016, 12);
  const cityDotMat = new THREE.MeshBasicMaterial({ color: 0xaebbcf });
  for (const city of cities) {
    const dot = new THREE.Mesh(cityGeo, cityDotMat);
    dot.rotation.x = -Math.PI / 2;
    const e = Math.max(heightAt(city.lon, city.lat) ?? 0, 0);
    dot.position.set(toX(city.lon), e * hpm() + 0.008, toZ(city.lat));
    const label = makeLabel('· ' + city.n, 'city', city.lon, city.lat, 0);
    label.position.set(0, 0.03, 0);
    label.center.set(0, 0.5);
    dot.add(label);
    cityPins.push({ obj: dot, lon: city.lon, lat: city.lat });
    G.cities.add(dot);
  }

  /* monsoon wind flows — a faint guide path plus a stream of small arrows
     that continuously drift along it; which flows are live is driven by
     the monsoon-calendar clock (see updateMonsoonAnim), not fixed here */
  for (const m of monsoon) {
    const mat = lineMaterial(m.c, 1.4, true);
    mat.transparent = true; mat.opacity = 0.35;
    const ln = drapedLine(m.pts, mat, m.lift);
    if (ln) G.monsoon.add(ln);

    const arrows = [];
    for (let i = 0; i < 6; i++) {
      const div = document.createElement('div');
      div.className = 'lbl mon-arrow';
      div.innerHTML = `<span style="color:${m.c}">&#10148;</span>`;
      const obj = new CSS2DObject(div);
      obj.glyph = div.firstElementChild;
      G.monsoon.add(obj);
      arrows.push({ obj, phase: i / 6 });
    }

    const mid = m.pts[Math.floor(m.pts.length / 2)];
    const label = makeLabel(m.n + ` <span class="note">${m.note}</span>`, 'monsoon', mid[0], mid[1], 0);
    G.monsoon.add(label);
    monsoonPins.push({ obj: label, lon: mid[0], lat: mid[1], lift: m.lift, off: 0.06 });

    monsoonFlows.push({ pts: m.pts, lift: m.lift, doyStart: m.doyStart, doyEnd: m.doyEnd, line: ln, arrows, label });
  }

  /* monsoon calendar — per-place onset/withdrawal rings, revealed by the clock */
  const calRingGeo = new THREE.RingGeometry(0.026, 0.042, 20);
  const branchColor = { arabian: 0x3fa9f5, bay: 0x2f8fce, both: 0x64b5f6, ne: 0xff7043 };
  for (const c of calendar) {
    const ring = new THREE.Mesh(calRingGeo,
      new THREE.MeshBasicMaterial({ color: branchColor[c.branch] ?? 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const note = c.note ? ` <span class="note">${c.note}</span>` : '';
    const label = makeLabel(`${c.n} <span class="note">onset ${c.onset} · withdraws ${c.withdraw}</span>${note}`,
      'monsoon', c.lon, c.lat, 0);
    label.position.set(0, 0.045, 0);
    label.center.set(0, 0.5);
    ring.add(label);
    G.monsoon.add(ring);
    monsoonPins.push({ obj: ring, lon: c.lon, lat: c.lat, lift: 0, off: 0.012 });
    monsoonMarkers.push({ obj: ring, onsetDoy: c.onsetDoy, withdrawDoy: c.withdrawDoy, n: c.n });
  }
  for (const p of monsoonPins) {                       // set initial height (same formula as redrape)
    const e = Math.max(heightAt(p.lon, p.lat) ?? 0, 0);
    p.obj.position.y = e * hpm() + p.lift * hpm() * 8 + p.off;
  }

  /* rainfall received — same stations, three independent layers (Jul / Jan / annual) */
  buildRainfallLayer(rainfall, G.rainJul, rainJulPins, 'jul');
  buildRainfallLayer(rainfall, G.rainJan, rainJanPins, 'jan');
  buildRainfallLayer(rainfall, G.rainAnnual, rainAnnualPins, 'annual');
}

/* ————— peak-label decluttering by distance ————— */
function updatePeakVisibility() {
  if (!G.peaks.visible) return;
  for (const p of peakPins) {
    const d = camera.position.distanceTo(p.obj.position);
    p.obj.children[0].visible = p.obj.userData.major || d < 13;
  }
}

/* ————— elevation probe: touch the land to read its height ————— */
const probeEl = document.getElementById('probe');
const probeMark = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 24),
  new THREE.MeshBasicMaterial({ color: 0xe6b34d, side: THREE.DoubleSide }));
probeMark.rotation.x = -Math.PI / 2;
probeMark.visible = false;
scene.add(probeMark);

function probe(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let tPrev = 0, hit = null;
  for (let t = 0.02; t < 160; t += Math.max(0.01, t * 0.012)) {
    const p = o.clone().addScaledVector(d, t);
    const lon = p.x / KLON + CLON, lat = CLAT - p.z;
    const e = heightAt(lon, lat);
    if (e === null) { tPrev = t; continue; }
    if (p.y <= e * hpm()) {                            // crossed the surface — bisect
      let lo = tPrev, hi = t;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2, q = o.clone().addScaledVector(d, m);
        const el = heightAt(q.x / KLON + CLON, CLAT - q.z);
        (el !== null && q.y <= el * hpm()) ? hi = m : lo = m;
      }
      const q = o.clone().addScaledVector(d, hi);
      hit = { p: q, lon: q.x / KLON + CLON, lat: CLAT - q.z };
      break;
    }
    tPrev = t;
  }
  if (!hit) { probeEl.hidden = true; probeMark.visible = false; return; }
  const e = Math.round(heightAt(hit.lon, hit.lat));
  const latS = Math.abs(hit.lat).toFixed(1) + '°' + (hit.lat >= 0 ? 'N' : 'S');
  const lonS = hit.lon.toFixed(1) + '°E';
  probeEl.innerHTML = e >= 0
    ? `<span class="big">${fmtIN(e)} m</span> above sea level<br><span class="pos">${latS}, ${lonS}</span>`
    : `sea floor, <span class="big">${fmtIN(-e)} m</span> deep<br><span class="pos">${latS}, ${lonS}</span>`;
  probeEl.hidden = false;
  probeEl.style.left = Math.min(clientX + 14, innerWidth - 190) + 'px';
  probeEl.style.top = Math.max(clientY - 54, 8) + 'px';
  probeMark.position.copy(hit.p).y += 0.005;
  probeMark.visible = true;
}
let downAt = null;
canvas.addEventListener('pointerdown', e => downAt = [e.clientX, e.clientY, Date.now()]);
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const [x, y, t] = downAt;
  if (Math.hypot(e.clientX - x, e.clientY - y) < 6 && Date.now() - t < 400) probe(e.clientX, e.clientY);
  downAt = null;
});

/* ————— UI wiring ————— */
const ly = id => document.getElementById(id);
ly('ly-peaks').onchange = e => G.peaks.visible = e.target.checked;
ly('ly-him3').onchange = e => G.him3.visible = e.target.checked;
ly('ly-ranges').onchange = e => G.ranges.visible = e.target.checked;
ly('ly-rivers').onchange = e => G.rivers.visible = e.target.checked;
ly('ly-physio').onchange = e => G.physio.visible = e.target.checked;
ly('ly-seas').onchange = e => G.seas.visible = e.target.checked;
ly('ly-states').onchange = e => G.states.visible = e.target.checked;
ly('ly-cities').onchange = e => G.cities.visible = e.target.checked;
ly('ly-monsoon').onchange = e => {
  G.monsoon.visible = e.target.checked;
  document.getElementById('monsoon-panel').hidden = !e.target.checked;
};
ly('ly-rain-jul').onchange = e => G.rainJul.visible = e.target.checked;
ly('ly-rain-jan').onchange = e => G.rainJan.visible = e.target.checked;
ly('ly-rain-annual').onchange = e => G.rainAnnual.visible = e.target.checked;
ly('ly-basins').onchange = e => {
  const on = e.target.checked;
  G.basins.visible = on;
  document.getElementById('basin-legend').hidden = !on;
  tileMats.forEach(m => m.uniforms.uBasinMix.value = on ? 0.85 : 0);
};

const exagIn = document.getElementById('exag');
exagIn.addEventListener('input', () => {
  EXAG = +exagIn.value;
  document.getElementById('exag-out').textContent = EXAG + '×';
  tileMats.forEach(m => m.uniforms.uExag.value = EXAG);
});
exagIn.addEventListener('change', redrape);

/* camera journeys */
const VIEWS = {
  all:    { pos: [0, 30, 34],                target: [0, 0, 2] },
  him:    { pos: [toX(81), 6.5, toZ(21.5)],  target: [toX(82), 0.35, toZ(29.5)] },
  plains: { pos: [toX(80), 5.2, toZ(17.5)],  target: [toX(80), 0.05, toZ(26)] },
  deccan: { pos: [toX(76.6), 5.6, toZ(6.5)], target: [toX(77.5), 0.06, toZ(16)] },
  coast:  { pos: [toX(80), 9.5, toZ(-1)],    target: [toX(79), 0, toZ(12)] },
};
let fly = null;
document.querySelectorAll('.presets button').forEach(b => b.onclick = () => {
  const v = VIEWS[b.dataset.view];
  fly = { t: 0, p0: camera.position.clone(), p1: new THREE.Vector3(...v.pos),
          c0: controls.target.clone(), c1: new THREE.Vector3(...v.target) };
});

/* ————— directional pad: translate camera + target together in screen space,
         so you can travel across the map at any zoom level, not just spin in place ————— */
const panState = { up: false, down: false, left: false, right: false };
const _panRight = new THREE.Vector3(), _panUp = new THREE.Vector3(), _panOffset = new THREE.Vector3();

function panStep(dx, dz) {                          // dx: +right/-left, dz: +away/-toward (screen-space)
  const dist = camera.position.distanceTo(controls.target);
  const speed = dist * 0.028;                        // scales with zoom, like drag-panning does
  _panRight.setFromMatrixColumn(camera.matrix, 0);
  _panUp.setFromMatrixColumn(camera.matrix, 1);
  _panOffset.set(0, 0, 0)
    .addScaledVector(_panRight, dx * speed)
    .addScaledVector(_panUp, dz * speed);
  camera.position.add(_panOffset);
  controls.target.add(_panOffset);
}

function bindHold(id, state, key) {
  const el = document.getElementById(id);
  const start = ev => { ev.preventDefault(); state[key] = true; el.classList.add('held'); };
  const stop  = ()  => { state[key] = false; el.classList.remove('held'); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}
bindHold('pad-up', panState, 'up'); bindHold('pad-down', panState, 'down');
bindHold('pad-left', panState, 'left'); bindHold('pad-right', panState, 'right');

/* ————— tilt buttons: pitch the camera around the target — up toward the
         horizon so relief stands up, down toward a flat top-down view ————— */
const tiltState = { up: false, down: false };
const _tiltOffset = new THREE.Vector3(), _tiltSph = new THREE.Spherical();

function tiltStep(dir) {                            // dir: +1 up (toward horizon), -1 down (toward top-down)
  _tiltOffset.copy(camera.position).sub(controls.target);
  _tiltSph.setFromVector3(_tiltOffset);
  _tiltSph.phi = THREE.MathUtils.clamp(_tiltSph.phi + dir * 0.018, controls.minPolarAngle, controls.maxPolarAngle);
  _tiltOffset.setFromSpherical(_tiltSph);
  camera.position.copy(controls.target).add(_tiltOffset);
}
bindHold('tilt-up', tiltState, 'up'); bindHold('tilt-down', tiltState, 'down');

/* turn buttons: spin the view sideways around the target (azimuth), same
   feel as the right-drag rotate but discoverable without a mouse/trackpad */
const rotState = { left: false, right: false };

function rotateStep(dir) {                           // dir: +1 turn right (clockwise), -1 turn left
  _tiltOffset.copy(camera.position).sub(controls.target);
  _tiltSph.setFromVector3(_tiltOffset);
  _tiltSph.theta -= dir * 0.018;
  _tiltOffset.setFromSpherical(_tiltSph);
  camera.position.copy(controls.target).add(_tiltOffset);
}
bindHold('rot-left', rotState, 'left'); bindHold('rot-right', rotState, 'right');

/* also let arrow keys pan — handy once a mouse/trackpad is set aside for a touch display */
addEventListener('keydown', e => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (map[e.key]) { panState[map[e.key]] = true; e.preventDefault(); }
});
addEventListener('keyup', e => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (map[e.key]) panState[map[e.key]] = false;
});

/* ————— compass: click to smoothly spin the view so North points up again,
         keeping current zoom and tilt exactly as they are ————— */
let northSpin = null;
document.getElementById('compass').addEventListener('click', () => {
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  let d = -sph.theta;
  d = Math.atan2(Math.sin(d), Math.cos(d));           // shortest turn direction
  northSpin = { t: 0, theta0: sph.theta, dTheta: d, phi: sph.phi, radius: sph.radius };
});

/* ————— monsoon calendar clock: drives which flows/arrows/markers show,
         and animates the arrow sprites drifting along their guide paths ————— */
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];   // doy of the 1st (non-leap year)
function doyToLabel(doy) {
  doy = Math.round(doy);
  let m = 11;
  for (let i = 0; i < 12; i++) if (doy < MONTH_START[i]) { m = i - 1; break; }
  return `${doy - MONTH_START[m] + 1} ${MONTH[m]}`;
}
function monsoonPhaseText(doy) {
  if (doy < 152) return 'pre-monsoon';
  if (doy < 182) return 'monsoon advancing across India';
  if (doy < 244) return 'monsoon fully established';
  if (doy < 288) return 'withdrawing from the Northwest';
  if (doy < 355) return 'retreating / Northeast Monsoon over Tamil Nadu';
  return 'monsoon season over';
}

function sampleFlow(pts, t) {                          // point + direction at fraction t along a lon/lat path
  const xz = pts.map(([lon, lat]) => [toX(lon), toZ(lat)]);
  let total = 0;
  const segLen = [];
  for (let i = 0; i < xz.length - 1; i++) {
    const d = Math.hypot(xz[i + 1][0] - xz[i][0], xz[i + 1][1] - xz[i][1]);
    segLen.push(d); total += d;
  }
  const target = t * total;
  let acc = 0;
  for (let i = 0; i < segLen.length; i++) {
    const segEnd = acc + segLen[i];
    if (segEnd >= target || i === segLen.length - 1) {
      const local = segLen[i] > 0 ? THREE.MathUtils.clamp((target - acc) / segLen[i], 0, 1) : 0;
      return {
        lon: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * local,
        lat: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * local,
        dirX: xz[i + 1][0] - xz[i][0], dirZ: xz[i + 1][1] - xz[i][1],
      };
    }
    acc = segEnd;
  }
  const [lon, lat] = pts[pts.length - 1];
  return { lon, lat, dirX: 1, dirZ: 0 };
}

const monsoonAnim = { doy: 196, playing: false, speed: 26, drift: 0 };   // doy/sec while playing
const monDoyEl = document.getElementById('mon-doy');
const monDateEl = document.getElementById('mon-date');
const monPlayBtn = document.getElementById('mon-play');
const monModeSw = document.getElementById('mon-mode-sw');
const monModeRetreat = document.getElementById('mon-mode-retreat');

function updateMonsoonAnim(dt) {
  if (!G.monsoon.visible) return;
  monsoonAnim.drift += dt;
  if (monsoonAnim.playing) {
    monsoonAnim.doy += dt * monsoonAnim.speed;
    if (monsoonAnim.doy > 365) monsoonAnim.doy = 140;
    monDoyEl.value = monsoonAnim.doy;
  }
  const doy = monsoonAnim.doy;
  const nearOnset = monsoonMarkers.filter(m => doy >= m.onsetDoy - 3 && doy <= m.onsetDoy + 3);
  const nearWithdraw = monsoonMarkers.filter(m => Math.abs(doy - m.withdrawDoy) <= 3);
  let text = `${doyToLabel(doy)} — ${monsoonPhaseText(doy)}`;
  if (nearOnset.length) text += ` · reaching ${nearOnset.map(m => m.n).join(', ')}`;
  else if (nearWithdraw.length) text += ` · retreating from ${nearWithdraw.map(m => m.n).join(', ')}`;
  monDateEl.textContent = text;
  monModeSw.classList.toggle('active', doy < 244);
  monModeRetreat.classList.toggle('active', doy >= 244);

  // screen-space heading for the arrow glyphs — same trick the compass needle uses,
  // since a CSS2D icon's own rotation isn't affected by the 3D camera at all
  const azDeg = controls.getAzimuthalAngle() * 180 / Math.PI;

  for (const f of monsoonFlows) {
    const active = doy >= f.doyStart && doy <= f.doyEnd;
    if (f.line) f.line.visible = active;
    f.label.visible = active;
    for (const a of f.arrows) {
      a.obj.visible = active;
      if (!active) continue;
      const t = (a.phase + monsoonAnim.drift * 0.12) % 1;
      const s = sampleFlow(f.pts, t);
      const e = Math.max(heightAt(s.lon, s.lat) ?? 0, 0);
      a.obj.position.set(toX(s.lon), e * hpm() + f.lift * hpm() * 8 + 0.01, toZ(s.lat));
      const bearingDeg = Math.atan2(s.dirX, -s.dirZ) * 180 / Math.PI;
      a.obj.glyph.style.transform = `rotate(${bearingDeg - 90 - azDeg}deg)`;
    }
  }
  for (const m of monsoonMarkers) m.obj.visible = doy >= m.onsetDoy - 1 && doy <= m.withdrawDoy;
}

monDoyEl.addEventListener('input', () => {
  monsoonAnim.playing = false;
  monPlayBtn.textContent = '▶ Play the season';
  monsoonAnim.doy = +monDoyEl.value;
});
monPlayBtn.addEventListener('click', () => {
  monsoonAnim.playing = !monsoonAnim.playing;
  monPlayBtn.textContent = monsoonAnim.playing ? '⏸ Pause' : '▶ Play the season';
});

/* SW / Retreating quick-toggle — jumps the calendar clock to a representative
   date for that phase rather than tracking two separate visibility systems */
function setMonsoonMode(doy) {
  monsoonAnim.playing = false;
  monPlayBtn.textContent = '▶ Play the season';
  monsoonAnim.doy = doy;
  monDoyEl.value = doy;
}
monModeSw.addEventListener('click', () => setMonsoonMode(196));       // 15 Jul — SW fully established
monModeRetreat.addEventListener('click', () => setMonsoonMode(288));  // 15 Oct — withdrawal meets NE monsoon

/* hypsometric legend */
(function drawRamp() {
  const cv = document.getElementById('ramp'), ctx = cv.getContext('2d');
  const stops = [[-6500, '#072649'], [-2000, '#295e96'], [0, '#92c5de'], [0.001, '#3d7a3f'],
    [300, '#9dc183'], [600, '#d9d178'], [1500, '#d99e56'], [2500, '#b06f42'],
    [3800, '#8a5a3c'], [5000, '#a89a8c'], [5600, '#ffffff'], [8800, '#ffffff']];
  const lo = -6500, hi = 8800, X = v => (v - lo) / (hi - lo) * cv.width;
  const g = ctx.createLinearGradient(0, 0, cv.width, 0);
  for (const [v, c] of stops) g.addColorStop((v - lo) / (hi - lo), c);
  ctx.fillStyle = g; ctx.fillRect(0, 6, cv.width, 18);
  ctx.fillStyle = '#93a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  for (const v of [-4000, 0, 2000, 5000, 8000]) {
    ctx.fillRect(X(v), 24, 1, 4);
    ctx.fillText(v === 0 ? '0 m' : (v / 1000) + ' km', X(v), 40);
  }
})();

/* ————— tile loading ————— */
async function loadTiles() {
  const bar = document.getElementById('loadbar'), msg = document.getElementById('loadmsg');
  let done = 0;
  const jobs = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) jobs.push([c, r]);
  const CONC = 8;
  await Promise.all(Array.from({ length: CONC }, async (_, k) => {
    for (let i = k; i < jobs.length; i += CONC) {
      const [c, r] = jobs[i];
      const buf = await fetch(`data/tiles/t${c}_${r}.bin`).then(x => {
        if (!x.ok) throw new Error('tile ' + x.status);
        return x.arrayBuffer();
      });
      const d = new Int16Array(buf);
      tileData[r * COLS + c] = d;
      buildTile(c, r, d);
      bar.style.width = (++done / jobs.length * 100) + '%';
      msg.textContent = `elevation tile ${done} / ${jobs.length}`;
    }
  }));
}

/* ————— boot ————— */
(async () => {
  resize();
  try {
    await loadTiles();
    await buildOverlays();
  } catch (err) {
    document.getElementById('loadmsg').textContent =
      'Could not load data. Start the app with:  python -m http.server  (see README)';
    console.error(err);
    return;
  }
  document.getElementById('loading').classList.add('done');
})();

const needle = document.getElementById('needle');
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (fly) {
    fly.t = Math.min(1, fly.t + 0.016);
    const s = fly.t * fly.t * (3 - 2 * fly.t);
    camera.position.lerpVectors(fly.p0, fly.p1, s);
    controls.target.lerpVectors(fly.c0, fly.c1, s);
    if (fly.t >= 1) fly = null;
  }
  if (panState.up || panState.down || panState.left || panState.right) {
    let dx = 0, dz = 0;
    if (panState.left) dx -= 1;
    if (panState.right) dx += 1;
    if (panState.up) dz += 1;
    if (panState.down) dz -= 1;
    panStep(dx, dz);
  }
  if (tiltState.up || tiltState.down) {
    if (tiltState.up) tiltStep(1);
    if (tiltState.down) tiltStep(-1);
  }
  if (rotState.left || rotState.right) {
    if (rotState.left) rotateStep(-1);
    if (rotState.right) rotateStep(1);
  }
  if (northSpin) {
    northSpin.t = Math.min(1, northSpin.t + 0.045);
    const s = northSpin.t * northSpin.t * (3 - 2 * northSpin.t);
    const theta = northSpin.theta0 + northSpin.dTheta * s;
    const off = new THREE.Vector3().setFromSphericalCoords(northSpin.radius, northSpin.phi, theta);
    camera.position.copy(controls.target).add(off);
    if (northSpin.t >= 1) northSpin = null;
  }
  controls.update();
  updatePeakVisibility();
  updateMonsoonAnim(dt);
  needle.setAttribute('transform',
    `rotate(${-controls.getAzimuthalAngle() * 180 / Math.PI} 20 20)`);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
