// The things on the shelves: one builder per model, each a small procedural
// 3D object you can tell apart at a glance. Produce is shaped and coloured as
// itself (a lemon's pointed ends, a banana's curve, broccoli's florets); meat
// sits on a tray as its cut (a mound of mince, a steak, rashers); herbs stand
// in a glass of water; and packaged food comes in its package with its name
// printed on the front, the way a shopper reads a shelf. What each item is
// drawn as is decided server-side (src/kitchen.ts) and arrives as
// { model, look: { label, colour, fill, variant } }.
//
// The camera looks at the shelves almost level, so every model is made to
// read from the front: labels face +z, long things lie left to right, and
// nothing relies on being seen from above. Each builder returns
// [group, footprint] with the group resting on y = 0; buildModel then merges
// each item's meshes by material, so a full fridge stays a few hundred draw
// calls however leafy the herbs.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/* ---------------- materials ---------------- */

const matCache = new Map();
function mat(hex, opts = {}) {
  const k = hex + JSON.stringify(opts);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: 0.5, clearcoat: 0.2, ...opts }));
  return matCache.get(k);
}
// glossy (fruit, glazed packaging) and dull (roots, paper)
const skin = (hex, opts = {}) => mat(hex, { roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.35, ...opts });
const matte = (hex, opts = {}) => mat(hex, { roughness: 0.88, clearcoat: 0, ...opts });
const white = () => mat("#fbfaf6", { roughness: 0.4, clearcoat: 0.3 });
// Clear glass and film are plain transparency rather than transmission: what's
// inside a jar shows sharply, and the scene needs no extra render pass.
const glass = () => mat("#ffffff", { roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
const film = () => mat("#ffffff", { roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.12, depthWrite: false });
const clearPlastic = () => mat("#ffffff", { roughness: 0.1, transparent: true, opacity: 0.3, depthWrite: false });
const tinMetal = () => mat("#d4d8db", { metalness: 0.85, roughness: 0.3, clearcoat: 0 });
const shade = (hex, k) => "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
const mix = (a, b, t) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/* ---------------- printed labels ---------------- */

// A label is drawn once per text, colour and shape onto a canvas: a panel in
// the pack's colour with the name in heavy type, as large as fits on one or
// two lines, and a small pictogram of what's inside. `zone` is the share of
// the width that faces you (a label wrapped round a jar only shows its
// middle), so the name is set inside it rather than round the back.
const LABEL_H = 160;
const texCache = new Map();
function labelTexture(text, bg, { aspect = 2, zone = 1, motif = null } = {}) {
  const key = [text, bg, aspect.toFixed(2), zone.toFixed(2), motif].join("|");
  if (texCache.has(key)) return texCache.get(key);
  // tall labels get more pixels, so the type stays as sharp as on wide ones
  const H = aspect * zone < 1.4 ? LABEL_H * 2 : LABEL_H;
  const W = Math.round(Math.min(1024, Math.max(96, H * aspect)));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const ink = luminance(bg) > 0.5 ? "#1d1a17" : "#ffffff";
  const zoneW = W * zone;
  const x0 = (W - zoneW) / 2;
  const pad = Math.min(zoneW, H) * 0.08;
  // The pictogram sits beside the name on a wide label, above it on a squarer
  // one (a jar, a stock carton), and is left off where it would crowd it.
  const beside = motif && zoneW > H * 2.4;
  const above = motif && !beside && zoneW < H * 1.6;
  const icon = beside ? Math.min(H * 0.56, zoneW * 0.24) : above ? Math.min(H * 0.4, zoneW * 0.5) : 0;
  const gap = beside ? pad * 0.7 : 0;
  const maxW = zoneW - 2 * pad - (beside ? icon + gap : 0);
  const textTop = above ? pad + icon + pad * 0.4 : 0;
  const textH = H - textTop - (above ? pad * 0.6 : 0);
  const font = (s) => (g.font = `800 ${s}px "Helvetica Neue", Helvetica, Arial, sans-serif`);
  // one line, or two split at whichever word gives the biggest type
  const words = String(text).split(/\s+/);
  const layouts = [[words.join(" ")]];
  for (let i = 1; i < words.length; i++) layouts.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
  let best = null;
  for (const lines of layouts) {
    let s = textH * (lines.length === 1 ? 0.52 : 0.4);
    font(s);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    s = Math.min(s, (s * maxW) / widest);
    if (!best || s > best.s * 1.08) best = { lines, s };
  }
  font(best.s);
  const textW = Math.max(...best.lines.map((l) => g.measureText(l).width));
  let x = x0 + (zoneW - (beside ? icon + gap : 0) - textW) / 2;
  if (beside) {
    drawMotif(g, motif, x + icon / 2, H / 2, icon / 2, bg);
    x += icon + gap;
  }
  if (above) drawMotif(g, motif, W / 2, pad + icon / 2, icon / 2, bg);
  g.fillStyle = ink;
  g.textBaseline = "middle";
  const mid = textTop + textH / 2;
  best.lines.forEach((l, i) => g.fillText(l, x, mid + (i - (best.lines.length - 1) / 2) * best.s * 1.04 + best.s * 0.04));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// Small pictograms on a white roundel: what's in the pack, at a glance.
function drawMotif(g, motif, cx, cy, r, bg) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  const mono = luminance(bg) < 0.6 ? bg : "#3a3a3a";
  const s = r * 0.78;
  g.lineWidth = s * 0.14;
  g.lineCap = "round";
  g.fillStyle = mono;
  g.strokeStyle = mono;
  const blob = (x, y, rx, ry, rot = 0) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  };
  switch (motif) {
    case "peanut": {
      // the shell's figure-eight with its waist and pitted texture
      g.fillStyle = "#c8915a";
      g.strokeStyle = "#7a4a22";
      g.lineWidth = s * 0.09;
      g.rotate(-0.5);
      for (const dy of [-0.42, 0.42]) {
        g.beginPath();
        g.ellipse(0, dy * s, s * 0.5, s * 0.47, 0, 0, Math.PI * 2);
        g.stroke();
      }
      for (const dy of [-0.42, 0.42]) blob(0, dy * s, s * 0.46, s * 0.43);
      g.fillRect(-s * 0.36, -s * 0.2, s * 0.72, s * 0.4);
      g.fillStyle = "#8a5a2a";
      for (const [x, y] of [[-0.2, -0.5], [0.15, -0.35], [-0.1, 0.4], [0.2, 0.55], [0.05, -0.68], [-0.22, 0.62]]) blob(x * s, y * s, s * 0.065, s * 0.065);
      break;
    }
    case "chilli":
      g.fillStyle = "#d8302a";
      g.beginPath();
      g.moveTo(-s * 0.55, -s * 0.45);
      g.quadraticCurveTo(s * 0.95, -s * 0.4, s * 0.45, s * 0.9);
      g.quadraticCurveTo(s * 0.3, -s * 0.05, -s * 0.55, -s * 0.12);
      g.fill();
      g.fillStyle = "#3f8a3a";
      g.fillRect(-s * 0.85, -s * 0.48, s * 0.34, s * 0.3);
      break;
    case "drop":
      g.beginPath();
      g.moveTo(0, -s * 0.9);
      g.bezierCurveTo(s * 0.75, -s * 0.1, s * 0.62, s * 0.85, 0, s * 0.85);
      g.bezierCurveTo(-s * 0.62, s * 0.85, -s * 0.75, -s * 0.1, 0, -s * 0.9);
      g.fill();
      break;
    case "leaf":
      g.fillStyle = "#3f8a3a";
      g.beginPath();
      g.moveTo(-s * 0.75, s * 0.7);
      g.quadraticCurveTo(-s * 0.7, -s * 0.8, s * 0.8, -s * 0.72);
      g.quadraticCurveTo(s * 0.7, s * 0.8, -s * 0.75, s * 0.7);
      g.fill();
      break;
    case "tomato":
      g.fillStyle = "#d8302a";
      blob(0, s * 0.12, s * 0.85, s * 0.72);
      g.fillStyle = "#3f8a3a";
      for (let i = 0; i < 5; i++) blob(Math.cos(i * 1.256) * s * 0.22, -s * 0.5 + Math.sin(i * 1.256) * s * 0.1, s * 0.22, s * 0.07, i * 1.256);
      break;
    case "fish":
      blob(-s * 0.1, 0, s * 0.62, s * 0.36);
      g.beginPath();
      g.moveTo(s * 0.4, 0);
      g.lineTo(s * 0.95, -s * 0.42);
      g.lineTo(s * 0.95, s * 0.42);
      g.fill();
      break;
    case "wheat":
      g.strokeStyle = "#c8902a";
      g.fillStyle = "#c8902a";
      g.beginPath();
      g.moveTo(0, s * 0.95);
      g.lineTo(0, -s * 0.8);
      g.stroke();
      for (let i = 0; i < 4; i++) for (const d of [-1, 1]) blob(d * s * 0.22, -s * 0.62 + i * s * 0.36, s * 0.2, s * 0.1, d * 0.7);
      blob(0, -s * 0.85, s * 0.1, s * 0.18);
      break;
    case "grain":
      for (const [x, y, a] of [[-0.4, -0.3, 0.6], [0.12, -0.52, -0.3], [0.48, -0.06, 0.9], [-0.18, 0.22, -0.5], [0.3, 0.5, 0.2], [-0.5, 0.52, 0.8]]) blob(x * s, y * s, s * 0.24, s * 0.12, a);
      break;
    case "nut":
      g.fillStyle = "#b07a3a";
      blob(-s * 0.25, 0, s * 0.42, s * 0.6, 0.4);
      g.fillStyle = "#8a5a2a";
      blob(s * 0.32, s * 0.05, s * 0.38, s * 0.55, -0.3);
      break;
    case "pea":
      g.fillStyle = "#5fa83a";
      for (const [x, y] of [[-0.45, -0.25], [0.1, -0.45], [0.5, 0.05], [-0.1, 0.25], [-0.5, 0.45], [0.3, 0.55]]) blob(x * s, y * s, s * 0.28, s * 0.28);
      break;
    case "cow":
      // a milk bottle
      g.beginPath();
      g.moveTo(-s * 0.18, -s * 0.9);
      g.lineTo(s * 0.18, -s * 0.9);
      g.lineTo(s * 0.18, -s * 0.5);
      g.quadraticCurveTo(s * 0.5, -s * 0.35, s * 0.5, 0);
      g.lineTo(s * 0.5, s * 0.85);
      g.lineTo(-s * 0.5, s * 0.85);
      g.lineTo(-s * 0.5, 0);
      g.quadraticCurveTo(-s * 0.5, -s * 0.35, -s * 0.18, -s * 0.5);
      g.closePath();
      g.fill();
      break;
    case "coconut":
      g.fillStyle = "#6a4020";
      blob(0, 0, s * 0.85, s * 0.85);
      g.fillStyle = "#ffffff";
      blob(0, 0, s * 0.6, s * 0.6);
      break;
    default:
      break;
  }
  g.restore();
}

// What pictogram a label wears, from the item's look and name.
function motifFor(item) {
  const n = item.name ?? "";
  if (item.look?.variant === "peanut" || /peanut/.test(n)) return "peanut";
  if (/chilli|sriracha|hot sauce|harissa|sambal|chipotle|cayenne|paprika/.test(n)) return "chilli";
  if (/tomato|passata/.test(n)) return "tomato";
  if (/fish|tuna|salmon|anchov|sardine|prawn|shrimp|oyster/.test(n)) return "fish";
  if (/coconut/.test(n)) return "coconut";
  if (/\bpeas\b/.test(n)) return "pea";
  if (/almond|walnut|cashew|pecan|hazelnut|pistachio|\bnuts?\b|macadamia/.test(n)) return "nut";
  if (/flour|bread|oats|wheat|pasta|spaghetti|macaroni|penne|couscous|semolina|biscuit|crumbs|pastry|noodle/.test(n)) return "wheat";
  if (/rice|lentil|bean|chickpea|quinoa|dal|grain|sugar|polenta|cornmeal/.test(n)) return "grain";
  if (/milk|cream|cheese|butter|yoghurt|custard/.test(n)) return "cow";
  if (/oil|vinegar|sauce|syrup|honey|extract|wine|stock|molasses/.test(n)) return "drop";
  if (/herb|oregano|thyme|basil|bay|mint|parsley|pesto|leaf|leaves|curry|coriander|dill|sage|olive|caper/.test(n)) return "leaf";
  return null;
}

// What the item is called on its label: the look's label, else its own name.
function nameOf(item) {
  const raw = item.look?.label ?? item.name ?? "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const labelMats = new Map();
function labelMaterial(tex) {
  if (!labelMats.has(tex)) labelMats.set(tex, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  return labelMats.get(tex);
}

// A flat label w x h facing +z (boxes, cartons, bags, stickers).
function flatLabel(text, bg, w, h, opts = {}) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMaterial(labelTexture(text, bg, { aspect: w / h, ...opts })));
}

// A label round the front of a jar, bottle or tin: radius r (rBot at the
// bottom, for a tapered tub), height h, over `arc` radians centred on +z. The
// name is set in the middle 110 degrees, the part that faces you.
function wrapLabel(text, bg, r, h, { arc = Math.PI * 1.2, rBot = r, motif = null } = {}) {
  const front = Math.min(arc, Math.PI * 0.62);
  const tex = labelTexture(text, bg, { aspect: (((r + rBot) / 2) * arc) / h, zone: front / arc, motif });
  // three.js measures theta from +z towards +x, so centring on 0 faces the camera
  return new THREE.Mesh(new THREE.CylinderGeometry(r, rBot, h, 48, 1, true, -arc / 2, arc), labelMaterial(tex));
}

/* ---------------- shapes ---------------- */

const lathe = (pts, material, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), material);

const at = (mesh, x = 0, y = 0, z = 0) => {
  mesh.position.set(x, y, z);
  return mesh;
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A rod from a to b (stems, bones, stalks), radius r0 at a and r1 at b.
function rod(a, b, r0, r1, material, seg = 7) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), seg), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return m;
}

// A leaf: a thin ellipsoid len long and wid wide, growing from `from` along `dir`.
function leaf(from, dir, len, wid, material, thick = 0.14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
  m.scale.set(len / 2, (wid / 2) * thick, wid / 2);
  const d = dir.clone().normalize();
  m.position.copy(from).addScaledVector(d, len / 2);
  m.quaternion.setFromUnitVectors(V(1, 0, 0), d);
  return m;
}

// Deterministic variety from a seed: same look, same shape, every time.
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A sphere with a gentle irregular bulge (produce isn't perfectly round),
// plus an optional fine dimple (citrus peel).
function lumpy(radius, material, seed, bump = 0.06, fine = 0) {
  const geo = new THREE.SphereGeometry(radius, 30, 22);
  const pos = geo.attributes.position;
  const r = rng(seed);
  const a = r() * 6, b = r() * 6, c = r() * 6;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let k = 1 + bump * Math.sin(n.x * 4 + a) * Math.sin(n.y * 3.5 + b) * Math.sin(n.z * 4 + c);
    if (fine) k += fine * Math.sin(n.x * 41 + a) * Math.sin(n.y * 37 + b) * Math.sin(n.z * 43 + c);
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// Where n pieces of produce of radius r sit: a front row and a staggered back
// row, so the ones behind show between the ones in front.
function pile(n, r, spread = 2.05) {
  const front = Math.ceil(n / 2);
  const back = n - front;
  const pts = [];
  for (let i = 0; i < front; i++) pts.push([(i - (front - 1) / 2) * r * spread, r * 0.8]);
  for (let i = 0; i < back; i++) pts.push([(i - (back - 1) / 2) * r * spread, -r * 0.8]);
  return pts;
}

// A curved tube along `path` of radius r, tapered by taper(t) (t from 0 to 1).
function taperedTube(path, r, taper, material, seg = 20, radial = 10) {
  const tube = new THREE.TubeGeometry(path, seg, r, radial, false);
  const pos = tube.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const c = path.getPointAt(i / seg);
    const k = taper(i / seg);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  tube.computeVertexNormals();
  return new THREE.Mesh(tube, material);
}

// A repeating texture drawn once (corn kernels, pineapple scales).
const patternCache = new Map();
function pattern(key, draw, repeat) {
  if (!patternCache.has(key)) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    draw(c.getContext("2d"), 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    patternCache.set(key, new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 }));
  }
  return patternCache.get(key);
}

/* ---------------- produce ---------------- */

const LEAF = "#4f8f3f";

function citrus(item) {
  const g = new THREE.Group();
  const v = item.look?.variant ?? "lemon";
  const col = item.look?.colour ?? "#f2d24b";
  const r = { lemon: 0.07, lime: 0.06, orange: 0.088, mandarin: 0.074 }[v] ?? 0.07;
  const stretch = { lemon: 1.28, lime: 1.1, orange: 1, mandarin: 1.06 }[v] ?? 1;
  const squash = v === "mandarin" ? 0.8 : 1;
  const peel = skin(col, { roughness: 0.55, clearcoat: 0.35 });
  const rand = rng(item.seed);
  for (const [i, [x, z]] of pile(3, r * stretch, 1.85).entries()) {
    const fruit = lumpy(r, peel, item.seed + i, 0.025, 0.012);
    fruit.scale.set(stretch, squash, 1);
    const turn = (rand() - 0.5) * 0.5;
    fruit.rotation.y = turn;
    g.add(at(fruit, x, r * squash, z));
    if (v === "lemon" || v === "lime") {
      // the pointed ends
      for (const s of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 12, 10), peel);
        tip.scale.set(1.3, 0.8, 0.8);
        tip.rotation.y = turn;
        g.add(at(tip, x + Math.cos(turn) * s * r * stretch * 0.98, r, z - Math.sin(turn) * s * r * stretch * 0.98));
      }
    } else {
      g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.13, r * 0.1, 8), matte("#6a7a3a")), x, r * squash * 2, z));
    }
  }
  return [g, r * stretch * 4.2];
}

function apple(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d6453d";
  const v = item.look?.variant ?? "";
  const r = v === "peach" ? 0.078 : 0.08;
  const top = v === "pear" ? r * 2.56 : v === "peach" ? r * 1.8 : r * 1.55;
  const profiles = {
    pear: [[0, 0], [r * 0.7, r * 0.08], [r * 1.0, r * 0.6], [r * 0.95, r * 1.1], [r * 0.62, r * 1.75], [r * 0.45, r * 2.2], [r * 0.2, r * 2.5], [0, r * 2.56]],
    peach: [[0, 0.004], [r * 0.6, 0], [r * 0.98, r * 0.5], [r * 1.02, r * 1.0], [r * 0.85, r * 1.55], [r * 0.4, r * 1.85], [r * 0.12, r * 1.8], [0, r * 1.77]],
    // an apple's shoulders and the dimple its stalk sits in
    apple: [[0, r * 0.12], [r * 0.45, 0], [r * 0.95, r * 0.4], [r * 1.05, r * 1.0], [r * 0.95, r * 1.45], [r * 0.6, r * 1.75], [r * 0.2, r * 1.66], [0, r * 1.5]],
  };
  const fruit = skin(col, v === "peach" ? { roughness: 0.8, clearcoat: 0.05 } : v === "pear" ? { roughness: 0.55 } : { roughness: 0.3, clearcoat: 0.75 });
  const blush = skin(mix(col, v === "peach" ? "#e0503a" : "#f2c84a", 0.4), { transparent: true, opacity: 0.45 });
  for (const [i, [x, z]] of pile(3, r).entries()) {
    g.add(at(lathe(profiles[v] ?? profiles.apple, fruit), x, 0, z));
    if (v !== "pear") {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 14, 10), blush);
      b.scale.set(1, 0.9, 0.5);
      g.add(at(b, x - r * 0.3, r * 0.8, z + r * 0.62));
    }
    g.add(rod(V(x, top - r * 0.1, z), V(x + 0.012, top + 0.04, z), 0.005, 0.004, matte("#6a4a2a")));
    if (i === 0 && v !== "peach") g.add(leaf(V(x + 0.008, top + 0.02, z), V(1, 0.4, 0.3), 0.06, 0.03, skin(LEAF), 0.25));
  }
  return [g, r * 4.2];
}

function tomato(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#e2463a";
  const cherry = item.look?.variant === "cherry";
  const flesh = skin(col, { roughness: 0.25, clearcoat: 0.9 });
  const calyx = matte("#3f7f3a");
  const one = (r, x, y, z) => {
    g.add(at(lathe([[0, r * 0.1], [r * 0.6, 0], [r * 1.02, r * 0.45], [r * 1.05, r * 0.95], [r * 0.85, r * 1.42], [r * 0.4, r * 1.6], [0, r * 1.52]], flesh, 24), x, y, z));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.add(leaf(V(x, y + r * 1.56, z), V(Math.cos(a), 0.25, Math.sin(a)), r * 0.55, r * 0.22, calyx, 0.3));
    }
  };
  if (cherry) {
    // a clear punnet, the tomatoes heaped inside
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.07, 0.18, 2, 0.012), clearPlastic()), 0, 0.035, 0));
    for (let i = 0; i < 11; i++) one(0.03, ((i % 4) - 1.5) * 0.058, 0.008 + (i >= 8 ? 0.045 : 0), Math.floor(i / 4) % 2 ? -0.04 : 0.04);
    return [g, 0.28];
  }
  const r = 0.075;
  for (const [x, z] of pile(3, r)) one(r, x, 0, z);
  return [g, r * 4.2];
}

function capsicum(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d93a2f";
  const r = 0.09;
  const shine = skin(col, { roughness: 0.2, clearcoat: 1 });
  for (let i = 0; i < 2; i++) {
    const body = new THREE.Group();
    // four lobes round a blocky core, a thick green stalk on top
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 22, 16), shine);
      lobe.scale.set(0.95, 1.5, 0.95);
      body.add(at(lobe, Math.cos(a) * r * 0.4, r * 0.92, Math.sin(a) * r * 0.4));
    }
    body.add(rod(V(0, r * 1.75, 0), V(0.012, r * 2.15, 0.005), 0.016, 0.012, matte("#3f6f2f")));
    body.position.set((i - 0.5) * r * 2.2, 0, i ? -r * 0.7 : r * 0.4);
    body.rotation.y = i * 0.8;
    g.add(body);
  }
  return [g, r * 4.4];
}

function chilli(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d8362b";
  const v = item.look?.variant ?? "";
  const shine = skin(col, { roughness: 0.2, clearcoat: 0.95 });
  const stalk = matte("#3f7a2f");
  if (v === "bonnet") {
    // scotch bonnets: squat, wrinkled lanterns
    for (const [i, [x, z]] of pile(5, 0.038).entries()) {
      const pod = lumpy(0.038, shine, item.seed + i, 0.22);
      pod.scale.set(1.1, 0.75, 1.1);
      g.add(at(pod, x, 0.03, z));
      g.add(rod(V(x, 0.05, z), V(x + 0.005, 0.075, z), 0.006, 0.004, stalk));
    }
    return [g, 0.22];
  }
  // pods fanned out from their stalks, each bent in its own curve so they
  // read as chillies rather than a bundle of carrots: a green cap and a
  // hooked stalk at the shoulder, a glossy body curving to a fine tip
  const fat = v === "fat";
  const len = fat ? 0.15 : 0.2;
  const thick = fat ? 0.026 : 0.015;
  const n = fat ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const bend = (i % 2 ? 1 : -1) * (fat ? 0.03 : 0.05);
    const path = new THREE.CatmullRomCurve3([V(0, 0, 0), V(len * 0.45, 0, bend * 0.4), V(len * 0.8, 0, bend), V(len, 0, bend * 0.6)]);
    const pod = new THREE.Group();
    pod.add(taperedTube(path, thick, (t) => (t < 0.08 ? 0.75 + t * 3 : 1 - Math.pow((t - 0.08) / 0.92, 1.5) * 0.9), shine, 24, 12));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(thick * 1.05, 12, 8), stalk);
    cap.scale.set(0.6, 1, 1);
    pod.add(cap);
    pod.add(rod(V(-0.002, 0, 0), V(-0.03, 0.012, 0), 0.004, 0.0028, stalk));
    pod.add(rod(V(-0.03, 0.012, 0), V(-0.036, 0.028, 0), 0.0028, 0.0024, stalk));
    const a = (i - (n - 1) / 2) * 0.34;
    pod.rotation.y = -a;
    pod.position.set(-len * 0.45, thick, a * 0.05);
    g.add(pod);
  }
  return [g, len + 0.08];
}

function banana(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#f2d34d";
  const peel = skin(col, { roughness: 0.5, clearcoat: 0.3 });
  const tipMat = matte("#4a3a2a");
  // a hand of curved fingers lying on its side, joined at the crown
  const path = new THREE.CatmullRomCurve3([V(-0.2, 0.12, 0), V(-0.08, 0.035, 0), V(0.08, 0.03, 0), V(0.2, 0.1, 0)]);
  for (let i = 0; i < 4; i++) {
    const finger = taperedTube(path, 0.03, (t) => 0.4 + 0.6 * Math.sin(t * Math.PI), peel, 28, 6);
    const y = i < 2 ? 0 : 0.034;
    const z = i < 2 ? (i - 0.5) * 0.056 : (i - 2.5) * 0.05;
    g.add(at(finger, 0, y, z));
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), tipMat), 0.2, 0.1 + y, z));
  }
  g.add(rod(V(-0.2, 0.13, 0), V(-0.25, 0.17, 0), 0.02, 0.014, matte("#7a8a3a")));
  return [g, 0.48];
}

function carrot(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#ee8a2c";
  const parsnip = item.look?.variant === "parsnip";
  const root = skin(col, { roughness: 0.6, clearcoat: 0.15 });
  const ring = matte(shade(col, 0.8));
  const tops = matte("#5f9a3f");
  // two below, one across them; roots point left, tops fan right
  for (const [dx, z, y] of [[0, 0.038, 0], [0, -0.038, 0], [0.02, 0, 0.055]]) {
    const c = lathe([[0, 0], [0.006, 0.025], [0.02, 0.14], [0.034, 0.26], [0.032, 0.285], [0, 0.287]], root, 18);
    c.rotation.z = -Math.PI / 2;
    g.add(at(c, -0.16 + dx, 0.034 + y, z));
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const rr = 0.006 + t * 0.028;
      const m = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0015, 4, 16), ring);
      m.rotation.y = Math.PI / 2;
      g.add(at(m, -0.16 + dx + 0.025 + t * 0.235, 0.034 + y, z));
    }
    if (!parsnip) {
      const base = V(0.125 + dx, 0.034 + y, z);
      for (let k = 0; k < 4; k++) {
        const d = V(1, (k - 1.5) * 0.45, (k - 1.5) * 0.25).normalize();
        g.add(rod(base, base.clone().addScaledVector(d, 0.1), 0.005, 0.002, tops, 5));
        g.add(leaf(base.clone().addScaledVector(d, 0.075), d, 0.05, 0.028, tops, 0.3));
      }
    }
  }
  return [g, 0.42];
}

function potato(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#cfa86e";
  const v = item.look?.variant ?? "";
  const n = v === "baby" ? 6 : 3;
  const r = v === "baby" ? 0.04 : v === "long" ? 0.055 : 0.064;
  const stretch = v === "long" ? 1.9 : v === "round" ? 1.05 : v === "baby" ? 1.15 : 1.4;
  const peel = matte(col, { roughness: 0.92 });
  const eyes = matte(shade(col, 0.55));
  const rand = rng(item.seed);
  for (const [i, [x, z]] of pile(n, r * stretch, 1.9).entries()) {
    const p = lumpy(r, peel, item.seed + i * 7, 0.16);
    p.scale.set(stretch, 0.82, 1);
    p.rotation.y = (rand() - 0.5) * 0.6;
    g.add(at(p, x, r * 0.8, z));
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2;
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 6, 4), eyes), x + Math.cos(a) * r * stretch * 0.8, r * 0.8 + (rand() - 0.3) * r * 0.6, z + Math.sin(a) * r * 0.85));
    }
  }
  return [g, r * stretch * (n > 3 ? 6 : 4)];
}

function onion(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d39a52";
  const shallot = item.look?.variant === "shallot";
  const n = shallot ? 5 : 3;
  const r = shallot ? 0.042 : 0.074;
  const papery = skin(col, { roughness: 0.5, clearcoat: 0.45 });
  const stripe = matte(shade(col, 0.72));
  for (const [x, z] of pile(n, r)) {
    const bulb = lathe([[0, 0.004], [r * 0.25, 0], [r * 0.85, r * 0.35], [r * 1.0, r * 0.85], [r * 0.82, r * 1.35], [r * 0.38, r * 1.75], [r * 0.12, r * 2.05], [r * 0.05, r * 2.3], [0, r * 2.3]], papery, 28);
    if (shallot) bulb.scale.set(1, 1.2, 1);
    g.add(at(bulb, x, 0, z));
    // papery lines running pole to pole
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.0022, 4, 24, Math.PI * 0.6), stripe);
      s.rotation.set(0, (k / 7) * Math.PI * 2, Math.PI / 2);
      if (shallot) s.scale.set(1.2, 1, 1);
      g.add(at(s, x, r * (shallot ? 1.1 : 0.95), z));
    }
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.18, 0.01, 10), matte("#c9b08a")), x, 0.004, z));
  }
  return [g, r * 4.4];
}

function garlic(item) {
  const g = new THREE.Group();
  const papery = skin("#efe4d4", { roughness: 0.55, clearcoat: 0.3 });
  const streak = matte("#a8708a");
  const r = 0.062;
  for (const [i, [x, z]] of pile(2, r * 1.15).entries()) {
    const bulb = new THREE.Group();
    // cloves bulging round the middle, purple-streaked, drawn to a point
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const clove = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 14, 12), papery);
      clove.scale.set(0.8, 1.2, 0.8);
      bulb.add(at(clove, Math.cos(a) * r * 0.55, r * 0.85, Math.sin(a) * r * 0.55));
      bulb.add(rod(V(Math.cos(a) * r * 0.98, r * 0.35, Math.sin(a) * r * 0.98), V(Math.cos(a) * r * 0.62, r * 1.5, Math.sin(a) * r * 0.62), 0.0032, 0.002, streak, 4));
    }
    bulb.add(at(new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 1.0, 12), papery), 0, r * 1.75, 0));
    bulb.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.25, 0.012, 12), matte("#b8a07a")), 0, 0.006, 0));
    bulb.position.set(x, 0, z);
    bulb.rotation.y = i;
    g.add(bulb);
  }
  return [g, 0.26];
}

function broccoli(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#3f8a3e";
  const v = item.look?.variant ?? "";
  const cauli = v === "cauliflower";
  if (v === "stems") {
    // broccolini: long thin stems, small heads, lying in a bunch
    for (let i = 0; i < 6; i++) {
      const z = (i - 2.5) * 0.03;
      g.add(rod(V(-0.16, 0.012, z), V(0.1, 0.014 + (i % 2) * 0.01, z * 1.3), 0.008, 0.007, skin("#6f9a4f")));
      g.add(at(lumpy(0.028, matte(col), item.seed + i, 0.3), 0.13, 0.025 + (i % 2) * 0.01, z * 1.3));
    }
    return [g, 0.34];
  }
  const head = matte(col, { roughness: cauli ? 0.75 : 0.95 });
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.15, 12), skin(cauli ? "#d8dcc0" : "#7faf5a", { roughness: 0.55 })), 0, 0.075, 0));
  const florets = [[0, 0.2, 0, 0.085], [0.085, 0.175, 0.04, 0.065], [-0.085, 0.175, 0.04, 0.068], [0.04, 0.18, -0.075, 0.062], [-0.055, 0.17, -0.07, 0.062], [0, 0.15, 0.095, 0.06], [0.1, 0.14, -0.03, 0.055], [-0.1, 0.14, -0.02, 0.055]];
  for (const [i, [x, y, z, r]] of florets.entries()) g.add(at(lumpy(r, head, item.seed + i, cauli ? 0.12 : 0.3), x, y, z));
  if (!cauli) {
    // a scatter of tiny bud clusters so broccoli reads as florets, not a ball
    const rand = rng(item.seed);
    const bud = matte(shade(col, 0.8));
    for (let k = 0; k < 50; k++) {
      const a = rand() * Math.PI * 2;
      const up = rand();
      const rr = 0.135 * Math.sqrt(1 - up * up * 0.8);
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), bud), Math.cos(a) * rr, 0.15 + up * 0.13, Math.sin(a) * rr));
    }
  } else {
    // cauliflower's jacket of green leaves
    const jacket = skin("#6f9f4a", { side: THREE.DoubleSide });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      g.add(leaf(V(Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.04), V(Math.cos(a), 1.2, Math.sin(a)), 0.2, 0.1, jacket, 0.12));
    }
  }
  return [g, 0.32];
}

function cabbage(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#a9cf86";
  const v = item.look?.variant ?? "";
  const leafy = (c) => skin(c, { roughness: 0.55, side: THREE.DoubleSide });
  if (v === "long" || v === "bokchoy") {
    // wombok and bok choy: pale ribs fanning into green leaves, lying down
    const bok = v === "bokchoy";
    const n = bok ? 2 : 1;
    const len = bok ? 0.26 : 0.42;
    const rib = skin(bok ? "#eef2e2" : "#f0f2d8", { roughness: 0.45 });
    const blade = leafy(bok ? "#3f8f3f" : col);
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * 0.13;
      const base = lathe([[0, 0], [0.05, 0], [0.065, len * 0.3], [0.06, len * 0.6], [0.045, len], [0, len]], rib, 22);
      base.rotation.z = -Math.PI / 2;
      g.add(at(base, -len / 2, 0.06, z));
      for (let k = 0; k < 6; k++) g.add(leaf(V(len * 0.05, 0.06, z), V(1, (k % 2) * 0.3 + 0.1, (k - 2.5) * 0.25), len * 0.6, bok ? 0.09 : 0.12, blade, 0.25));
    }
    return [g, len + 0.1];
  }
  if (v === "fennel") {
    g.add(lathe([[0, 0], [0.07, 0.005], [0.09, 0.06], [0.07, 0.13], [0.03, 0.19], [0, 0.19]], skin(col, { roughness: 0.4 }), 24));
    const frond = matte("#6faf4a");
    for (let k = 0; k < 3; k++) {
      const top = V((k - 1) * 0.06, 0.34, 0);
      g.add(rod(V((k - 1) * 0.02, 0.17, 0), top, 0.014, 0.009, skin("#a8cf7a")));
      for (let f = 0; f < 6; f++) g.add(rod(top, top.clone().add(V(Math.cos(f) * 0.04, 0.03 + (f % 3) * 0.01, Math.sin(f) * 0.04)), 0.002, 0.001, frond, 4));
    }
    return [g, 0.2];
  }
  // a round head: a firm core wrapped in cupped outer leaves, pale veins
  const lettuce = v === "lettuce";
  const r = 0.14;
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.88, 28, 20), skin(col, { roughness: 0.45 }));
  core.scale.y = lettuce ? 0.85 : 0.92;
  g.add(at(core, 0, r * 0.85, 0));
  const outer = leafy(lettuce ? "#6fb04a" : shade(col, 0.85));
  const n = lettuce ? 11 : 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const cup = new THREE.Mesh(new THREE.SphereGeometry(r * 0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI * (lettuce ? 0.62 : 0.52)), outer);
    cup.scale.set(1, 1.15, lettuce ? 0.42 : 0.5);
    cup.position.set(Math.cos(a) * r * 0.5, r * (lettuce ? 0.62 : 0.72), Math.sin(a) * r * 0.5);
    cup.lookAt(V(Math.cos(a) * 3, r * (lettuce ? 2.4 : 1.6), Math.sin(a) * 3));
    cup.rotateX(-Math.PI / 2);
    g.add(cup);
  }
  const vein = matte(lettuce ? "#d8ecb8" : "#eef4d8");
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.003, 4, 20, Math.PI * 0.55), vein);
    m.rotation.set(0, Math.PI / 2 + (k - 1.5) * 0.5, Math.PI / 2);
    g.add(at(m, 0, r * 0.85, 0));
  }
  return [g, r * 2.3];
}

function avocado(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#3c4f26";
  const profile = [[0, 0.004], [0.05, 0], [0.072, 0.05], [0.07, 0.1], [0.05, 0.15], [0.037, 0.19], [0.018, 0.21], [0, 0.212]];
  const pebbly = matte(col, { roughness: 0.75, clearcoat: 0.25 });
  for (let i = 0; i < 2; i++) g.add(at(lathe(profile, pebbly, 26), (i - 0.5) * 0.15, 0, -0.05));
  // one cut in half: pale green flesh and the brown stone
  const half = lathe(profile, skin("#d6e08a", { roughness: 0.6 }), 24);
  half.scale.set(1, 1, 0.45);
  half.rotation.x = -Math.PI / 2 + 0.25;
  g.add(at(half, 0, 0.035, 0.12));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), skin("#7a4a2a")), 0, 0.075, 0.075));
  return [g, 0.3];
}

function mushroom(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#e8dccb";
  const dark = luminance(col) < 0.4;
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.06, 0.2, 2, 0.01), matte("#3a4652")), 0, 0.03, 0));
  const cap = skin(col, { roughness: 0.65, clearcoat: 0.2 });
  const gills = matte(dark ? "#d8c8a8" : "#9a7a5a");
  const stem = matte(dark ? "#e8dcc4" : "#f2ece0");
  // caps tipped towards you, so their gills and stems show
  for (const [i, [x, z]] of [[-0.085, 0.045], [0, 0.05], [0.085, 0.045], [-0.045, -0.04], [0.045, -0.04], [0, -0.005]].entries()) {
    const y = 0.07 + (i === 5 ? 0.03 : 0);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.048, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), cap);
    c.scale.set(1, dark ? 0.6 : 0.8, 1);
    c.rotation.x = 0.35;
    g.add(at(c, x, y, z));
    const under = new THREE.Mesh(new THREE.CircleGeometry(0.046, 20), gills);
    under.rotation.x = Math.PI / 2 + 0.35;
    g.add(at(under, x, y, z));
    g.add(rod(V(x, y - 0.035, z - 0.01), V(x, y, z), 0.016, 0.014, stem));
  }
  return [g, 0.32];
}

function cucumber(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#3f7a3a";
  const zuc = item.look?.variant === "zucchini";
  const r = zuc ? 0.04 : 0.044;
  const len = zuc ? 0.27 : 0.3;
  const peel = skin(col, { roughness: zuc ? 0.35 : 0.5 });
  const fleck = matte(zuc ? "#9ac87a" : "#6f9a4a");
  const rand = rng(item.seed);
  for (let i = 0; i < 2; i++) {
    const y = r + (i ? r * 1.55 : 0);
    const z = i ? -r * 0.4 : r * 0.6;
    const turn = i ? 0.12 : -0.05;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), peel);
    body.rotation.set(0, turn, Math.PI / 2);
    g.add(at(body, i * 0.03, y, z));
    if (zuc) {
      // a zucchini's pale speckled stripes, and its stalk
      for (let k = 0; k < 6; k++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, len * 0.9, 16, 1, true, k * 1.05, 0.16), fleck);
        s.rotation.set(0, turn, Math.PI / 2);
        g.add(at(s, i * 0.03, y, z));
      }
      g.add(rod(V(i * 0.03 - len / 2 - r * 0.8, y, z), V(i * 0.03 - len / 2 - r * 1.5, y + 0.01, z), 0.014, 0.01, matte("#7a8a3a")));
    } else {
      // a cucumber's bumpy skin
      for (let k = 0; k < 22; k++) {
        const a = rand() * Math.PI * 2;
        g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.006, 5, 4), fleck), i * 0.03 + (rand() - 0.5) * len, y + Math.cos(a) * r, z + Math.sin(a) * r));
      }
    }
  }
  return [g, len + r * 2.4];
}

function eggplant(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#4a2a4f";
  const gloss = skin(col, { roughness: 0.12, clearcoat: 1 });
  const capMat = matte("#4f7a3a");
  for (let i = 0; i < 2; i++) {
    const y = i ? 0.115 : 0.065;
    const z = i ? -0.05 : 0.04;
    const body = lathe([[0, 0], [0.04, 0.01], [0.068, 0.08], [0.062, 0.16], [0.04, 0.23], [0.024, 0.27], [0, 0.275]], gloss, 26);
    body.rotation.z = -Math.PI / 2 + 0.05;
    g.add(at(body, -0.16, y, z));
    // the green star-shaped cap gripping the top
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.add(leaf(V(0.112, y + Math.cos(a) * 0.012, z + Math.sin(a) * 0.012), V(-1, Math.cos(a) * 0.9, Math.sin(a) * 0.9), 0.045, 0.026, capMat, 0.25));
    }
    g.add(rod(V(0.11, y, z), V(0.16, y + 0.01, z), 0.01, 0.008, capMat));
  }
  return [g, 0.4];
}

function stalk(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#9ccb6f";
  const v = item.look?.variant ?? "celery";
  if (v === "leek") {
    const whitePart = skin("#f0f2e0", { roughness: 0.4 });
    const pale = skin("#c8dca0", { roughness: 0.4 });
    const flag = skin("#3f6f3a", { side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const y = 0.03 + i * 0.05;
      const z = i ? -0.02 : 0.03;
      g.add(rod(V(-0.3, y, z), V(-0.02, y, z), 0.03, 0.03, whitePart, 16));
      g.add(rod(V(-0.02, y, z), V(0.06, y, z), 0.03, 0.032, pale, 16));
      // the dark green flag leaves splaying apart
      for (let k = 0; k < 3; k++) g.add(leaf(V(0.05, y, z), V(1, (k - 1) * 0.25, (k - 1) * 0.18), 0.26, 0.06, flag, 0.12));
      g.add(rod(V(-0.31, y, z), V(-0.33, y, z), 0.022, 0.02, matte("#d8c8a8")));
    }
    return [g, 0.64];
  }
  if (v === "spring" || v === "lemongrass" || v === "asparagus") {
    const n = v === "asparagus" ? 8 : v === "lemongrass" ? 4 : 6;
    const thick = v === "lemongrass" ? 0.014 : v === "asparagus" ? 0.011 : 0.009;
    const pale = skin(v === "spring" ? "#f4f6ea" : v === "lemongrass" ? "#ecefd0" : col, { roughness: 0.45 });
    const green = skin(v === "asparagus" ? col : v === "lemongrass" ? "#b8cf82" : "#4f9a3a", { roughness: 0.45 });
    for (let i = 0; i < n; i++) {
      const y = thick + (i % 2) * thick * 1.6;
      const z = (i - (n - 1) / 2) * thick * 1.9;
      g.add(rod(V(-0.17, y, z), V(-0.03, y, z), thick * 1.2, thick, pale, 10));
      g.add(rod(V(-0.03, y, z), V(0.17, y + (v === "spring" ? (i % 3) * 0.006 : 0), z * 1.25), thick, thick * 0.6, green, 10));
      if (v === "asparagus") {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(thick * 1.25, 0.04, 10), skin("#5f7a3a"));
        tip.rotation.z = -Math.PI / 2;
        g.add(at(tip, 0.19, y, z * 1.25));
      }
      if (v === "spring") g.add(at(new THREE.Mesh(new THREE.SphereGeometry(thick * 1.5, 10, 8), pale), -0.175, y, z));
    }
    // the rubber band round the bunch
    const tie = new THREE.Mesh(new THREE.TorusGeometry(n * thick * 1.1, 0.004, 6, 20), matte("#3f7fd0"));
    tie.rotation.y = Math.PI / 2;
    tie.scale.set(1, 0.6, 1);
    g.add(at(tie, -0.06, thick * 1.6, 0));
    return [g, 0.38];
  }
  if (v === "rhubarb") {
    for (let i = 0; i < 4; i++) {
      const y = 0.015 + (i > 1 ? 0.025 : 0);
      g.add(rod(V(-0.28, y, (i % 2 ? -1 : 1) * 0.018), V(0.18, y, (i % 2 ? -1 : 1) * 0.018), 0.016, 0.014, skin(i % 2 ? col : mix(col, "#7faf4a", 0.3), { roughness: 0.4 }), 10));
    }
    g.add(leaf(V(0.17, 0.03, 0), V(1, 0.1, 0), 0.16, 0.18, skin("#4f8f3a", { side: THREE.DoubleSide }), 0.15));
    return [g, 0.56];
  }
  // celery: a bunch of ribbed, cupped stalks with a leafy top
  const ribMat = skin(col, { roughness: 0.4, side: THREE.DoubleSide });
  const top = skin("#5f9a3a", { side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.36, 10, 1, false, 0, Math.PI * 1.35), ribMat);
    s.rotation.set(2.2, 0, Math.PI / 2);
    g.add(at(s, -0.04, 0.022 + (i > 2 ? 0.026 : 0), ((i % 3) - 1) * 0.034));
  }
  for (let k = 0; k < 9; k++) g.add(leaf(V(0.12, 0.04, ((k % 3) - 1) * 0.03), V(1, (k % 3) * 0.35 - 0.1, ((k % 3) - 1) * 0.6), 0.07, 0.045, top, 0.2));
  return [g, 0.44];
}

function corn() {
  const g = new THREE.Group();
  const cob = pattern("kernels", (c, s) => {
    c.fillStyle = "#c89a1a";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#f4cf48";
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      c.beginPath();
      c.roundRect(x * 32 + 3, y * 32 + 3, 26, 26, 9);
      c.fill();
    }
  }, [6, 10]);
  const husk = skin("#a8cf6a", { roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 2; i++) {
    const y = 0.046 + (i ? 0.075 : 0);
    const z = i ? -0.015 : 0.03;
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.28, 8, 20), cob);
    c.rotation.z = Math.PI / 2;
    g.add(at(c, 0.02, y, z));
    // husk leaves peeled back from one end
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      g.add(leaf(V(-0.13, y + Math.cos(a) * 0.035, z + Math.sin(a) * 0.035), V(-1, Math.cos(a) * 0.6, Math.sin(a) * 0.6), 0.16, 0.06, husk, 0.15));
    }
    g.add(rod(V(-0.16, y, z), V(-0.22, y, z), 0.016, 0.014, matte("#9aa85a")));
  }
  return [g, 0.48];
}

function pumpkin(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#ee8f2e";
  if (item.look?.variant === "butternut") {
    const body = lathe([[0, 0], [0.07, 0.005], [0.088, 0.06], [0.07, 0.12], [0.045, 0.17], [0.043, 0.27], [0.03, 0.31], [0, 0.315]], skin(col, { roughness: 0.55 }), 26);
    body.rotation.z = -Math.PI / 2 + 0.04;
    g.add(at(body, -0.15, 0.088, 0));
    g.add(rod(V(0.16, 0.09, 0), V(0.19, 0.095, 0), 0.012, 0.01, matte("#6a5a3a")));
    return [g, 0.38];
  }
  // a whole pumpkin: squat, deeply ribbed, a stubby woody stem
  const R = 0.15;
  const geo = new THREE.SphereGeometry(R, 48, 24);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 - 0.08 * Math.pow(Math.abs(Math.cos(5 * Math.atan2(v.z, v.x))), 6);
    pos.setXYZ(i, v.x * k, v.y * 0.7, v.z * k);
  }
  geo.computeVertexNormals();
  g.add(at(new THREE.Mesh(geo, skin(col, { roughness: 0.5, clearcoat: 0.45 })), 0, R * 0.7, 0));
  g.add(rod(V(0, R * 1.3, 0), V(0.02, R * 1.6, 0.01), 0.022, 0.016, matte("#6a5a3a")));
  return [g, R * 2.1];
}

function ginger(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d7b07a";
  const root = matte(col, { roughness: 0.85 });
  const ring = matte(shade(col, 0.7));
  // a knobbly hand: a body with fingers branching off, faint rings round each
  const parts = [[0, 0.04, 0, 0.045, 1.7], [0.085, 0.045, 0.025, 0.03, 1.4], [-0.09, 0.04, -0.015, 0.032, 1.5], [0.035, 0.058, -0.055, 0.026, 1.3], [-0.035, 0.052, 0.055, 0.026, 1.3], [0.13, 0.05, -0.01, 0.022, 1.2]];
  for (const [i, [x, y, z, r, s]] of parts.entries()) {
    const k = lumpy(r, root, item.seed + i, 0.18);
    k.scale.set(s, 0.85, 1);
    k.rotation.y = i * 1.1;
    g.add(at(k, x, y, z));
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, 0.0018, 4, 16), ring);
    band.rotation.set(0, i * 1.1 + Math.PI / 2, 0);
    band.scale.set(1, 0.85, 1);
    g.add(at(band, x, y, z));
  }
  return [g, 0.32];
}

// Herbs stand in a glass of water, the way they keep in a fridge: each herb's
// leaf (flat parsley, round coriander, big basil, dill's fronds, rosemary's
// needles) reads above the rim, and a tag on the glass names it.
function herbs(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#4f9f45";
  const v = item.look?.variant ?? "flat";
  const rand = rng(item.seed);
  g.add(lathe([[0, 0], [0.052, 0], [0.058, 0.14]], glass(), 28));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.05, 0.09, 24), mat("#cfe8f0", { transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false })), 0, 0.048, 0));
  const woody = v === "sprig" || v === "needles";
  const stemMat = skin(woody ? "#7a6a4a" : v === "chives" ? col : "#7aa85a");
  const leafMat = skin(col, { roughness: v === "round" ? 0.3 : 0.55, side: THREE.DoubleSide });
  const n = v === "chives" ? 16 : woody ? 7 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.4;
    const spread = v === "chives" ? 0.04 : 0.07 + rand() * 0.03;
    const height = (v === "chives" ? 0.4 : woody ? 0.3 : 0.27) + rand() * 0.05;
    const top = V(Math.cos(a) * spread, height, Math.sin(a) * spread);
    g.add(rod(V(Math.cos(a) * 0.02, 0.01, Math.sin(a) * 0.02), top, v === "chives" ? 0.0035 : 0.003, v === "chives" ? 0.003 : 0.0022, stemMat, 5));
    const out = V(top.x, 0, top.z).normalize();
    const side = V(-out.z, 0, out.x);
    const dir = (up, s = 0) => out.clone().multiplyScalar(1 - up).add(V(0, up, 0)).addScaledVector(side, s);
    const along = (t) => V(top.x * t, 0.01 + (top.y - 0.01) * t, top.z * t);
    switch (v) {
      case "flat": // flat-leaf parsley: clusters of small pointed leaves
      case "lobed": // coriander: rounder, lighter, spread wider
        for (let k = 0; k < 5; k++) g.add(leaf(top, dir(0.5, (k - 2) * 0.55), v === "flat" ? 0.042 : 0.036, v === "flat" ? 0.024 : 0.034, leafMat, 0.2));
        break;
      case "round": // basil, sage, lime leaves: big ovals in pairs
        for (const t of [0.78, 1]) for (const s of [-1, 1]) g.add(leaf(along(t), dir(0.35, s * 0.9), 0.07, 0.045, leafMat, 0.25));
        break;
      case "mint": // pairs up the stem, each pair turned a quarter
        for (let k = 0; k < 4; k++) for (const s of [-1, 1]) g.add(leaf(along(0.62 + k * 0.12), dir(0.25, s * (k % 2 ? 1 : 0.2)), 0.045, 0.032, leafMat, 0.25));
        break;
      case "fine": // dill: feathery fronds fanning from the tip
        for (let k = 0; k < 9; k++) g.add(rod(top, top.clone().addScaledVector(dir(0.3 + rand() * 0.6, (rand() - 0.5) * 1.6), 0.06), 0.0018, 0.0008, leafMat, 3));
        break;
      case "needles": // rosemary: needles all along the upper stem
        for (let k = 0; k < 12; k++) {
          const p = along(0.45 + k * 0.045);
          g.add(rod(p, p.clone().addScaledVector(dir(0.3, k % 2 ? 1 : -1), 0.03), 0.0025, 0.0012, leafMat, 3));
        }
        break;
      case "sprig": // thyme: tiny leaves crowded on the upper stem
        for (let k = 0; k < 10; k++) g.add(leaf(along(0.5 + k * 0.05), dir(0.4, k % 2 ? 1 : -1), 0.014, 0.009, leafMat, 0.3));
        break;
      default: // chives: just the green stems
        break;
    }
  }
  g.add(at(flatLabel(nameOf(item), "#ffffff", 0.1, 0.045), 0, 0.105, 0.0585));
  return [g, 0.2];
}

function leaves(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#3f7f3a";
  // a salad bag standing up, leaves pressed against the film, name on top
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.38, 0.11, 3, 0.045), film()), 0, 0.19, 0));
  const rand = rng(item.seed);
  const sprouts = luminance(col) > 0.6;
  const greens = [skin(col, { roughness: 0.6 }), skin(mix(col, sprouts ? "#c8b88a" : "#a8d88a", 0.35), { roughness: 0.6 })];
  for (let i = 0; i < 26; i++) {
    const l = new THREE.Mesh(sprouts ? new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5) : new THREE.SphereGeometry(0.045, 10, 8), greens[i % 3 ? 0 : 1]);
    if (!sprouts) l.scale.set(1.2, 0.5, 0.25);
    l.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    g.add(at(l, (rand() - 0.5) * 0.22, 0.04 + rand() * 0.22, (rand() - 0.5) * 0.06));
  }
  g.add(at(flatLabel(nameOf(item), "#ffffff", 0.24, 0.075, { motif: "leaf" }), 0, 0.31, 0.0565));
  return [g, 0.3];
}

function berries(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d43a5a";
  const v = item.look?.variant ?? "";
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.08, 0.2, 2, 0.012), clearPlastic()), 0, 0.04, 0));
  const rand = rng(item.seed);
  const fruit = skin(col, { roughness: v === "grapes" ? 0.3 : 0.45, clearcoat: 0.7 });
  if (v === "strawberry") {
    const pip = matte("#f2d86a");
    const top = matte("#3f8a3a");
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.07;
      const z = (Math.floor(i / 3) - 1) * 0.055;
      const y = 0.07 + (i % 3 === 1 ? 0.02 : 0) + (i >= 6 ? 0.012 : 0);
      // tipped towards you: the red point down-front, green leaves up-back
      const b = lathe([[0, 0], [0.012, 0.006], [0.03, 0.03], [0.032, 0.05], [0.018, 0.062], [0, 0.064]], fruit, 16);
      b.rotation.x = Math.PI - 0.6;
      g.add(at(b, x, y, z));
      for (let k = 0; k < 5; k++) g.add(leaf(V(x, y + 0.012, z - 0.034), V(Math.cos(k * 1.26), 0.2, Math.sin(k * 1.26) - 0.8), 0.022, 0.012, top, 0.3));
      for (let k = 0; k < 4; k++) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0035, 4, 3), pip), x + (k - 1.5) * 0.012, y - 0.03, z + 0.03));
    }
    return [g, 0.28];
  }
  const r = v === "grapes" ? 0.022 : 0.016;
  const n = v === "grapes" ? 20 : 30;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), fruit);
    if (v === "grapes") b.scale.y = 1.15;
    g.add(at(b, (rand() - 0.5) * 0.2, 0.05 + rand() * 0.06, (rand() - 0.5) * 0.15));
  }
  return [g, 0.28];
}

function beans(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#4f9a3a";
  const v = item.look?.variant ?? "";
  if (v === "frozen") {
    // a bag of frozen peas: the way most peas come
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.3, 0.07, 3, 0.03), skin("#2f7a3a", { roughness: 0.35 })), 0, 0.15, 0));
    g.add(at(flatLabel(nameOf(item), "#2f7a3a", 0.22, 0.09, { motif: "pea" }), 0, 0.2, 0.0352));
    const pea = skin(col, { roughness: 0.35 });
    for (let k = 0; k < 7; k++) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), pea), (k - 3) * 0.028, 0.08 + (k % 2) * 0.016, 0.034));
    return [g, 0.26];
  }
  const pod = skin(col, { roughness: 0.4 });
  const rand = rng(item.seed);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.CapsuleGeometry(v === "flat" ? 0.012 : v === "pods" ? 0.014 : 0.0075, v ? 0.08 : 0.15, 4, 10), pod);
    if (v === "flat") p.scale.z = 0.45;
    p.rotation.set(0, (rand() - 0.5) * 0.6, Math.PI / 2);
    g.add(at(p, (rand() - 0.5) * 0.08, 0.009 + Math.floor(i / 6) * 0.014, ((i % 6) - 2.5) * 0.024));
  }
  return [g, 0.28];
}

function beetroot(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#7a1f3a";
  const root = skin(col, { roughness: 0.6 });
  const stem = skin("#b8284a");
  const leafMat = skin("#3f6f3a", { side: THREE.DoubleSide });
  for (const [x, z] of pile(3, 0.065)) {
    g.add(at(lathe([[0, 0], [0.012, 0.006], [0.05, 0.035], [0.062, 0.07], [0.05, 0.11], [0.022, 0.125], [0, 0.127]], root, 22), x, 0, z));
    for (let k = 0; k < 3; k++) {
      const b = V(x + (k - 1) * 0.03, 0.21, z + (k - 1) * 0.01);
      g.add(rod(V(x, 0.12, z), b, 0.005, 0.004, stem, 5));
      g.add(leaf(b, V((k - 1) * 0.5, 1, 0.2), 0.07, 0.04, leafMat, 0.2));
    }
  }
  return [g, 0.3];
}

function mango(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#f2a63a";
  const peel = skin(col, { roughness: 0.4, clearcoat: 0.6 });
  const blush = skin("#d85a3a", { transparent: true, opacity: 0.5 });
  for (let i = 0; i < 2; i++) {
    const x = (i - 0.5) * 0.19;
    const z = i ? -0.03 : 0.04;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 26, 18), peel);
    m.scale.set(1.3, 0.92, 0.85);
    m.rotation.z = 0.15;
    g.add(at(m, x, 0.069, z));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), blush);
    b.scale.set(1.2, 0.8, 0.5);
    g.add(at(b, x - 0.035, 0.09, z + 0.04));
  }
  return [g, 0.38];
}

function pineapple() {
  const g = new THREE.Group();
  const scales = pattern("pineapple", (c, s) => {
    c.fillStyle = "#7a5a1a";
    c.fillRect(0, 0, s, s);
    const cells = [[0, 0], [32, 32], [64, 0], [0, 64], [64, 64]];
    c.fillStyle = "#c8962a";
    for (const [x, y] of cells) {
      c.beginPath();
      c.moveTo(x, y - 26);
      c.lineTo(x + 26, y);
      c.lineTo(x, y + 26);
      c.lineTo(x - 26, y);
      c.fill();
    }
    c.fillStyle = "#5a3a10";
    for (const [x, y] of cells) {
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    }
  }, [8, 5]);
  g.add(lathe([[0, 0], [0.07, 0.005], [0.088, 0.07], [0.088, 0.19], [0.07, 0.25], [0, 0.26]], scales, 28));
  const crown = skin("#4f8a3a", { side: THREE.DoubleSide });
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    g.add(leaf(V(Math.cos(a) * 0.012, 0.25, Math.sin(a) * 0.012), V(Math.cos(a), k % 2 ? 2.4 : 1.4, Math.sin(a)), k % 2 ? 0.2 : 0.15, 0.03, crown, 0.15));
  }
  return [g, 0.2];
}

/* ---------------- the fridge's packaging ---------------- */

function milk(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#3f7fd0";
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.46, 0.24, 3, 0.015), white()), 0, 0.23, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.17, 0.11, 4, 1), white());
  roof.rotation.y = Math.PI / 4;
  g.add(at(roof, 0, 0.515, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.012), white()), 0, 0.585, 0));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 16), mat(col));
  cap.rotation.x = 0.5;
  g.add(at(cap, 0, 0.53, 0.06));
  // a colour band round the bottom and the name across the front
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.242, 0.16, 0.242, 2, 0.012), mat(col, { roughness: 0.45 })), 0, 0.1, 0));
  g.add(at(flatLabel(nameOf(item), col, 0.22, 0.12, { motif: "cow" }), 0, 0.3, 0.1215));
  return [g, 0.28];
}

function cream(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#d9a43a";
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.24, 0.12, 3, 0.012), white()), 0, 0.12, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.1, 0.06, 4, 1), white());
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.8;
  g.add(at(roof, 0, 0.27, 0));
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.152, 0.07, 0.122, 2, 0.01), mat(col)), 0, 0.04, 0));
  g.add(at(flatLabel(nameOf(item), col, 0.14, 0.1), 0, 0.15, 0.0612));
  return [g, 0.18];
}

function juice(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#f29a2e";
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.5, 0.13, 3, 0.02), mat(col, { roughness: 0.35, clearcoat: 0.7 })), 0, 0.25, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 18), white()), 0, 0.52, 0));
  g.add(at(flatLabel(nameOf(item), "#ffffff", 0.18, 0.12), 0, 0.33, 0.066));
  // a slice of the fruit
  g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), skin(mix(col, "#ffffff", 0.2))), 0, 0.15, 0.066));
  for (let k = 0; k < 4; k++) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.003, 0.09), white());
    seg.rotation.z = (k / 4) * Math.PI;
    g.add(at(seg, 0, 0.15, 0.067));
  }
  return [g, 0.24];
}

function tub(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#5f9fd8";
  const v = item.look?.variant ?? "";
  const r = v === "big" ? 0.12 : v === "flat" ? 0.11 : 0.1;
  const h = v === "flat" ? 0.08 : v === "big" ? 0.15 : 0.12;
  g.add(lathe([[0, 0], [r * 0.85, 0], [r, h], [0, h]], white()));
  // the label follows the tub's flare, so it sits on the wall
  const y0 = h * 0.12;
  const y1 = h * 0.9;
  const rAt = (y) => r * 0.85 + (r * 0.15 * y) / h + 0.002;
  g.add(at(wrapLabel(nameOf(item), col, rAt(y1), y1 - y0, { rBot: rAt(y0), arc: Math.PI * 1.3 }), 0, (y0 + y1) / 2, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.006, r + 0.006, 0.022, 32), mat(col, { roughness: 0.3 })), 0, h + 0.011, 0));
  return [g, r * 2 + 0.04];
}

function butter(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#e9c53a";
  // a foil-wrapped block, the name printed down the side that faces you
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.085, 0.14, 3, 0.012), mat("#e8e2d0", { metalness: 0.5, roughness: 0.35 })), 0, 0.0425, 0));
  g.add(at(flatLabel(nameOf(item), col, 0.24, 0.07, { motif: "cow" }), 0, 0.0425, 0.0705));
  const top = flatLabel(nameOf(item), col, 0.24, 0.12);
  top.rotation.x = -Math.PI / 2;
  g.add(at(top, 0, 0.0855, 0));
  return [g, 0.3];
}

function eggs() {
  const g = new THREE.Group();
  // an open carton: a moulded tray, the lid tipped back, six brown eggs
  const pulp = matte("#cfc2a8");
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.06, 0.2, 2, 0.015), pulp), 0, 0.03, 0));
  const lid = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.03, 0.2, 2, 0.012), pulp);
  lid.rotation.x = -0.35;
  g.add(at(lid, 0, 0.03, -0.2));
  const shell = skin("#e9c8a0", { roughness: 0.6, clearcoat: 0.1 });
  for (let i = 0; i < 6; i++) {
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.043, 22, 16), shell);
    egg.scale.y = 1.3;
    g.add(at(egg, -0.105 + (i % 3) * 0.105, 0.095, i < 3 ? 0.047 : -0.047));
  }
  return [g, 0.36];
}

function cheese(item) {
  const g = new THREE.Group();
  const col = item.look?.colour ?? "#f2c64a";
  const v = item.look?.variant ?? "wedge";
  const name = nameOf(item);
  if (v === "ball") {
    // mozzarella: a white ball in a bag of whey
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.065, 26, 18), skin(col, { roughness: 0.3 })), 0, 0.065, 0));
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.09, 22, 16), mat("#eef4f6", { transparent: true, opacity: 0.25, depthWrite: false }));
    bag.scale.set(1.2, 0.85, 1);
    g.add(at(bag, 0, 0.076, 0));
    g.add(at(flatLabel(name, "#2f8a3a", 0.16, 0.05), 0, 0.06, 0.1));
    return [g, 0.24];
  }
  if (v === "block" || v === "cube") {
    // a vacuum-packed block: cheddar's gold, feta's white
    const cube = v === "cube";
    const [w, h, d] = cube ? [0.15, 0.085, 0.12] : [0.26, 0.075, 0.13];
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.008), skin(col, { roughness: 0.6 })), 0, h / 2, 0));
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(w + 0.006, h + 0.006, d + 0.006, 3, 0.01), film()), 0, h / 2, 0));
    g.add(at(flatLabel(name, cube ? "#2f6fa8" : "#1f3a6a", w * 0.86, h * 0.66), 0, h / 2, d / 2 + 0.004));
    return [g, w + 0.04];
  }
  if (v === "round") {
    // brie, camembert, gouda: a round, its label on the rim
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.055, 36), skin(col, { roughness: 0.75 })), 0, 0.0275, 0));
    g.add(at(wrapLabel(name, "#5f3a7a", 0.1015, 0.04, { arc: Math.PI * 0.8 }), 0, 0.03, 0));
    return [g, 0.24];
  }
  if (v === "log") {
    const log = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.14, 6, 18), skin(col, { roughness: 0.8 }));
    log.rotation.z = Math.PI / 2;
    g.add(at(log, 0, 0.04, 0));
    g.add(at(wrapLabel(name, "#5f8a5a", 0.0415, 0.1, { arc: Math.PI * 0.9 }).rotateZ(Math.PI / 2), 0, 0.04, 0));
    return [g, 0.24];
  }
  // a wedge: pale paste, a darker rind on the round side, a label in front
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.3, -0.075);
  shape.lineTo(0.3, 0.075);
  shape.closePath();
  const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2 }), skin(col, { roughness: 0.65 }));
  wedge.rotation.x = -Math.PI / 2;
  g.add(at(wedge, -0.15, 0, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.125, 0.16), matte(shade(col, 0.7))), 0.157, 0.063, 0));
  const label = flatLabel(name, "#2f3f6a", 0.15, 0.05);
  label.rotation.y = -0.245;
  g.add(at(label, 0.0, 0.06, 0.042));
  return [g, 0.34];
}

// Meat and fish on a black tray under clear film, each in its own cut, with
// the butcher's sticker on the front.
const MEAT = "#c84a44";
function tray(item) {
  const g = new THREE.Group();
  const v = item.look?.variant ?? "diced";
  const col = item.look?.colour;
  const rand = rng(item.seed);
  const W = 0.38;
  const D = 0.25;
  const meat = (c, opts = {}) => skin(c, { roughness: 0.55, clearcoat: 0.45, ...opts });
  if (v === "tofu") {
    // tofu comes in a water-filled tub, not on a tray
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.1, 0.16, 2, 0.012), clearPlastic()), 0, 0.05, 0));
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.075, 0.13, 2, 0.008), skin("#f6f0dc", { roughness: 0.75 })), 0, 0.042, 0));
    g.add(at(flatLabel(nameOf(item), "#2f8a5a", 0.2, 0.05), 0, 0.075, 0.081));
    return [g, 0.28];
  }
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(W, 0.035, D, 3, 0.012), matte("#2a3236")), 0, 0.0175, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.004, D - 0.06), matte("#f4f2ee")), 0, 0.036, 0));
  const y0 = 0.038;
  let top = 0.1;
  switch (v) {
    case "mince": {
      // a heaped block of mince, its surface worm-cast textured
      const base = col ?? "#d0625a";
      const mound = lumpy(0.13, matte(base, { roughness: 0.95 }), item.seed, 0.08);
      mound.scale.set(1.2, 0.42, 0.8);
      g.add(at(mound, 0, y0 + 0.02, 0));
      const strand = matte(mix(base, "#f4d0c4", 0.3));
      for (let k = 0; k < 70; k++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * 0.95;
        const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.0045, 0.012, 2, 5), strand);
        s.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        g.add(at(s, Math.cos(a) * rr * 0.15, y0 + 0.02 + 0.055 * Math.sqrt(Math.max(0, 1 - rr * rr)), Math.sin(a) * rr * 0.105));
      }
      top = 0.12;
      break;
    }
    case "steak":
    case "chops": {
      const chops = v === "chops";
      const n = chops ? 3 : 2;
      const s = chops ? 0.72 : 1;
      const marble = matte("#f0c8c0");
      const fatMat = matte("#f6eadc");
      for (let i = 0; i < n; i++) {
        const shape = new THREE.Shape();
        shape.moveTo(-0.08 * s, -0.05 * s);
        shape.quadraticCurveTo(0, -0.09 * s, 0.09 * s, -0.045 * s);
        shape.quadraticCurveTo(0.11 * s, 0.04 * s, 0.04 * s, 0.065 * s);
        shape.quadraticCurveTo(-0.08 * s, 0.085 * s, -0.09 * s, 0);
        shape.closePath();
        // tipped up towards you so the cut face shows
        const cut = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006 }), meat(col ?? MEAT));
        cut.rotation.x = -Math.PI / 2 + 0.3;
        const x = (i - (n - 1) / 2) * (chops ? 0.115 : 0.17);
        g.add(at(cut, x, y0 + 0.02, 0));
        const fat = new THREE.Mesh(new THREE.TorusGeometry(0.075 * s, 0.009, 6, 18, Math.PI * 0.9), fatMat);
        fat.rotation.set(-Math.PI / 2 + 0.3, 0, 0.2);
        g.add(at(fat, x, y0 + 0.035, -0.012));
        for (let k = 0; k < 3; k++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, 0.002, 0.004), marble);
          m.rotation.set(0.3, rand() * 2, 0);
          g.add(at(m, x + (rand() - 0.5) * 0.06, y0 + 0.052 + k * 0.006, 0.01 + (k - 1) * 0.02));
        }
        if (chops) g.add(rod(V(x + 0.05, y0 + 0.04, -0.03), V(x + 0.11, y0 + 0.05, -0.05), 0.008, 0.007, matte("#f4ecdc")));
      }
      break;
    }
    case "roast": {
      const roast = lumpy(0.08, meat(col ?? MEAT, { roughness: 0.6 }), item.seed, 0.1);
      roast.scale.set(1.75, 0.9, 1.2);
      g.add(at(roast, 0, y0 + 0.07, 0));
      // butcher's string
      const string = matte("#f6f0e0");
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.0035, 4, 24), string);
        s.rotation.y = Math.PI / 2;
        s.scale.set(1, 0.92, 1.22);
        g.add(at(s, (k - 1.5) * 0.06, y0 + 0.07, 0));
      }
      top = 0.17;
      break;
    }
    case "diced": {
      const m = meat(col ?? MEAT, { roughness: 0.6 });
      for (let k = 0; k < 16; k++) {
        const cube = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.044, 0.05, 2, 0.01), m);
        cube.rotation.set(rand(), rand() * 3, rand());
        g.add(at(cube, (rand() - 0.5) * 0.26, y0 + 0.024 + (k > 10 ? 0.035 : 0), (rand() - 0.5) * 0.15));
      }
      break;
    }
    case "bacon": {
      // rashers laid overlapping and propped up towards you on a card, the
      // way bacon is packed: each a wavy strip of red lean with a white
      // rind of fat along one edge
      const lean = skin("#c8504a", { roughness: 0.45 });
      const fat = skin("#f8e6dc", { roughness: 0.5 });
      const card = new THREE.Group();
      card.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.004), matte("#e8d8b8")), 0, 0.1, -0.004));
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 7; k++) {
          const wave = Math.sin(k * 1.7 + i * 2) * 0.004;
          const x = -0.13 + k * 0.043;
          card.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.034, 0.005), lean), x, 0.04 + i * 0.045, wave + i * 0.004));
          card.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.014, 0.005), fat), x, 0.066 + i * 0.045, wave + i * 0.004));
        }
      }
      card.rotation.x = -0.95;
      g.add(at(card, 0, y0 + 0.004, 0.06));
      top = 0.17;
      break;
    }
    case "ham": {
      // round slices fanned on a card propped towards you, each a deep pink
      // face with a pale rim of fat
      const face = meat(col ?? "#e58a8c", { roughness: 0.4 });
      const rim = matte("#f8ece4");
      const card = new THREE.Group();
      card.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.17, 0.004), matte("#eadcc0")), 0, 0.085, -0.004));
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.06;
        const z = i * 0.003;
        card.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.07, 30), rim), x, 0.085, z));
        card.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.062, 30), face), x, 0.085, z + 0.0008));
      }
      card.rotation.x = -0.9;
      g.add(at(card, 0, y0 + 0.004, 0.055));
      top = 0.15;
      break;
    }
    case "smoked": {
      // folded ribbons of deep orange salmon, striped with white fat, on a
      // gold card propped towards you
      const flesh = meat("#f0703e", { roughness: 0.35, clearcoat: 0.7 });
      const fat = matte("#fbd6c0");
      const card = new THREE.Group();
      card.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.17, 0.004), mat("#d8b04a", { metalness: 0.5, roughness: 0.35 })), 0, 0.085, -0.004));
      for (let i = 0; i < 3; i++) {
        const y = 0.035 + i * 0.05;
        const ribbon = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.046, 0.008, 2, 0.004), flesh);
        ribbon.rotation.z = (i - 1) * 0.06;
        card.add(at(ribbon, 0, y, 0.004 + i * 0.003));
        for (let k = 0; k < 7; k++) {
          const line = new THREE.Mesh(new THREE.PlaneGeometry(0.003, 0.044), fat);
          line.rotation.z = 0.5 + (i - 1) * 0.06;
          card.add(at(line, -0.12 + k * 0.04, y, 0.0092 + i * 0.003));
        }
      }
      card.rotation.x = -0.9;
      g.add(at(card, 0, y0 + 0.004, 0.055));
      top = 0.15;
      break;
    }
    case "salami":
    case "sausages": {
      const salami = v === "salami";
      const casing = meat(col ?? (salami ? "#a8302a" : "#c8806a"), { roughness: 0.3, clearcoat: 0.8 });
      const n = salami ? 2 : 5;
      const r = salami ? 0.034 : 0.022;
      for (let i = 0; i < n; i++) {
        const layer = !salami && i >= 3 ? 1 : 0;
        const s = new THREE.Mesh(new THREE.CapsuleGeometry(r, salami ? 0.2 : 0.23, 6, 16), casing);
        s.rotation.set(0, (rand() - 0.5) * 0.1, Math.PI / 2);
        g.add(at(s, 0, y0 + r + layer * r * 1.6, salami ? (i - 0.5) * 0.08 : layer ? (i - 3.5) * 0.045 : (i - 1) * 0.048));
      }
      if (salami) {
        // a cut end showing the mottled inside
        const end = new THREE.Mesh(new THREE.CircleGeometry(0.033, 20), matte("#c84a4a"));
        end.rotation.y = Math.PI / 2;
        g.add(at(end, 0.135, y0 + 0.034, 0.04));
        const speck = matte("#f6e0d8");
        for (let k = 0; k < 6; k++) {
          const d = new THREE.Mesh(new THREE.CircleGeometry(0.004, 6), speck);
          d.rotation.y = Math.PI / 2;
          g.add(at(d, 0.136, y0 + 0.034 + Math.cos(k) * 0.018, 0.04 + Math.sin(k * 2) * 0.018));
        }
      }
      break;
    }
    case "breast":
    case "thigh": {
      const breast = v === "breast";
      const m = meat(breast ? "#f4c6b6" : "#eaa79a", { roughness: 0.45 });
      for (let i = 0; i < 2; i++) {
        const piece = lumpy(0.07, m, item.seed + i, breast ? 0.06 : 0.16);
        piece.scale.set(breast ? 1.55 : 1.15, 0.42, breast ? 0.8 : 1);
        piece.rotation.y = breast ? (i ? 0.3 : -0.2) : i;
        g.add(at(piece, (i - 0.5) * 0.17, y0 + 0.028, i ? -0.02 : 0.03));
      }
      if (!breast) {
        // skin-on thighs: pale skin folded over the top
        const s = skin("#f2dcc0", { roughness: 0.5 });
        for (let i = 0; i < 2; i++) {
          const p = lumpy(0.06, s, item.seed + 9 + i, 0.2);
          p.scale.set(1.1, 0.3, 0.8);
          g.add(at(p, (i - 0.5) * 0.17, y0 + 0.045, i ? -0.03 : 0.02));
        }
      }
      break;
    }
    case "drumstick": {
      const m = meat("#f0bea4", { roughness: 0.5 });
      const bone = matte("#f6ecdc");
      for (let i = 0; i < 3; i++) {
        const z = (i - 1) * 0.07;
        const leg = lathe([[0, 0], [0.012, 0], [0.012, 0.07], [0.03, 0.1], [0.045, 0.15], [0.038, 0.18], [0, 0.19]], m, 16);
        leg.rotation.z = -Math.PI / 2;
        g.add(at(leg, -0.1, y0 + 0.04, z));
        g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), bone), -0.105, y0 + 0.04, z));
      }
      break;
    }
    case "whole": {
      const m = meat("#f2c8a4", { roughness: 0.45 });
      const body = lumpy(0.1, m, item.seed, 0.05);
      body.scale.set(1.25, 0.82, 1);
      g.add(at(body, -0.02, y0 + 0.08, 0));
      for (const s of [-1, 1]) {
        g.add(rod(V(0.06, y0 + 0.06, s * 0.05), V(0.15, y0 + 0.1, s * 0.055), 0.03, 0.022, m));
        g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), matte("#f6ecdc")), 0.16, y0 + 0.105, s * 0.055));
      }
      top = 0.2;
      break;
    }
    case "salmon": {
      // thick orange fillets on their silver skin, pale lines of fat across
      const flesh = meat("#f58a5e", { roughness: 0.4, clearcoat: 0.6 });
      const silver = skin("#9aa4ac", { metalness: 0.4 });
      const line = matte("#fdd8c4");
      for (let i = 0; i < 2; i++) {
        const x = (i - 0.5) * 0.165;
        g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.008, 0.11, 2, 0.003), silver), x, y0 + 0.004, 0));
        g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.045, 0.11, 3, 0.015), flesh), x, y0 + 0.03, 0));
        for (let k = 0; k < 5; k++) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.047, 0.112), line);
          l.rotation.y = 0.45;
          g.add(at(l, x - 0.056 + k * 0.028, y0 + 0.03, 0));
        }
      }
      break;
    }
    case "fish": {
      const flesh = meat("#f6f0e8", { roughness: 0.35, clearcoat: 0.6 });
      for (let i = 0; i < 2; i++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.2, 6, 16), flesh);
        f.rotation.z = Math.PI / 2;
        f.scale.set(1, 1, 0.5);
        g.add(at(f, 0, y0 + 0.022 + i * 0.03, (i - 0.5) * 0.09));
      }
      // a lemon wedge, the fishmonger's touch that says "fish"
      const wedge = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8, 0, Math.PI), skin("#f2d24b"));
      wedge.scale.set(1.4, 1, 0.9);
      g.add(at(wedge, 0.14, y0 + 0.012, 0.07));
      break;
    }
    case "prawns": {
      const shell = meat("#f27a4a", { roughness: 0.35, clearcoat: 0.7 });
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.013, 8, 16, Math.PI * 1.3), shell);
        p.rotation.set(0.9, 0, rand() * 3);
        g.add(at(p, ((i % 4) - 1.5) * 0.08, y0 + 0.035 + (i >= 4 ? 0.01 : 0), i < 4 ? 0.05 : -0.04));
      }
      break;
    }
    case "squid": {
      const m = meat("#f4ecf0", { roughness: 0.3 });
      for (let i = 0; i < 3; i++) {
        const tube = lathe([[0, 0], [0.028, 0.012], [0.032, 0.12], [0.014, 0.17], [0, 0.175]], m, 16);
        tube.rotation.z = -Math.PI / 2;
        g.add(at(tube, -0.09, y0 + 0.03 + (i === 1 ? 0.03 : 0), (i - 1) * 0.06));
      }
      break;
    }
    case "mussels": {
      const shell = skin("#23232f", { roughness: 0.25, clearcoat: 0.9 });
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), shell);
        s.scale.set(1.7, 0.55, 0.85);
        s.rotation.y = rand() * 3;
        g.add(at(s, (rand() - 0.5) * 0.24, y0 + 0.018 + (i > 5 ? 0.025 : 0), (rand() - 0.5) * 0.14));
      }
      break;
    }
    case "belly": {
      // a slab whose cut face shows its layers of fat and lean
      ["#f8ecde", "#d8786a", "#f8ecde", "#d8786a", "#e8c8a0"].forEach((c, k) => {
        g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.014, 0.17), skin(c, { roughness: 0.5 })), 0, y0 + 0.007 + k * 0.014, 0));
      });
      break;
    }
    default:
      break;
  }
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(W, top, D, 3, 0.025), film()), 0, top / 2, 0));
  const sticker = flatLabel(nameOf(item), "#ffffff", 0.24, 0.06);
  sticker.rotation.x = -0.15;
  g.add(at(sticker, 0.03, 0.03, D / 2 + 0.004));
  return [g, W + 0.02];
}

/* ---------------- the pantry's packaging ---------------- */

function jar(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const v = look.variant ?? "";
  const small = v === "small";
  const tall = v === "olives" || v === "pickles";
  const r = small ? 0.065 : v === "honey" ? 0.08 : 0.085;
  const h = small ? 0.18 : tall ? 0.28 : 0.24;
  const pts = [[0, 0], [r * 0.9, 0], [r, r * 0.15], [r, h * 0.85], [r * 0.86, h * 0.92], [r * 0.86, h], [0, h]];
  const fillCol = look.fill ?? "#a8743a";
  const inner = pts.map(([x, y]) => [x * 0.93, y * 0.88]);
  if (tall) {
    // olives or pickles floating in brine
    g.add(at(lathe(inner, mat(v === "olives" ? "#c8c08a" : "#d8d8a0", { transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false })), 0, 0.006, 0));
    const fruit = skin(fillCol, { clearcoat: 0.8, roughness: 0.3 });
    for (let i = 0; i < (v === "olives" ? 16 : 5); i++) {
      const a = i * 2.3;
      const o = v === "olives" ? new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 9), fruit) : new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.15, 4, 10), fruit);
      if (v === "olives") o.scale.y = 1.3;
      g.add(at(o, Math.cos(a) * r * 0.48, v === "olives" ? 0.03 + (i % 6) * 0.036 : 0.115, Math.sin(a) * r * 0.48));
    }
  } else {
    const glossy = v === "jam" || v === "honey";
    g.add(at(lathe(inner, skin(fillCol, { roughness: glossy ? 0.15 : 0.55, clearcoat: glossy ? 0.9 : 0.2 })), 0, 0.006, 0));
  }
  g.add(lathe(pts, glass(), 36));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.04, 32), mat(look.colour ?? "#e2be62", { metalness: 0.4, roughness: 0.3 })), 0, h + 0.02, 0));
  if (v === "jam") {
    // gingham over the lid, the way homemade jam is sold
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.0, r * 1.12, 0.035, 32), matte("#f4f0ea")), 0, h + 0.035, 0));
  }
  g.add(at(wrapLabel(nameOf(item), look.colour ?? "#c8643a", r * 1.01, h * 0.6, { motif: motifFor(item) }), 0, h * 0.47, 0));
  return [g, r * 2 + 0.03];
}

// Each shape of bottle: its profile, where its label sits [y, height], and its
// cap [y, radius, colour].
const BOTTLES = {
  oil: { pts: [[0, 0], [0.068, 0], [0.072, 0.02], [0.072, 0.4], [0.052, 0.47], [0.024, 0.52], [0.022, 0.58], [0, 0.58]], label: [0.24, 0.2], cap: [0.6, 0.026] },
  wine: { pts: [[0, 0], [0.068, 0], [0.072, 0.02], [0.072, 0.36], [0.055, 0.43], [0.021, 0.49], [0.02, 0.6], [0, 0.6]], label: [0.18, 0.15], cap: [0.62, 0.023, "#6a1a24"] },
  squeeze: { pts: [[0, 0], [0.05, 0], [0.065, 0.05], [0.066, 0.27], [0.056, 0.31], [0.03, 0.33], [0, 0.33]], label: [0.16, 0.15], cap: [0.355, 0.032] },
  small: { pts: [[0, 0], [0.045, 0], [0.048, 0.01], [0.048, 0.2], [0.032, 0.235], [0.017, 0.27], [0, 0.27]], label: [0.1, 0.11], cap: [0.285, 0.02, "#2f3437"] },
  tiny: { pts: [[0, 0], [0.034, 0], [0.036, 0.01], [0.036, 0.13], [0.022, 0.15], [0.013, 0.17], [0, 0.17]], label: [0.07, 0.07], cap: [0.18, 0.015, "#2f3437"] },
  squat: { pts: [[0, 0], [0.07, 0], [0.076, 0.02], [0.076, 0.2], [0.06, 0.24], [0.036, 0.27], [0.034, 0.29], [0, 0.29]], label: [0.11, 0.13], cap: [0.31, 0.038, "#2f3437"] },
  jar: { pts: [[0, 0], [0.07, 0], [0.076, 0.02], [0.076, 0.22], [0.062, 0.26], [0.04, 0.29], [0.038, 0.31], [0, 0.31]], label: [0.12, 0.14], cap: [0.33, 0.042, "#e2be62"] },
  sauce: { pts: [[0, 0], [0.054, 0], [0.058, 0.015], [0.058, 0.25], [0.042, 0.31], [0.019, 0.37], [0.017, 0.43], [0, 0.43]], label: [0.14, 0.15], cap: [0.45, 0.021, "#2f3437"] },
};

function bottle(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const v = look.variant ?? "sauce";
  const col = look.colour ?? "#a83a2a";
  const s = BOTTLES[v] ?? BOTTLES.sauce;
  const r = Math.max(...s.pts.map(([x]) => x));
  const squeeze = v === "squeeze";
  // what's inside, through clear glass; a squeeze bottle is coloured plastic
  g.add(at(lathe(s.pts.map(([x, y]) => [x * 0.9, y * 0.93]), squeeze ? skin(col, { roughness: 0.3 }) : skin(look.fill ?? "#a8641e", { roughness: 0.1, clearcoat: 1 })), 0, 0.004, 0));
  if (!squeeze) g.add(lathe(s.pts, glass(), 36));
  const [capY, capR, capCol = col] = s.cap;
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(capR, capR, 0.04, 20), mat(capCol, { roughness: 0.35, metalness: v === "wine" ? 0.4 : 0.1 })), 0, capY, 0));
  const [labelY, labelH] = s.label;
  g.add(at(wrapLabel(nameOf(item), squeeze ? "#ffffff" : col, r * 1.015, labelH, { motif: motifFor(item) }), 0, labelY, 0));
  return [g, r * 2 + 0.03];
}

function can(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const v = look.variant ?? "";
  const [r, h] = { squat: [0.08, 0.14], flat: [0.07, 0.07], drink: [0.05, 0.24] }[v] ?? [0.075, 0.22];
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 36), tinMetal()), 0, h / 2, 0));
  for (const y of [0.004, h - 0.004]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r - 0.002, 0.004, 8, 36), tinMetal());
    rim.rotation.x = Math.PI / 2;
    g.add(at(rim, 0, y, 0));
  }
  g.add(at(wrapLabel(nameOf(item), look.colour ?? "#8a8a8a", r + 0.0015, h * (v === "drink" ? 0.9 : 0.8), { arc: Math.PI * 2 - 0.001, motif: motifFor(item) }), 0, h / 2, 0));
  if (v === "drink") g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.003, 0.012), tinMetal()), 0, h + 0.002, 0.012));
  return [g, r * 2 + 0.02];
}

function carton(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const col = look.colour ?? "#c8a03a";
  // a tall stock carton with a screw cap, the name down the front
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.38, 0.1, 2, 0.01), mat(col, { roughness: 0.45 })), 0, 0.19, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.026, 16), white()), 0.04, 0.393, 0));
  g.add(at(flatLabel(nameOf(item), "#ffffff", 0.15, 0.15, { motif: motifFor(item) }), 0, 0.22, 0.0505));
  return [g, 0.2];
}

function box(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const v = look.variant ?? "";
  const col = look.colour ?? "#2f5fa8";
  const [w, h, d] = { small: [0.16, 0.2, 0.07], wide: [0.32, 0.22, 0.08], flat: [0.3, 0.09, 0.2], tall: [0.22, 0.36, 0.1], pasta: [0.24, 0.32, 0.08] }[v] ?? [0.24, 0.3, 0.08];
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.008), mat(col, { roughness: 0.55 })), 0, h / 2, 0));
  if (v === "flat") {
    // frozen pastry and the like lie flat: the name runs along the front edge
    g.add(at(flatLabel(nameOf(item), "#ffffff", w * 0.9, h * 0.72, { motif: motifFor(item) }), 0, h / 2, d / 2 + 0.001));
    return [g, w + 0.03];
  }
  g.add(at(flatLabel(nameOf(item), "#ffffff", w * 0.9, Math.min(h * 0.36, w * 0.44), { motif: motifFor(item) }), 0, h * 0.68, d / 2 + 0.001));
  if (v === "pasta") {
    // a window onto the spaghetti
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.62, h * 0.26), mat("#f2d48a", { roughness: 0.6 })), 0, h * 0.26, d / 2 + 0.0012));
    const strand = mat("#d0a848");
    for (let k = 0; k < 10; k++) g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.62, 0.003), strand), 0, h * 0.15 + k * h * 0.024, d / 2 + 0.0016));
  }
  return [g, w + 0.03];
}

function sack(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const col = look.colour ?? "#3f7fbf";
  const rice = look.variant === "rice";
  // a flour bag: soft paper, a folded top, printed in its colour; rice comes
  // in a glossy pillow pack
  const [w, h, d] = rice ? [0.22, 0.32, 0.12] : [0.24, 0.4, 0.14];
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, rice ? 0.045 : 0.025), rice ? mat("#f6f2e6", { roughness: 0.3, clearcoat: 0.5 }) : matte("#f4eee2")), 0, h / 2, 0));
  if (!rice) {
    const fold = new THREE.Mesh(new RoundedBoxGeometry(w * 0.98, 0.05, d * 0.5, 2, 0.012), matte("#ece2cc"));
    fold.rotation.x = 0.2;
    g.add(at(fold, 0, h + 0.012, -0.01));
  }
  g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.62), mat(col, { roughness: 0.6 })), 0, h * 0.38, d / 2 + 0.002));
  g.add(at(flatLabel(nameOf(item), "#ffffff", w * 0.86, h * 0.3, { motif: motifFor(item) }), 0, h * 0.44, d / 2 + 0.003));
  return [g, w + 0.03];
}

function pouch(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const col = look.colour ?? "#a8743a";
  // a stand-up pouch, thinning to its sealed top, a zip across it, and a
  // round window onto what's inside under the name
  const w = 0.2;
  const h = 0.3;
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.08, 3, 0.03), mat(col, { roughness: 0.4, clearcoat: 0.4 }));
  const pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * (1 - 0.6 * Math.max(0, (pos.getY(i) + h / 2) / h - 0.2)));
  body.geometry.computeVertexNormals();
  g.add(at(body, 0, h / 2, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.008, 0.04), mat(shade(col, 0.7))), 0, h - 0.03, 0));
  const contents = look.fill ?? mix(col, "#ffffff", 0.15);
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), mat(contents, { roughness: 0.7 }));
  win.rotation.x = -0.1;
  g.add(at(win, 0, 0.085, 0.0395));
  const bits = matte(shade(contents, 0.8));
  for (let k = 0; k < 7; k++) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), bits), Math.cos(k * 2.4) * 0.028, 0.085 + Math.sin(k * 2.4) * 0.028, 0.04));
  const label = flatLabel(nameOf(item), "#ffffff", w * 0.9, 0.11);
  label.rotation.x = -0.13;
  g.add(at(label, 0, 0.19, 0.03));
  return [g, w + 0.03];
}

function spice(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const v = look.variant ?? "";
  const col = look.colour ?? "#a8643a";
  if (v === "tin") {
    // baking powder and bicarb: a squat tin
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.13, 30), mat(col, { roughness: 0.4, metalness: 0.2 })), 0, 0.065, 0));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 30), tinMetal()), 0, 0.14, 0));
    g.add(at(wrapLabel(nameOf(item), "#ffffff", 0.0595, 0.07), 0, 0.065, 0));
    return [g, 0.14];
  }
  if (v === "sachet") {
    const s = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.17, 0.014, 2, 0.006), mat(col, { roughness: 0.45 }));
    s.rotation.x = -0.15;
    g.add(at(s, 0, 0.085, 0));
    const label = flatLabel(nameOf(item), "#ffffff", 0.11, 0.06);
    label.rotation.x = -0.15;
    g.add(at(label, 0, 0.095, 0.009));
    return [g, 0.15];
  }
  // a glass shaker: the spice's own colour through the glass, a cap, a label
  const grinder = v === "grinder";
  const r = 0.048;
  const h = v === "tiny" ? 0.12 : 0.18;
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), glass()), 0, h / 2, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, h * 0.84, 24), matte(v === "leaves" ? "#7a8a4a" : (look.fill ?? col), { roughness: 0.95 })), 0, h * 0.43, 0));
  const capCol = grinder ? "#2a2a2a" : v === "salt" ? "#ffffff" : col;
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, grinder ? 0.07 : 0.04, 28), mat(capCol, { roughness: 0.35 })), 0, h + (grinder ? 0.035 : 0.02), 0));
  if (grinder) {
    const ribMat = mat("#4a4a4a");
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.066, 0.004), ribMat), Math.sin(a) * r * 1.04, h + 0.035, Math.cos(a) * r * 1.04));
    }
  }
  g.add(at(wrapLabel(nameOf(item), v === "salt" ? col : "#ffffff", r * 1.02, h * 0.5), 0, h * 0.45, 0));
  return [g, r * 2 + 0.03];
}

function bar(item) {
  const g = new THREE.Group();
  const look = item.look ?? {};
  const col = look.colour ?? "#5a2a1a";
  // a block of chocolate stood on its edge, leaning back, its wrapper torn
  // open at the top to show the squares
  const lean = new THREE.Group();
  lean.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.16, 0.022, 2, 0.006), mat(col, { roughness: 0.4, clearcoat: 0.4 })), 0, 0.08, 0));
  const choc = luminance(col) > 0.7 ? "#efe6d0" : luminance(col) > 0.12 ? "#7a3f1a" : "#4a2414";
  const sq = skin(choc, { roughness: 0.35 });
  for (let i = 0; i < 6; i++) lean.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.014, 2, 0.005), sq), -0.135 + i * 0.054, 0.185, 0));
  lean.add(at(flatLabel(nameOf(item), col, 0.3, 0.12), 0, 0.08, 0.0115));
  lean.rotation.x = -0.18;
  lean.position.z = 0.02;
  g.add(lean);
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.05), mat(col)), 0, 0.006, 0.03));
  return [g, 0.36];
}

function loaf(item) {
  const g = new THREE.Group();
  const v = item.look?.variant ?? "loaf";
  if (v === "baguette") {
    g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.42, 8, 18), skin("#d49a4a", { roughness: 0.6 })).rotateZ(Math.PI / 2), 0, 0.042, 0));
    const score = matte("#f2d6a0");
    for (let i = 0; i < 4; i++) {
      const slash = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.05, 2, 6), score);
      slash.rotation.set(Math.PI / 2, 0, 0.9);
      g.add(at(slash, -0.15 + i * 0.1, 0.08, 0.008));
    }
    // a paper sleeve round one end
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 18, 1, true), matte("#e8dcc4", { side: THREE.DoubleSide })).rotateZ(Math.PI / 2), -0.17, 0.044, 0));
    return [g, 0.54];
  }
  if (v === "ciabatta") {
    // a flat, slipper-shaped loaf dusted with flour
    const body = lumpy(0.1, skin("#d8a060", { roughness: 0.85 }), item.seed, 0.08);
    body.scale.set(1.9, 0.42, 0.95);
    g.add(at(body, 0, 0.042, 0));
    const flour = matte("#f4ece0");
    const rand = rng(item.seed);
    for (let k = 0; k < 30; k++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 0.9;
      const dust = new THREE.Mesh(new THREE.CircleGeometry(0.012 + rand() * 0.01, 8), flour);
      dust.rotation.x = -Math.PI / 2 + 0.35;
      g.add(at(dust, Math.cos(a) * rr * 0.17, 0.084 - rr * rr * 0.02, Math.sin(a) * rr * 0.08));
    }
    return [g, 0.42];
  }
  if (v === "flat") {
    // a stack of flatbreads in a bag, the name on the front edge
    const base = item.look?.colour ?? "#e8c890";
    const breads = [skin(base, { roughness: 0.8 }), skin(mix(base, "#ffffff", 0.25), { roughness: 0.8 })];
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.009, 32), breads[i % 2]);
      p.scale.z = 0.8;
      g.add(at(p, 0, 0.005 + i * 0.01, 0));
    }
    const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.09, 32), film());
    bag.scale.z = 0.8;
    g.add(at(bag, 0, 0.045, 0));
    g.add(at(flatLabel(nameOf(item), "#d8302a", 0.14, 0.05, { motif: "wheat" }), 0, 0.045, 0.096));
    return [g, 0.26];
  }
  if (v === "bun") {
    const glaze = skin("#d08a3a", { roughness: 0.45, clearcoat: 0.6 });
    const crumb = skin("#ecc88e");
    const sesame = matte("#f6eedc");
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * 0.15;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.068, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), glaze);
      top.scale.y = 0.65;
      g.add(at(top, x, 0.035, 0));
      g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.064, 0.035, 22), crumb), x, 0.0175, 0));
      for (let k = 0; k < 8; k++) {
        const seed = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 6, 4), sesame);
        seed.scale.set(1.5, 0.5, 1);
        g.add(at(seed, x + Math.cos(k * 2.4) * 0.035, 0.073, Math.sin(k * 2.4) * 0.035));
      }
    }
    return [g, 0.32];
  }
  // a sliced loaf: domed golden top, slice lines down its side, in a bag
  // gathered with a red tie at one end
  const rye = v === "rye";
  const L = 0.42;
  const crust = rye ? skin("#6a3e22", { roughness: 0.7 }) : skin("#c8823a", { roughness: 0.65, clearcoat: 0.25 });
  const side = rye ? skin("#8a5a36", { roughness: 0.7 }) : skin("#dca460", { roughness: 0.7 });
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(L, 0.15, 0.17, 4, 0.03), side), 0, 0.075, 0));
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, L - 0.01, 28, 1, false, -Math.PI / 2, Math.PI), crust);
  dome.rotation.z = Math.PI / 2;
  dome.scale.set(0.55, 1, 1);
  g.add(at(dome, 0, 0.15, 0));
  const groove = matte(rye ? "#4a2a14" : "#a86a2a");
  for (let k = 1; k < 14; k++) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.19, 0.0025), groove), -L / 2 + (k * L) / 14, 0.105, 0.0862));
  g.add(at(new THREE.Mesh(new RoundedBoxGeometry(L + 0.04, 0.23, 0.19, 3, 0.05), film()), 0.01, 0.115, 0));
  g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 12), film()).rotateZ(Math.PI / 2), L / 2 + 0.06, 0.12, 0));
  g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 14), matte("#d8302a")).rotateY(Math.PI / 2), L / 2 + 0.035, 0.12, 0));
  return [g, L + 0.12];
}

/* ---------------- the table ---------------- */

export const BUILD = {
  citrus, apple, tomato, capsicum, chilli, banana, carrot, potato, onion, garlic, broccoli, cabbage, avocado, mushroom,
  cucumber, eggplant, stalk, corn, pumpkin, ginger, herbs, leaves, berries, beans, beetroot, mango, pineapple,
  milk, cream, juice, tub, butter, eggs, cheese, tray, jar, bottle, can, carton, box, sack, pouch, spice, bar, loaf,
};

// The models that are fresh produce: they go in the crisper, not on a shelf.
export const PRODUCE = new Set([
  "citrus", "apple", "tomato", "capsicum", "chilli", "banana", "carrot", "potato", "onion", "garlic", "broccoli", "cabbage",
  "avocado", "mushroom", "cucumber", "eggplant", "stalk", "corn", "pumpkin", "ginger", "herbs", "leaves", "berries", "beans",
  "beetroot", "mango", "pineapple",
]);

// Merge an item's meshes, one per material: a bunch of herbs is a few hundred
// leaves, but a handful of draw calls.
function compact(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(o);
  });
  const out = new THREE.Group();
  for (const [material, meshes] of buckets) {
    const geos = meshes.map((m) => {
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      m.geometry.dispose();
      return geo;
    });
    const merged = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      if (!geos.every((x) => x.attributes[name])) continue;
      const arr = new Float32Array(geos.reduce((s, x) => s + x.attributes[name].array.length, 0));
      let o = 0;
      for (const x of geos) {
        arr.set(x.attributes[name].array, o);
        o += x.attributes[name].array.length;
      }
      merged.setAttribute(name, new THREE.BufferAttribute(arr, geos[0].attributes[name].itemSize));
    }
    geos.forEach((x) => x.dispose());
    out.add(new THREE.Mesh(merged, material));
  }
  return out;
}

// The item's 3D model, resting on y = 0 with its label towards +z. Its shape
// depends only on its model, look and name, so two cartons of the same milk
// match and the scene can measure one to pack the shelves.
export function buildModel(item) {
  const builder = BUILD[item.model] ?? jar;
  const seed = hashStr(item.model + JSON.stringify(item.look ?? {}));
  const [g, footprint] = builder({ ...item, seed });
  return [compact(g), footprint];
}
