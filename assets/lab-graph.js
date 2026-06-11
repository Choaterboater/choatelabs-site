/*
 * lab-graph.js — interactive "ink schematic" project graph for choatelabs.app.
 *
 * Renders a hand-drafted-looking 3D network diagram: thin ink rings and
 * spokes on paper, monospace labels, slow idle rotation, drag to spin.
 *
 *   import { mountLabGraph } from './lab-graph.js';
 *   const graph = mountLabGraph(el, { hub, nodes });
 *   graph.destroy();
 *
 * Colors come from CSS custom properties on :root (--ink, --accent,
 * --paper) and are re-read when prefers-color-scheme flips.
 */

import * as THREE from './vendor/three.module.min.js';

const TAU = Math.PI * 2;

const SEED = 0x5eed1ab;
// Long lens: flattens perspective so node sizes stay near-uniform and the
// diagram reads as drafting linework rather than a deep 3D blob.
const CAM_DIST = 10;
const FOV = 21;
const BASE_TILT = 0.26;          // resting X tilt, radians
const AUTO_SPEED = 0.065;        // idle spin, rad/s
const RESUME_DELAY = 3000;       // ms of quiet before auto-rotation resumes
const DRAG_K = 0.0055;           // px -> radians
const LABEL_PX = 11.5;           // on-screen label size, CSS px
const TEX_SCALE = 3;             // label texture supersampling for HiDPI
const SPOKE_OPACITY = 0.3;
const CROSS_OPACITY = 0.15;

const FONT_STACK = '"SF Mono", "Cascadia Code", Menlo, Consolas, monospace';

// Per-kind visual parameters (world units / texture fractions).
const KINDS = {
  hub:     { scale: 0.34, ringOpacity: 0.95, labelOpacity: 0.8,  labelPad: 22 },
  project: { scale: 0.25, ringOpacity: 0.9,  labelOpacity: 0.75, labelPad: 18 },
  idea:    { scale: 0.19, ringOpacity: 0.45, labelOpacity: 0.42, labelPad: 15 },
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
    ink: pick('--ink', '#1C1B18'),
    accent: pick('--accent', '#A8501C'),
    paper: pick('--paper', '#F4F1E9'),
  };
}

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
    const radius = 1.7 + rand() * 0.55;
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

  relax(100, 1.2, 0.12, 0.015);

  // Flatten vertically (wide containers frame the cloud better), recenter
  // the cloud's mass on the hub, then relax again so neither step
  // reintroduces overlaps.
  const centroid = new THREE.Vector3();
  pts.forEach((pt) => { pt.p.y *= 0.7; centroid.add(pt.p); });
  centroid.divideScalar(pts.length || 1);
  pts.forEach((pt) => {
    pt.p.sub(centroid);
    pt.radius = THREE.MathUtils.clamp(pt.p.length(), 1.3, 2.3);
  });
  relax(60, 1.3, 0.08, 0);

  // Safety: never let a node sit on top of the hub, and keep nodes off the
  // Y rotation axis so none can permanently hide behind the hub.
  pts.forEach((pt) => {
    if (pt.p.length() < 1.1) pt.p.setLength(1.1);
    const rxz = Math.hypot(pt.p.x, pt.p.z);
    if (rxz < 0.9 && Math.abs(pt.p.y) < 0.9) {
      const s = 0.9 / Math.max(rxz, 1e-4);
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
      const w = CAM_DIST / (CAM_DIST - z); // perspective toward +Z camera
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

/* ------------------------------------------------------------------ */
/* mount                                                               */

export function mountLabGraph(element, options) {
  const { hub, nodes = [] } = options || {};

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
  canvas.style.touchAction = 'none';

  if (getComputedStyle(element).position === 'static') {
    element.style.position = 'relative';
  }
  element.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_DIST);
  camera.lookAt(0, 0, 0);

  const tiltGroup = new THREE.Group();   // X tilt (drag up/down)
  const spinGroup = new THREE.Group();   // Y spin (idle + drag left/right)
  tiltGroup.add(spinGroup);
  // Labels all extend to the right of their nodes, so shift the figure
  // slightly left to keep it optically centered.
  tiltGroup.position.x = -0.22;
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
    ring.renderOrder = 2;
    holder.add(ring);

    const labelMat = new THREE.SpriteMaterial({
      transparent: true,
      opacity: kind.labelOpacity,
      depthTest: false,
      depthWrite: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.center.set(0, 0.5); // anchor left edge at the node, extend right
    label.renderOrder = 3;
    holder.add(label);

    spinGroup.add(holder);
    return {
      data, kind, kindName, holder, ring, ringMat, labelMat, label,
      texInk: null, texAccent: null,
      spokeMat: null,
      hitR: kind.scale * 0.85 + 0.06,
    };
  }

  const hubItem = makeItem(hub || { id: 'hub', label: '' }, 'hub', new THREE.Vector3());
  items.push(hubItem);
  const nodeItems = nodes.map((n, i) => {
    const item = makeItem(n, n.href ? 'project' : 'idea', positions[i]);
    items.push(item);
    return item;
  });

  // Edges. Hub spokes get a material each so a hovered node's spoke can
  // brighten independently; cross-links share one dashed material.
  const edgeLines = [];
  const crossMat = new THREE.LineDashedMaterial({
    transparent: true,
    opacity: CROSS_OPACITY,
    dashSize: 0.07,
    gapSize: 0.055,
    depthTest: false,
    depthWrite: false,
  });

  const hubTrim = KINDS.hub.scale * 0.46;
  for (const item of nodeItems) {
    const trim = item.kind.scale * 0.46;
    const [a, b] = trimmedSegment(hubItem.holder.position, item.holder.position, hubTrim, trim);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: SPOKE_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 1;
    spinGroup.add(line);
    edgeLines.push(line);
    item.spokeMat = mat;
  }

  for (let i = 0; i < nodeItems.length; i++) {
    for (let j = i + 1; j < nodeItems.length; j++) {
      const gi = nodeItems[i].data.group;
      if (!gi || gi !== nodeItems[j].data.group) continue;
      const [a, b] = trimmedSegment(
        nodeItems[i].holder.position, nodeItems[j].holder.position,
        nodeItems[i].kind.scale * 0.46, nodeItems[j].kind.scale * 0.46
      );
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, crossMat);
      line.computeLineDistances();
      line.renderOrder = 0;
      spinGroup.add(line);
      edgeLines.push(line);
    }
  }

  /* ---------------- theme ---------------- */

  function applyTheme() {
    theme = readTheme();
    inkColor.set(theme.ink);
    accentColor.set(theme.accent);
    for (const item of items) {
      if (item.texInk) item.texInk.dispose();
      if (item.texAccent) item.texAccent.dispose();
      const text = String(item.data.label ?? '').toLowerCase();
      item.texInk = makeLabelTexture(text, theme.ink, theme.paper, item.kind.labelPad);
      item.texAccent = item.data.href
        ? makeLabelTexture(text, theme.accent, theme.paper, item.kind.labelPad)
        : null;
      const hot = item === state.hovered;
      item.labelMat.map = hot && item.texAccent ? item.texAccent : item.texInk;
      item.labelMat.needsUpdate = true;
      item.ringMat.color.copy(hot ? accentColor : inkColor);
      if (item.spokeMat) {
        item.spokeMat.color.copy(hot ? accentColor : inkColor);
        item.spokeMat.opacity = hot ? 0.55 : SPOKE_OPACITY;
      }
    }
    crossMat.color.copy(inkColor);
    updateLabelScales();
    requestRender();
  }

  let worldPerPx = 0.0062; // world units per CSS px, recomputed on resize

  function updateLabelScales() {
    for (const item of items) {
      const img = item.labelMat.map && item.labelMat.map.image;
      if (!img) continue;
      const h = (img.height / TEX_SCALE) * worldPerPx;
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
    dragging: false,
    downX: 0, downY: 0, downT: 0,
    lastX: 0, lastY: 0,
    lastInteraction: -Infinity,
    hovered: null,
    visible: true,
    reducedMotion: false,
    needsFrames: 2,
  };

  const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.reducedMotion = mqMotion.matches;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();

  function setHover(item) {
    if (state.hovered === item) return;
    const prev = state.hovered;
    state.hovered = item;
    for (const it of [prev, item]) {
      if (!it) continue;
      const hot = it === item;
      const s = it.kind.scale * (hot ? 1.18 : 1);
      it.ring.scale.set(s, s, 1);
      it.ringMat.color.copy(hot ? accentColor : inkColor);
      it.labelMat.map = hot && it.texAccent ? it.texAccent : it.texInk;
      if (it.spokeMat) {
        it.spokeMat.color.copy(hot ? accentColor : inkColor);
        it.spokeMat.opacity = hot ? 0.55 : SPOKE_OPACITY;
      }
    }
    updateLabelScales();
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
      if (raycaster.ray.distanceSqToPoint(tmpV) > item.hitR * item.hitR) continue;
      const dist = tmpV.distanceTo(camera.position);
      if (dist < bestDist) { bestDist = dist; best = item; }
    }
    setHover(best);
  }

  function onPointerDown(e) {
    if (!e.isPrimary) return;
    canvas.setPointerCapture(e.pointerId);
    state.pointerDown = true;
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
      if (!state.dragging &&
          Math.hypot(e.clientX - state.downX, e.clientY - state.downY) > 3) {
        state.dragging = true;
        setHover(null);
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

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerLeave);
  canvas.addEventListener('pointerleave', onPointerLeave);

  /* ---------------- render loop ---------------- */

  let rafId = 0;
  let running = false;
  let lastT = 0;
  let destroyed = false;

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
    return !state.reducedMotion; // idle auto-rotation
  }

  function tick(t) {
    if (!running) return;
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    step(dt, t);
    render();
    if (state.needsFrames > 0) state.needsFrames--;
    if (!shouldKeepRunning()) { running = false; return; }
    rafId = requestAnimationFrame(tick);
  }

  function step(dt, now) {
    const idle = !state.pointerDown && now - state.lastInteraction > RESUME_DELAY;
    if (!state.reducedMotion && idle) state.yaw += AUTO_SPEED * dt;
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
    spinGroup.rotation.y = state.yaw;
    tiltGroup.rotation.x = state.pitch;
  }

  function render() {
    spinGroup.updateMatrixWorld();
    // Depth cue: fade rings + labels as nodes rotate to the back.
    for (const item of nodeItems) {
      item.holder.getWorldPosition(tmpV);
      tmpV.applyMatrix4(camera.matrixWorldInverse);
      const t = THREE.MathUtils.clamp((tmpV.z + CAM_DIST) / 2.2, -1, 1);
      const fade = item === state.hovered
        ? 1
        : THREE.MathUtils.clamp(0.68 + 0.38 * t, 0.3, 1);
      item.ringMat.opacity = item.kind.ringOpacity * fade;
      item.labelMat.opacity = item.kind.labelOpacity * fade;
    }
    renderer.render(scene, camera);
  }

  /* ---------------- observers + media queries ---------------- */

  function resize() {
    const w = element.clientWidth;
    const h = element.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Keep labels pixel-locked: world units per CSS px at the focal plane.
    worldPerPx = (2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / h;
    updateLabelScales();
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
  const onSchemeChange = () => requestAnimationFrame(() => { if (!destroyed) applyTheme(); });
  mqDark.addEventListener('change', onSchemeChange);

  const onMotionChange = () => {
    state.reducedMotion = mqMotion.matches;
    requestRender();
  };
  mqMotion.addEventListener('change', onMotionChange);

  // Rebuild labels once webfonts settle (metrics can change).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (!destroyed) applyTheme(); });
  }

  applyTheme();
  resize();

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
    for (const item of items) {
      if (item.texInk) item.texInk.dispose();
      if (item.texAccent) item.texAccent.dispose();
      item.ringMat.dispose();
      item.labelMat.dispose();
      if (item.spokeMat) item.spokeMat.dispose();
    }
    Object.values(ringTextures).forEach((t) => t.dispose());
    crossMat.dispose();
    edgeLines.forEach((l) => l.geometry.dispose());
    renderer.dispose();
    canvas.remove();
  }

  return { destroy };
}
