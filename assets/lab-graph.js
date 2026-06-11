/*
 * lab-graph.js — immersive "ink schematic" project graph for choatelabs.app.
 *
 * Full-viewport backdrop: a thin-hairline drafting constellation on
 * near-black paper. Slow idle spin, drag to rotate, pointer parallax,
 * scroll-synced focus.
 *
 *   import { mountLabGraph } from './lab-graph.js';
 *   const controls = mountLabGraph(el, {
 *     hub, nodes,
 *     focusPoint: { x: 0.68, y: 0.42 },   // optional, viewport fractions
 *     onFrame: ({ yawDeg, hoverLabel }) => {},  // optional, ~10Hz
 *   });
 *   controls.focus('id');   // highlight + ease that node toward focusPoint
 *   controls.focus(null);   // clear focus, resume idle
 *   controls.destroy();
 *
 * Colors come from CSS custom properties on :root (--ink, --accent,
 * --paper) and are re-read when prefers-color-scheme flips.
 */

import * as THREE from './vendor/three.module.min.js';

const TAU = Math.PI * 2;

const SEED = 0x5eed1ab;
// Long lens: flattens perspective so node sizes stay near-uniform and the
// diagram reads as drafting linework rather than a deep 3D blob.
const FOV = 21;
const NOMINAL_DIST = 14;         // used only for the initial-yaw heuristic
const BASE_TILT = 0.26;          // resting X tilt, radians
const AUTO_SPEED = 0.055;        // idle spin, rad/s
const RESUME_DELAY = 3000;       // ms of quiet before auto-rotation resumes
const DRAG_K = 0.0055;           // px -> radians
const LABEL_PX = 12.5;           // on-screen label size, CSS px
const TEX_SCALE = 3;             // label texture supersampling for HiDPI
const SPOKE_OPACITY = 0.3;
const CROSS_OPACITY = 0.15;
const DIM_LEVEL = 0.42;          // what "everything else" dims to under focus
const PARALLAX_YAW = 0.0436;     // ~2.5 degrees
const PARALLAX_PITCH = 0.03;
const FOCUS_DUR = 1000;          // ms, focus yaw ease
const INTRO_TOTAL = 1.5;         // s, intro fully settled

const FONT_STACK = '"SF Mono", "Cascadia Code", Menlo, Consolas, monospace';

// Per-kind visual parameters (world units / texture fractions).
const KINDS = {
  hub:     { scale: 0.4,  ringOpacity: 0.92, labelOpacity: 0.8,  labelPad: 25 },
  project: { scale: 0.27, ringOpacity: 0.88, labelOpacity: 0.74, labelPad: 19 },
  idea:    { scale: 0.2,  ringOpacity: 0.42, labelOpacity: 0.4,  labelPad: 15 },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */

// Deterministic PRNG so the layout (and screenshots) are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: pick('--ink', '#EAE3D2'),
    accent: pick('--accent', '#E08146'),
    paper: pick('--paper', '#14110B'),
  };
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
// Staggered intro envelope: 0 before `start`, eased 0..1 over `dur` seconds.
const phase = (t, start, dur) => easeOutCubic(clamp01((t - start) / dur));

// Ring sprites are drawn white and tinted via material.color, so theme
// and hover changes never require redrawing them.
function makeRingTexture({ size = 256, rings = [], dot = 0 }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  const cx = size / 2;
  for (const ring of rings) {
    g.beginPath();
    g.lineWidth = ring.width;
    g.setLineDash(ring.dash ? [ring.dash, ring.dash * 1.1] : []);
    g.arc(cx, cx, ring.r * size, 0, TAU);
    g.stroke();
  }
  g.setLineDash([]);
  if (dot > 0) {
    g.beginPath();
    g.arc(cx, cx, dot * size, 0, TAU);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Crisp filled dot for the ambient speck field — deliberately NOT a soft
// radial gradient; no glow, just a tiny ink fleck.
function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(16, 16, 11, 0, TAU);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Labels are baked in ink (or accent) with a faint paper halo so text
// stays legible where it crosses edge linework.
function makeLabelTexture(text, color, halo, padLeftPx) {
  const s = TEX_SCALE;
  const font = `${LABEL_PX * s}px ${FONT_STACK}`;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  const textW = g.measureText(text).width;
  c.width = Math.max(2, Math.ceil(textW + (padLeftPx + 4) * s));
  c.height = Math.ceil(LABEL_PX * 1.7 * s);
  g = c.getContext('2d'); // context resets when the canvas is resized
  g.font = font;
  g.textBaseline = 'middle';
  const x = padLeftPx * s;
  const y = c.height / 2 + s; // optical centering vs. ring
  g.lineJoin = 'round';
  g.lineWidth = 2.5 * s;
  g.strokeStyle = halo;
  g.globalAlpha = 0.85;
  g.strokeText(text, x, y);
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.fillText(text, x, y);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Deterministic layout: seed positions near a per-group anchor direction,
// then relax (pair repulsion + radial spring + weak same-group pull).
// Spread is wide — the figure is a full-viewport backdrop now.
function computeLayout(nodes, rand) {
  const groups = [...new Set(nodes.map((n) => n.group).filter(Boolean))];
  const groupDir = new Map();
  groups.forEach((gName, i) => {
    // Golden-angle spiral spreads group anchors evenly over the sphere.
    const phi = Math.acos(1 - 2 * ((i + 0.5) / groups.length));
    const theta = i * 2.399963 + rand() * 0.6;
    groupDir.set(gName, new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    ));
  });

  const pts = nodes.map((n) => {
    const radius = 2.35 + rand() * 0.95;
    const dir = groupDir.has(n.group)
      ? groupDir.get(n.group).clone()
      : new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    dir.x += (rand() - 0.5) * 1.2;
    dir.y += (rand() - 0.5) * 1.2;
    dir.z += (rand() - 0.5) * 1.2;
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    return { p: dir.multiplyScalar(radius), radius };
  });

  const force = pts.map(() => new THREE.Vector3());
  const d = new THREE.Vector3();
  const relax = (iters, minDist, radialK, groupK) => {
    for (let it = 0; it < iters; it++) {
      force.forEach((f) => f.set(0, 0, 0));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          d.subVectors(pts[i].p, pts[j].p);
          const len = d.length() || 1e-4;
          if (len < minDist) {
            // push overlapping neighbours apart
            d.multiplyScalar(((minDist - len) / len) * 0.5);
            force[i].add(d);
            force[j].sub(d);
          } else if (groupK && nodes[i].group && nodes[i].group === nodes[j].group) {
            // weak pull keeps same-group nodes loosely clustered
            d.multiplyScalar(-groupK);
            force[i].add(d);
            force[j].sub(d);
          }
        }
        const len = pts[i].p.length() || 1e-4;
        // spring toward preferred radius (also keeps nodes off the hub)
        force[i].addScaledVector(pts[i].p, ((pts[i].radius - len) / len) * radialK);
      }
      pts.forEach((pt, i) => pt.p.addScaledVector(force[i], 0.55));
    }
  };

  relax(100, 1.65, 0.12, 0.015);

  // Flatten vertically (viewports are wider than tall, or labels need the
  // horizontal room), recenter the cloud's mass on the hub, then relax
  // again so neither step reintroduces overlaps.
  const centroid = new THREE.Vector3();
  pts.forEach((pt) => { pt.p.y *= 0.78; centroid.add(pt.p); });
  centroid.divideScalar(pts.length || 1);
  pts.forEach((pt) => {
    pt.p.sub(centroid);
    pt.radius = THREE.MathUtils.clamp(pt.p.length(), 1.9, 3.2);
  });
  relax(60, 1.75, 0.08, 0);

  // Safety: never let a node sit on top of the hub, and keep nodes off the
  // Y rotation axis so none can permanently hide behind the hub.
  pts.forEach((pt) => {
    if (pt.p.length() < 1.5) pt.p.setLength(1.5);
    const rxz = Math.hypot(pt.p.x, pt.p.z);
    if (rxz < 1.1 && Math.abs(pt.p.y) < 1.1) {
      const s = 1.1 / Math.max(rxz, 1e-4);
      pt.p.x *= s;
      pt.p.z *= s;
    }
  });
  return pts.map((pt) => pt.p);
}

// Deterministic starting pose: of 36 candidate yaws, take the one that
// maximizes the minimum pairwise screen distance (hub included), so the
// first thing a visitor sees has no node eclipsed by another.
function pickInitialYaw(positions) {
  const cosT = Math.cos(BASE_TILT);
  const sinT = Math.sin(BASE_TILT);
  let bestYaw = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < 36; k++) {
    const yaw = (k / 36) * TAU;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const pts2 = [[0, 0]]; // hub
    for (const p of positions) {
      const x = p.x * cy + p.z * sy;
      const z0 = -p.x * sy + p.z * cy;
      const y = p.y * cosT - z0 * sinT;
      const z = p.y * sinT + z0 * cosT;
      const w = NOMINAL_DIST / (NOMINAL_DIST - z); // perspective toward +Z camera
      pts2.push([x * w, y * w]);
    }
    let score = Infinity;
    for (let i = 0; i < pts2.length; i++) {
      for (let j = i + 1; j < pts2.length; j++) {
        score = Math.min(score,
          Math.hypot(pts2[i][0] - pts2[j][0], pts2[i][1] - pts2[j][1]));
      }
    }
    if (score > bestScore) { bestScore = score; bestYaw = yaw; }
  }
  return bestYaw;
}

// Shorten a segment at both ends so edges stop at the rings.
function trimmedSegment(a, b, trimA, trimB) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  dir.divideScalar(len);
  return [
    a.clone().addScaledVector(dir, Math.min(trimA, len * 0.35)),
    b.clone().addScaledVector(dir, -Math.min(trimB, len * 0.35)),
  ];
}

// Sparse ambient speck shell: random directions, radius band, vertically
// flattened, pushed back in z so the field sits behind/around the graph.
function makeSpeckPositions(rand, count, rMin, rMax, zPush) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (v.lengthSq() < 1e-4) v.set(1, 0, 0);
    v.normalize().multiplyScalar(rMin + rand() * (rMax - rMin));
    v.y *= 0.8;
    v.z -= zPush;
    arr[i * 3] = v.x;
    arr[i * 3 + 1] = v.y;
    arr[i * 3 + 2] = v.z;
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* mount                                                               */

export function mountLabGraph(element, options) {
  const opts = options || {};
  const { hub, nodes = [] } = opts;
  const focusPoint = {
    x: (opts.focusPoint && Number.isFinite(opts.focusPoint.x)) ? opts.focusPoint.x : 0.66,
    y: (opts.focusPoint && Number.isFinite(opts.focusPoint.y)) ? opts.focusPoint.y : 0.44,
  };
  const onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null;

  // Renderer first: if WebGL context creation fails this throws
  // synchronously, before we touch the DOM.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  // pan-y: vertical swipes scroll the page natively; only horizontal
  // drags reach us. Never hijack scroll.
  canvas.style.touchAction = 'pan-y';

  if (getComputedStyle(element).position === 'static') {
    element.style.position = 'relative';
  }
  element.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  camera.position.set(0, 0, NOMINAL_DIST);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const tiltGroup = new THREE.Group();   // X tilt (drag up/down)
  const spinGroup = new THREE.Group();   // Y spin (idle + drag left/right)
  const fieldGroup = new THREE.Group();  // ambient specks, slower parallax spin
  tiltGroup.add(spinGroup);
  tiltGroup.add(fieldGroup);
  scene.add(tiltGroup);

  let theme = readTheme();
  const inkColor = new THREE.Color();
  const accentColor = new THREE.Color();

  /* ---------------- build geometry ---------------- */

  const rand = mulberry32(SEED);
  const positions = computeLayout(nodes, rand);

  const ringTextures = {
    hub: makeRingTexture({
      rings: [{ r: 0.42, width: 7 }, { r: 0.29, width: 6 }],
      dot: 0.075,
    }),
    project: makeRingTexture({
      rings: [{ r: 0.42, width: 7 }],
      dot: 0.085,
    }),
    idea: makeRingTexture({
      rings: [{ r: 0.42, width: 7, dash: 22 }],
      dot: 0.06,
    }),
  };

  const items = []; // hub + nodes, uniform shape

  function makeItem(data, kindName, position) {
    const kind = KINDS[kindName];
    const holder = new THREE.Group();
    holder.position.copy(position);

    const ringMat = new THREE.SpriteMaterial({
      map: ringTextures[kindName],
      transparent: true,
      opacity: kind.ringOpacity,
      depthTest: false,
      depthWrite: false,
    });
    const ring = new THREE.Sprite(ringMat);
    ring.scale.set(kind.scale, kind.scale, 1);
    ring.renderOrder = 3;
    holder.add(ring);

    const labelMat = new THREE.SpriteMaterial({
      transparent: true,
      opacity: kind.labelOpacity,
      depthTest: false,
      depthWrite: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.center.set(0, 0.5); // anchor left edge at the node, extend right
    label.renderOrder = 4;
    holder.add(label);

    spinGroup.add(holder);
    return {
      data, kind, kindName, holder, ring, ringMat, labelMat, label,
      texInk: null, texAccent: null,
      spokeMat: null, spokeRec: null,
      hoverT: 0,
      baseY: position.y, // portrait viewports stretch y at fit time
    };
  }

  const hubItem = makeItem(hub || { id: 'hub', label: '' }, 'hub', new THREE.Vector3());
  items.push(hubItem);
  const nodeItems = nodes.map((n, i) => {
    const item = makeItem(n, n.href ? 'project' : 'idea', positions[i]);
    items.push(item);
    return item;
  });
  const byId = new Map(nodeItems.map((it) => [it.data.id, it]));

  // Edges. Hub spokes are dashed materials (one each) so the intro can
  // dash-draw them and a hovered/focused node's spoke can brighten
  // independently. Cross-links get a material each too, for staggered
  // intro fade and focus dimming.
  const edgeRecs = [];   // every edge, rebuildable when ring scale changes
  const crossEdges = []; // { mat } subset, for staggered intro/dimming

  function makeEdge(aSrc, bSrc, trimA, trimB, matParams, renderOrder) {
    const [a, b] = trimmedSegment(aSrc, bSrc, trimA, trimB);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      ...matParams,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = renderOrder;
    spinGroup.add(line);
    const rec = { line, geo, mat, aSrc, bSrc, trimA, trimB, len: a.distanceTo(b) };
    edgeRecs.push(rec);
    return rec;
  }

  for (const item of nodeItems) {
    const rec = makeEdge(
      hubItem.holder.position, item.holder.position,
      KINDS.hub.scale * 0.46, item.kind.scale * 0.46,
      { opacity: SPOKE_OPACITY, dashSize: 1000, gapSize: 1e-3 }, 2
    );
    item.spokeMat = rec.mat;
    item.spokeRec = rec;
  }

  for (let i = 0; i < nodeItems.length; i++) {
    for (let j = i + 1; j < nodeItems.length; j++) {
      const gi = nodeItems[i].data.group;
      if (!gi || gi !== nodeItems[j].data.group) continue;
      const rec = makeEdge(
        nodeItems[i].holder.position, nodeItems[j].holder.position,
        nodeItems[i].kind.scale * 0.46, nodeItems[j].kind.scale * 0.46,
        { opacity: CROSS_OPACITY, dashSize: 0.07, gapSize: 0.055 }, 1
      );
      crossEdges.push({ mat: rec.mat });
    }
  }

  // Re-trim edge endpoints when the ring screen-compensation factor moves
  // (rings grow in world units when the camera fits far away on phones).
  function updateEdgeGeometries(f) {
    for (const rec of edgeRecs) {
      const [a, b] = trimmedSegment(rec.aSrc, rec.bSrc, rec.trimA * f, rec.trimB * f);
      const pos = rec.geo.attributes.position;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      rec.len = a.distanceTo(b);
      rec.line.computeLineDistances();
    }
  }

  // Ambient depth field: two sparse shells of static ink specks. No
  // connecting lines, no twinkle — just scale cues behind the figure.
  const dotTexture = makeDotTexture();
  const speckRand = mulberry32(SEED ^ 0x51d37e);
  const specks = [
    { count: 34, rMin: 4.5, rMax: 7,  zPush: 1.5, px: 2,   opacity: 0.12 },
    { count: 30, rMin: 8,   rMax: 12, zPush: 4,   px: 1.5, opacity: 0.08 },
  ].map((cfg) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      makeSpeckPositions(speckRand, cfg.count, cfg.rMin, cfg.rMax, cfg.zPush), 3));
    const mat = new THREE.PointsMaterial({
      map: dotTexture,
      size: cfg.px,
      sizeAttenuation: false,
      transparent: true,
      opacity: cfg.opacity,
      depthTest: false,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 0;
    fieldGroup.add(pts);
    return { geo, mat, pts, baseOpacity: cfg.opacity, basePx: cfg.px };
  });

  /* ---------------- theme ---------------- */

  let maxLabelPx = 60; // widest label texture in CSS px, feeds camera fit

  function applyTheme() {
    theme = readTheme();
    inkColor.set(theme.ink);
    accentColor.set(theme.accent);
    maxLabelPx = 60;
    for (const item of items) {
      if (item.texInk) item.texInk.dispose();
      if (item.texAccent) item.texAccent.dispose();
      const text = String(item.data.label ?? '').toLowerCase();
      item.texInk = makeLabelTexture(text, theme.ink, theme.paper, item.kind.labelPad);
      // Accent label for every node: hover uses it on links, focus() may
      // accent any node (ideas included).
      item.texAccent = makeLabelTexture(text, theme.accent, theme.paper, item.kind.labelPad);
      item.labelMat.map = item.texInk;
      item.labelMat.needsUpdate = true;
      if (item !== hubItem) {
        maxLabelPx = Math.max(maxLabelPx, item.texInk.image.width / TEX_SCALE);
      }
    }
    for (const s of specks) s.mat.color.copy(inkColor);
    fitCamera();
    requestRender();
  }

  /* ---------------- camera fit ---------------- */

  let worldPerPx = 0.0062; // world units per CSS px, recomputed on fit
  let camDist = NOMINAL_DIST;
  let ringScaleF = 1;      // ring screen-size compensation for distant fits
  let yStretch = 1;        // portrait viewports relax the layout's y-flatten
  let labelK = 1;          // narrow viewports shrink labels slightly
  let viewW = 0;
  let viewH = 0;

  // Auto-fit: choose camera distance so the bounding sphere plus a label
  // allowance fits the viewport, and park the figure center right of dead
  // center on wide screens (hero text lives on the left).
  function fitCamera() {
    if (!viewW || !viewH) return;
    const aspect = viewW / viewH;
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const portrait = aspect < 0.9;

    // Labels: ~12.5px on desktop, eased down a touch on narrow screens.
    labelK = THREE.MathUtils.clamp(viewW / 760, 0.84, 1);

    // Horizontal bound is the xz rotation circle (any node can swing to
    // either side); vertical bound is handled separately so tall screens
    // don't pay for width they don't have.
    let boundXZ = 1.5;
    let boundY0 = 1;
    for (const item of nodeItems) {
      const p = item.holder.position;
      boundXZ = Math.max(boundXZ, Math.hypot(p.x, p.z));
      boundY0 = Math.max(boundY0, Math.abs(item.baseY));
    }
    boundXZ += 0.3;
    boundY0 += 0.35;

    // Figure center: right of dead center on wide screens (hero text on
    // the left), slightly below center on portrait (headline on top).
    const cx = portrait
      ? 0.5
      : THREE.MathUtils.clamp(0.5 + 0.115 * (aspect - 0.85) / 0.85, 0.5, 0.615);
    const cy = portrait ? 0.62 : 0.5;

    // Label room reserved beyond the rightmost node, capped so narrow
    // screens don't push the camera into orbit.
    const labelPx = Math.min((maxLabelPx + 6) * labelK, viewW * (portrait ? 0.18 : 0.2));
    const mh = 0.95; // horizontal use fraction
    const mv = 0.9;  // vertical use fraction
    const labelTerm = (labelPx * 2 * tanV) / viewH; // world units per unit distance
    const rightDen = tanV * aspect * 2 * (1 - cx) * mh - labelTerm;
    const dRight = rightDen > 0.005 ? boundXZ / rightDen : 0;
    const dLeft = boundXZ / (tanV * aspect * 2 * cx * mh);
    const dVertMin = boundY0 / (2 * Math.min(cy, 1 - cy) * tanV * mv);
    camDist = THREE.MathUtils.clamp(Math.max(dRight, dLeft, dVertMin), 6, 90);

    // Stretch the cloud vertically to spend the leftover height: strong on
    // portrait (nodes spread down the tall viewport instead of colliding
    // in a flat band), gentle on wide screens.
    const vAvail = 2 * Math.min(cy, 1 - cy) * camDist * tanV * mv;
    const ys = THREE.MathUtils.clamp(vAvail / boundY0, 1, portrait ? 2 : 1.22);
    let geomDirty = false;
    if (Math.abs(ys - yStretch) > 0.005) {
      yStretch = ys;
      for (const item of nodeItems) item.holder.position.y = item.baseY * ys;
      geomDirty = true;
    }

    camera.position.set(0, 0, camDist);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    tiltGroup.position.x = (cx - 0.5) * 2 * camDist * tanV * aspect;
    tiltGroup.position.y = -(cy - 0.5) * 2 * camDist * tanV;
    // Keep labels pixel-locked: world units per CSS px at the focal plane.
    worldPerPx = (2 * camDist * tanV) / viewH;
    // When the camera fits far away (tall phones), partially compensate
    // ring sizes so they stay legible next to the pixel-locked labels.
    const f = THREE.MathUtils.clamp(Math.sqrt(camDist / 16), 1, 1.9);
    if (Math.abs(f - ringScaleF) > 0.01) {
      ringScaleF = f;
      geomDirty = true;
    }
    if (geomDirty) updateEdgeGeometries(ringScaleF);
    updateLabelScales();
  }

  function updateLabelScales() {
    for (const item of items) {
      const img = item.labelMat.map && item.labelMat.map.image;
      if (!img) continue;
      const h = (img.height / TEX_SCALE) * worldPerPx * labelK;
      item.label.scale.set(h * (img.width / img.height), h, 1);
    }
  }

  /* ---------------- interaction + animation state ---------------- */

  const state = {
    yaw: pickInitialYaw(positions),
    pitch: BASE_TILT,
    velYaw: 0,
    velPitch: 0,
    pointerDown: false,
    pointerType: 'mouse',
    dragging: false,
    downX: 0, downY: 0, downT: 0,
    lastX: 0, lastY: 0,
    lastInteraction: -Infinity,
    hovered: null,
    visible: true,
    reducedMotion: false,
    needsFrames: 2,
    // parallax (desktop pointer)
    parYaw: 0, parPitch: 0,
    parTargetYaw: 0, parTargetPitch: 0,
    // focus
    focused: null,
    dimT: 0,
    spinResumeAt: 0,
    // intro (clock accumulates dt, so it only advances while visible)
    introDone: false,
    introT: 0,
  };

  const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reducedMotion = mqMotion.matches;
  if (state.reducedMotion) {
    state.introDone = true; // everything appears settled
    state.introT = Infinity;
  }

  const focusAnim = {
    active: false,
    t0: 0,
    fromYaw: 0, toYaw: 0,
    fromPitch: 0, toPitch: 0,
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  function setHover(item) {
    if (state.hovered === item) return;
    state.hovered = item;
    canvas.style.cursor = item ? 'pointer' : '';
    requestRender();
  }

  function updateHover(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    let best = null;
    let bestDist = Infinity;
    for (const item of nodeItems) {
      if (!item.data.href) continue; // idea nodes are not interactive
      item.holder.getWorldPosition(tmpV);
      const hitR = item.kind.scale * ringScaleF * 0.85 + 0.06;
      if (raycaster.ray.distanceSqToPoint(tmpV) > hitR * hitR) continue;
      const dist = tmpV.distanceTo(camera.position);
      if (dist < bestDist) { bestDist = dist; best = item; }
    }
    setHover(best);
  }

  function onPointerDown(e) {
    if (!e.isPrimary) return;
    canvas.setPointerCapture(e.pointerId);
    state.pointerDown = true;
    state.pointerType = e.pointerType || 'mouse';
    state.dragging = false;
    state.downX = state.lastX = e.clientX;
    state.downY = state.lastY = e.clientY;
    state.downT = performance.now();
    state.velYaw = state.velPitch = 0;
    state.lastInteraction = performance.now();
    startLoop();
  }

  function onPointerMove(e) {
    if (!e.isPrimary) return;
    if (state.pointerDown) {
      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      if (!state.dragging) {
        const tdx = e.clientX - state.downX;
        const tdy = e.clientY - state.downY;
        // Touch: only predominantly-horizontal motion becomes a drag; the
        // browser owns vertical pans (touch-action: pan-y) and will fire
        // pointercancel for them.
        const wants = state.pointerType === 'touch'
          ? Math.abs(tdx) > 5 && Math.abs(tdx) > Math.abs(tdy) * 1.2
          : Math.hypot(tdx, tdy) > 3;
        if (wants) {
          state.dragging = true;
          setHover(null);
          focusAnim.active = false; // the user's drag wins over focus easing
        }
      }
      if (state.dragging) {
        state.yaw += dx * DRAG_K;
        state.pitch = THREE.MathUtils.clamp(
          state.pitch + dy * DRAG_K * 0.6,
          BASE_TILT - 0.85, BASE_TILT + 0.85
        );
        // smoothed per-event velocity feeds release inertia
        state.velYaw = state.velYaw * 0.4 + dx * DRAG_K * 0.6;
        state.velPitch = state.velPitch * 0.4 + dy * DRAG_K * 0.36;
        state.lastInteraction = performance.now();
      }
      requestRender();
    } else {
      updateHover(e);
    }
  }

  function onPointerUp(e) {
    if (!e.isPrimary) return;
    state.pointerDown = false;
    state.lastInteraction = performance.now();
    const dt = performance.now() - state.downT;
    const dist = Math.hypot(e.clientX - state.downX, e.clientY - state.downY);
    if (dt < 250 && dist < 6) {
      state.velYaw = state.velPitch = 0;
      updateHover(e); // covers touch taps, where no hover existed before
      if (state.hovered && state.hovered.data.href) {
        window.location.href = state.hovered.data.href;
        return;
      }
    }
    if (!state.dragging) state.velYaw = state.velPitch = 0;
    state.dragging = false;
    requestRender();
  }

  function onPointerLeave() {
    if (!state.pointerDown) setHover(null);
  }

  // Pointer parallax (desktop mice only): camera offset eases toward the
  // pointer. Never active on touch, while dragging, or under reduced motion.
  function onWindowPointerMove(e) {
    if (state.reducedMotion || (e.pointerType && e.pointerType !== 'mouse')) return;
    if (state.pointerDown) return;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    state.parTargetYaw = ((e.clientX / w) * 2 - 1) * PARALLAX_YAW;
    state.parTargetPitch = ((e.clientY / h) * 2 - 1) * PARALLAX_PITCH;
    startLoop();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerLeave);
  canvas.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('pointermove', onWindowPointerMove, { passive: true });

  /* ---------------- focus ---------------- */

  // Project a node's layout position for a hypothetical yaw/pitch (world ->
  // viewport fractions), mirroring the tilt/spin/offset transform chain.
  function projectAt(item, yaw, pitch, out) {
    tmpV.copy(item.holder.position)
      .applyAxisAngle(Y_AXIS, yaw)
      .applyAxisAngle(X_AXIS, pitch);
    tmpV.x += tiltGroup.position.x;
    tmpV.y += tiltGroup.position.y;
    tmpV.project(camera);
    out.x = (tmpV.x + 1) / 2;
    out.y = (1 - tmpV.y) / 2;
    return out;
  }

  // Solve the yaw (plus a slight pitch nudge) that brings `item` closest to
  // focusPoint. Rotation only — the camera never travels.
  function solveFocusPose(item) {
    const p = { x: 0, y: 0 };
    const cost = (yaw, pitch) => {
      projectAt(item, yaw, pitch, p);
      const dx = p.x - focusPoint.x;
      const dy = p.y - focusPoint.y;
      return dx * dx + dy * dy * 0.7;
    };
    let bestYaw = state.yaw;
    let best = Infinity;
    for (let k = 0; k < 180; k++) {
      const yaw = (k / 180) * TAU;
      const c = cost(yaw, BASE_TILT);
      if (c < best) { best = c; bestYaw = yaw; }
    }
    let bestPitch = BASE_TILT;
    for (let k = -8; k <= 8; k++) {
      const pitch = BASE_TILT + k * 0.025;
      const c = cost(bestYaw, pitch);
      if (c < best) { best = c; bestPitch = pitch; }
    }
    for (let k = -10; k <= 10; k++) {
      const yaw = bestYaw + k * (TAU / 1800);
      const c = cost(yaw, bestPitch);
      if (c < best) { best = c; bestYaw = yaw; }
    }
    // Shortest-path target from the current yaw, so easing never whips
    // the long way around.
    let delta = (bestYaw - state.yaw) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    return { yaw: state.yaw + delta, pitch: bestPitch };
  }

  function focus(id) {
    if (destroyed) return;
    const item = (id === null || id === undefined) ? null : (byId.get(id) || null);
    state.focused = item;
    if (item) {
      if (state.reducedMotion) {
        state.dimT = 1; // instant highlight, no rotation easing
      } else {
        const pose = solveFocusPose(item);
        focusAnim.active = true;
        focusAnim.t0 = performance.now();
        focusAnim.fromYaw = state.yaw;
        focusAnim.toYaw = pose.yaw;
        focusAnim.fromPitch = state.pitch;
        focusAnim.toPitch = pose.pitch;
        state.velYaw = state.velPitch = 0;
      }
    } else {
      focusAnim.active = false;
      if (state.reducedMotion) state.dimT = 0;
      // idle spin resumes ~1s after the focus clears
      state.spinResumeAt = performance.now() + 1000;
    }
    requestRender();
  }

  /* ---------------- render loop ---------------- */

  let rafId = 0;
  let running = false;
  let lastT = 0;
  let destroyed = false;
  let lastFrameCb = 0;

  function requestRender() {
    state.needsFrames = Math.max(state.needsFrames, 1);
    startLoop();
  }

  function startLoop() {
    if (running || destroyed || !state.visible) return;
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function shouldKeepRunning() {
    if (!state.visible) return false;
    if (state.pointerDown || state.needsFrames > 0) return true;
    if (Math.abs(state.velYaw) > 1e-4 || Math.abs(state.velPitch) > 1e-4) return true;
    if (focusAnim.active || !state.introDone) return true;
    return !state.reducedMotion; // idle auto-rotation
  }

  function tick(t) {
    if (!running) return;
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    step(dt, t);
    render(t);
    if (onFrame && t - lastFrameCb >= 95) {
      lastFrameCb = t;
      let yawDeg = ((state.yaw + state.parYaw) % TAU + TAU) % TAU * (360 / TAU);
      yawDeg = Math.round(yawDeg * 10) / 10;
      try {
        onFrame({ yawDeg, hoverLabel: state.hovered ? String(state.hovered.data.label ?? '') : null });
      } catch (err) {
        /* a broken page callback must never kill the render loop */
      }
    }
    if (state.needsFrames > 0) state.needsFrames--;
    if (!shouldKeepRunning()) { running = false; return; }
    rafId = requestAnimationFrame(tick);
  }

  function step(dt, now) {
    // intro clock (dt-accumulated: pauses while the element is offscreen)
    if (!state.introDone) {
      state.introT += dt;
      if (state.introT >= INTRO_TOTAL) {
        state.introDone = true;
        state.introT = Infinity;
      }
    }

    // focus yaw ease (rotation only, ease-out, interrupt-safe)
    if (focusAnim.active) {
      const k = easeOutCubic(clamp01((now - focusAnim.t0) / FOCUS_DUR));
      state.yaw = focusAnim.fromYaw + (focusAnim.toYaw - focusAnim.fromYaw) * k;
      state.pitch = focusAnim.fromPitch + (focusAnim.toPitch - focusAnim.fromPitch) * k;
      if (k >= 1) focusAnim.active = false;
    }

    // idle auto-spin: paused while focused, while interacting, and for a
    // beat after focus(null)
    const idle = !state.pointerDown && now - state.lastInteraction > RESUME_DELAY;
    if (!state.reducedMotion && !state.focused && !focusAnim.active &&
        idle && now >= state.spinResumeAt) {
      state.yaw += AUTO_SPEED * dt;
    }

    if (!state.pointerDown && (state.velYaw || state.velPitch)) {
      // inertia: velocities are rad-per-frame at 60fps, decayed exponentially
      state.yaw += state.velYaw * dt * 60;
      state.pitch = THREE.MathUtils.clamp(
        state.pitch + state.velPitch * dt * 60,
        BASE_TILT - 0.85, BASE_TILT + 0.85
      );
      const k = Math.exp(-4.2 * dt);
      state.velYaw *= k;
      state.velPitch *= k;
      if (Math.abs(state.velYaw) < 1e-4) state.velYaw = 0;
      if (Math.abs(state.velPitch) < 1e-4) state.velPitch = 0;
    }

    // focus dimming ease (snapped in focus() under reduced motion)
    const dimTarget = state.focused ? 1 : 0;
    if (!state.reducedMotion) {
      state.dimT += (dimTarget - state.dimT) * (1 - Math.exp(-7 * dt));
      if (Math.abs(state.dimT - dimTarget) < 0.004) state.dimT = dimTarget;
    }

    // hover ring ease
    for (const item of items) {
      const target = item === state.hovered ? 1 : 0;
      if (state.reducedMotion) item.hoverT = target;
      else {
        item.hoverT += (target - item.hoverT) * (1 - Math.exp(-12 * dt));
        if (Math.abs(item.hoverT - target) < 0.01) item.hoverT = target;
      }
    }

    // pointer parallax ease; calmed to zero while dragging or focused
    const parScale = (state.pointerDown ? 0 : 1) * (1 - state.dimT);
    const pk = 1 - Math.exp(-5 * dt);
    state.parYaw += (state.parTargetYaw * parScale - state.parYaw) * pk;
    state.parPitch += (state.parTargetPitch * parScale - state.parPitch) * pk;

    // keep animating while any ease is still settling
    if (Math.abs(state.dimT - dimTarget) > 0.003 ||
        Math.abs(state.parYaw - state.parTargetYaw * parScale) > 1e-4 ||
        Math.abs(state.parPitch - state.parTargetPitch * parScale) > 1e-4 ||
        items.some((it) => it.hoverT > 0 && it.hoverT < 1)) {
      state.needsFrames = Math.max(state.needsFrames, 1);
    }

    spinGroup.rotation.y = state.yaw + state.parYaw;
    tiltGroup.rotation.x = THREE.MathUtils.clamp(
      state.pitch + state.parPitch, BASE_TILT - 1, BASE_TILT + 1);
    // specks share the rotation at a slower, parallax-style rate
    fieldGroup.rotation.y = (state.yaw + state.parYaw) * 0.45;
  }

  const lerp = THREE.MathUtils.lerp;

  function render() {
    spinGroup.updateMatrixWorld();
    const t = state.introT;            // seconds into intro (Infinity = done)
    const dim = state.dimT;            // 0..1 focus dimming
    const others = 1 - (1 - DIM_LEVEL) * dim;
    const focusedItem = state.focused;

    // intro: specks settle first
    const speckK = state.introDone ? 1 : phase(t, 0.05, 0.75);
    for (const s of specks) s.mat.opacity = s.baseOpacity * speckK * (1 - 0.3 * dim);

    const labelK = state.introDone ? 1 : phase(t, 0.85, 0.45);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isFocused = item === focusedItem;
      const isHot = item === state.hovered;

      // Depth cue: fade rings + labels as nodes rotate to the back.
      let fade = 1;
      if (item !== hubItem) {
        item.holder.getWorldPosition(tmpV);
        tmpV.applyMatrix4(camera.matrixWorldInverse);
        const zf = THREE.MathUtils.clamp((tmpV.z + camDist) / 2.6, -1, 1);
        fade = (isHot || isFocused)
          ? 1
          : THREE.MathUtils.clamp(0.66 + 0.4 * zf, 0.32, 1);
      }

      // intro: hub ring first, node rings staggered, labels last
      const ringK = state.introDone ? 1
        : phase(t, item === hubItem ? 0 : 0.15 + (i - 1) * 0.07, 0.5);

      const accentK = Math.max(item.data.href ? item.hoverT : 0, isFocused ? dim : 0);
      item.ringMat.color.copy(inkColor).lerp(accentColor, accentK);

      const wantAccentTex = (isHot && item.data.href) || isFocused;
      const map = wantAccentTex && item.texAccent ? item.texAccent : item.texInk;
      if (item.labelMat.map !== map) item.labelMat.map = map;

      let ringO = item.kind.ringOpacity * fade;
      let labelO = item.kind.labelOpacity * fade;
      if (focusedItem) {
        if (isFocused) {
          ringO = lerp(ringO, 1, dim);
          labelO = lerp(labelO, 0.96, dim);
        } else {
          ringO *= others;
          labelO *= others;
        }
      }
      item.ringMat.opacity = ringO * ringK;
      item.labelMat.opacity = labelO * labelK;

      // ring scale: intro pop-in + hover (~1.15x) + focus (~1.3x)
      const sc = item.kind.scale * ringScaleF * (0.55 + 0.45 * ringK) *
        (1 + 0.15 * item.hoverT + 0.3 * (isFocused ? dim : 0));
      item.ring.scale.set(sc, sc, 1);

      // hub spoke: dash-draws in, brightens on hover, goes accent on focus
      if (item.spokeMat) {
        const spokeK = state.introDone ? 1 : phase(t, 0.08 + (i - 1) * 0.09, 0.55);
        const len = item.spokeRec.len;
        item.spokeMat.dashSize = spokeK >= 1 ? len + 1 : Math.max(1e-4, spokeK * len);
        item.spokeMat.gapSize = spokeK >= 1 ? 1e-3 : 1000;
        const spokeAccent = Math.max(item.data.href ? item.hoverT : 0, isFocused ? dim : 0);
        item.spokeMat.color.copy(inkColor).lerp(accentColor, spokeAccent);
        let spokeO = lerp(SPOKE_OPACITY, 0.55, item.data.href ? item.hoverT : 0);
        if (focusedItem) {
          spokeO = isFocused ? lerp(spokeO, 0.85, dim) : spokeO * others;
        }
        item.spokeMat.opacity = spokeO;
      }
    }

    for (let j = 0; j < crossEdges.length; j++) {
      const crossK = state.introDone ? 1 : phase(t, 0.6 + j * 0.08, 0.4);
      const m = crossEdges[j].mat;
      m.color.copy(inkColor);
      m.opacity = CROSS_OPACITY * crossK * others;
    }

    renderer.render(scene, camera);
  }

  /* ---------------- observers + media queries ---------------- */

  let viewDpr = 0;
  function resize() {
    const w = element.clientWidth;
    const h = element.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // A GL resize reallocates the framebuffer; doing that mid-scroll
    // stutters, so skip when nothing actually changed.
    if (w === viewW && h === viewH && dpr === viewDpr) return;
    viewW = w;
    viewH = h;
    viewDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    // gl_PointSize is in device px; keep specks at their CSS-px size
    for (const s of specks) s.mat.size = s.basePx * dpr;
    fitCamera();
    requestRender();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(element);

  const io = new IntersectionObserver((entries) => {
    state.visible = entries[entries.length - 1].isIntersecting;
    if (state.visible) requestRender();
    else stopLoop();
  });
  io.observe(element);

  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  // Re-read the CSS variables after the page's own media queries apply.
  // (Single dark theme now, but the re-read is harmless and future-proof.)
  const onSchemeChange = () => requestAnimationFrame(() => { if (!destroyed) applyTheme(); });
  mqDark.addEventListener('change', onSchemeChange);

  const onMotionChange = () => {
    state.reducedMotion = mqMotion.matches;
    if (state.reducedMotion) {
      state.introDone = true;
      state.introT = Infinity;
      focusAnim.active = false;
      state.dimT = state.focused ? 1 : 0;
      state.parTargetYaw = state.parTargetPitch = 0;
    }
    requestRender();
  };
  mqMotion.addEventListener('change', onMotionChange);

  // Rebuild labels once webfonts settle (metrics can change).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (!destroyed) applyTheme(); });
  }

  resize();
  applyTheme();

  /* ---------------- teardown ---------------- */

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    ro.disconnect();
    io.disconnect();
    mqDark.removeEventListener('change', onSchemeChange);
    mqMotion.removeEventListener('change', onMotionChange);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerLeave);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('pointermove', onWindowPointerMove);
    for (const item of items) {
      if (item.texInk) item.texInk.dispose();
      if (item.texAccent) item.texAccent.dispose();
      item.ringMat.dispose();
      item.labelMat.dispose();
    }
    Object.values(ringTextures).forEach((tx) => tx.dispose());
    for (const rec of edgeRecs) { rec.geo.dispose(); rec.mat.dispose(); }
    for (const s of specks) { s.geo.dispose(); s.mat.dispose(); }
    dotTexture.dispose();
    renderer.dispose();
    canvas.remove();
  }

  const controls = { destroy, focus };

  if (opts._debug) {
    controls._debug = {
      // current projected viewport fractions for a node id
      project(id) {
        const item = byId.get(id) || (hubItem.data.id === id ? hubItem : null);
        if (!item) return null;
        spinGroup.updateMatrixWorld(true);
        item.holder.getWorldPosition(tmpV);
        tmpV.project(camera);
        return { x: (tmpV.x + 1) / 2, y: (1 - tmpV.y) / 2 };
      },
      get state() {
        return {
          yaw: state.yaw, pitch: state.pitch, dimT: state.dimT,
          introDone: state.introDone, camDist,
          focused: state.focused ? state.focused.data.id : null,
        };
      },
    };
  }

  return controls;
}
