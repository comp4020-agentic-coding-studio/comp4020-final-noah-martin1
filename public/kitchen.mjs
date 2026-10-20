// The fridge and pantry: a 3D kitchen built from the person's own inventory.
// A double-door fridge (doors swing open when the page loads) and an open oak
// shelf beside it; the arrow slides the camera between them. Every item is a
// procedural container (carton, jar, tub, tray, tin...) chosen server-side in
// src/kitchen.ts. Hover lifts an item off its shelf with an outline; click
// opens the side panel with its expiry and the meals it's planned for.
// Progressive: without WebGL the table below the scene lists everything.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const root = document.querySelector("[data-kitchen]");
const stage = root?.querySelector("[data-kx-stage]");
const items = JSON.parse(document.getElementById("kitchen-data")?.textContent ?? "[]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (root && stage && webgl()) start();

function webgl() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// An item landing on its shelf, `s` seconds after its turn (null once it has
// settled). It falls in from a little above (accelerating, fading up from
// small so it never pops through the shelf above), squashes on contact, then
// rocks on its base like a jar set down a bit too briskly: a damped swing
// that's wider for squat things than tall ones.
const FALL = 0.32;
function landing(s, u) {
  if (s < 0) return { entered: 0, drop: 0.35, scale: 0.001, squash: 0, rock: 0 };
  const settle = 1.25;
  if (s >= FALL + settle) return null;
  if (s < FALL) {
    const k = s / FALL;
    return { entered: k, drop: 0.35 * (1 - k * k), scale: 0.55 + 0.45 * ease(Math.min(1, k * 1.6)), squash: 0, rock: 0 };
  }
  const a = s - FALL;
  const squash = 0.09 * Math.exp(-a * 16) * Math.cos(a * 34);
  const amp = Math.min(0.2, 0.05 / Math.max(0.25, u.tall));
  const rock = amp * Math.exp(-a * 4.2) * Math.sin(a * 17);
  return { entered: 1, drop: 0, scale: 1, squash, rock };
}

function start() {
  const canvas = stage.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xfff8ef, 0xe8e0d4, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1e0, 2.1);
  key.position.set(-4.5, 6.5, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.55);
  fill.position.set(6, 3, 4);
  scene.add(fill);

  /* ---------- room: a warm floor and wall that catch soft shadows ---------- */
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1e8dc, roughness: 0.95 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xdccdb9, roughness: 0.7, map: floorTexture() });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), wallMat);
  wall.position.set(3, 4, -0.62);
  wall.receiveShadow = true;
  scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(3, 0, 5);
  floor.receiveShadow = true;
  scene.add(floor);
  // a skirting board where the two meet, so the corner reads as architecture
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(40, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: 0xfbf8f3, roughness: 0.6 }));
  skirting.position.set(3, 0.06, -0.6);
  skirting.receiveShadow = true;
  scene.add(skirting);

  /* ---------- materials ---------- */
  // a retro enamel fridge in soft sage: glossy, rounded, unmistakably a fridge
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xa9cdb6, metalness: 0.05, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const enamel = new THREE.MeshPhysicalMaterial({ color: 0xf8f8f6, roughness: 0.42, clearcoat: 0.4 });
  const liner = new THREE.MeshStandardMaterial({ color: 0xf1f4f2, roughness: 0.6, emissive: 0xfff3dd, emissiveIntensity: 0 });
  const gasket = new THREE.MeshStandardMaterial({ color: 0xd4d8da, roughness: 0.8 });
  const handleMat = new THREE.MeshPhysicalMaterial({ color: 0xc9ccce, metalness: 0.95, roughness: 0.18 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdff0ec, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false,
  });
  const glassEdge = new THREE.MeshStandardMaterial({ color: 0xd8e4e4, roughness: 0.3 });
  const binMat = new THREE.MeshPhysicalMaterial({ color: 0xe4f1ee, roughness: 0.1, transparent: true, opacity: 0.38, clearcoat: 1, depthWrite: false });
  const oak = new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: 0.62, map: woodTexture() });
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.3 });

  /* ---------- the fridge ---------- */
  // Interior width W, height H, depth D; walls of thickness T. Origin at the
  // floor, centre front of the cabinet.
  const W = 1.9, H = 2.85, D = 0.95, T = 0.07, FOOT = 0.14;
  const fridge = new THREE.Group();
  // stands just proud of the wall (the wall is at z = -0.62)
  fridge.position.z = D - 0.6;
  scene.add(fridge);

  const cab = (w, h, d, x, y, z, mat = enamel) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(0.03, w / 3, h / 3, d / 3)), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    fridge.add(m);
    return m;
  };
  // outer shell: back, sides, top, bottom (steel outside, white inside)
  cab(W + 2 * T, T, D, 0, FOOT + H + T / 2, -D / 2, steel);
  cab(W + 2 * T, T, D, 0, FOOT + T / 2, -D / 2, steel);
  cab(T, H + 2 * T, D, -W / 2 - T / 2, FOOT + H / 2 + T, -D / 2, steel);
  cab(T, H + 2 * T, D, W / 2 + T / 2, FOOT + H / 2 + T, -D / 2, steel);
  cab(W, H, T, 0, FOOT + T + H / 2, -D + T / 2, liner);
  // inner side liners (white) so the cavity glows
  cab(0.02, H, D - T, -W / 2 + 0.01, FOOT + T + H / 2, -D / 2 + T / 2 - T, liner);
  cab(0.02, H, D - T, W / 2 - 0.01, FOOT + T + H / 2, -D / 2 + T / 2 - T, liner);
  // plinth
  cab(W + 2 * T - 0.04, FOOT, D - 0.12, 0, FOOT / 2, -D / 2 - 0.04, new THREE.MeshStandardMaterial({ color: 0x9a9fa3, roughness: 0.5, metalness: 0.4 }));

  // shelves: glass panes with a soft edge, plus a crisper drawer at the bottom
  const SHELVES = [FOOT + T + 0.62, FOOT + T + 1.3, FOOT + T + 1.98]; // tops of shelves
  const shelfTops = [FOOT + T, ...SHELVES]; // the cavity floor holds the drawer
  for (const y of SHELVES) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.02, D - T - 0.06), glass);
    pane.position.set(0, y - 0.01, -D / 2 - 0.0);
    pane.receiveShadow = true;
    fridge.add(pane);
    const edge = new THREE.Mesh(new RoundedBoxGeometry(W - 0.04, 0.035, 0.035, 2, 0.012), glassEdge);
    edge.position.set(0, y - 0.012, -0.06);
    fridge.add(edge);
  }
  // crisper drawer: frosted front panel, sitting on the cavity floor
  const crisper = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.5, 0.04, 3, 0.02), new THREE.MeshPhysicalMaterial({ color: 0xeef5f2, roughness: 0.35, transmission: 0.5, transparent: true, opacity: 0.7, thickness: 0.02 }));
  crisper.position.set(0, FOOT + T + 0.25, -0.08);
  fridge.add(crisper);

  // interior light: a warm strip at the top. On in dark mode (it's night,
  // you've opened the fridge), almost off in daylight.
  const strip = new THREE.Mesh(new RoundedBoxGeometry(W * 0.6, 0.04, 0.12, 2, 0.015), new THREE.MeshBasicMaterial({ color: 0xfff6e4 }));
  strip.position.set(0, FOOT + T + H - 0.04, -D * 0.55);
  fridge.add(strip);
  const bulb = new THREE.PointLight(0xffe9c7, 0, 4.2, 1.6);
  bulb.position.set(0, FOOT + T + H - 0.25, -D * 0.35);
    fridge.add(bulb);
  const glowSpot = new THREE.SpotLight(0xfff0d6, 0, 7, 0.9, 0.85, 1.4);
  glowSpot.position.set(0, FOOT + H * 0.6, -0.3);
  glowSpot.target.position.set(0, 0.1, 2.6);
  fridge.add(glowSpot, glowSpot.target);

  // doors: hinged at the outer edges, each a shallow steel slab with a white
  // inner liner, a gasket, a long bar handle, and two door bins
  const doorW = W / 2 + T;
  const doorD = 0.16;
  const doors = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (W / 2 + T), FOOT, 0.0);
    fridge.add(hinge);
    const slab = new THREE.Group();
    // the slab extends from the hinge toward the centre
    slab.position.set(-side * doorW / 2, 0, doorD / 2);
    hinge.add(slab);
    const outer = new THREE.Mesh(new RoundedBoxGeometry(doorW - 0.01, H + 2 * T, 0.06, 4, 0.03), steel);
    outer.position.set(0, (H + 2 * T) / 2, 0.05);
    outer.castShadow = true;
    outer.receiveShadow = true;
    slab.add(outer);
    const inner = new THREE.Mesh(new RoundedBoxGeometry(doorW - 0.1, H + 2 * T - 0.1, 0.1, 3, 0.04), liner);
    inner.position.set(0, (H + 2 * T) / 2, -0.03);
    inner.receiveShadow = true;
    inner.castShadow = true;
    slab.add(inner);
    // a raised moulded rim around the inner liner, like a real fridge door
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe6ebe8, roughness: 0.5 });
    for (const [rw, rh, rx, ry] of [
      [0.06, H + 2 * T - 0.16, -(doorW - 0.16) / 2, (H + 2 * T) / 2],
      [0.06, H + 2 * T - 0.16, (doorW - 0.16) / 2, (H + 2 * T) / 2],
      [doorW - 0.16, 0.06, 0, 0.1],
      [doorW - 0.16, 0.06, 0, H + 2 * T - 0.1],
    ]) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(rw, rh, 0.08, 2, 0.025), rimMat);
      rim.position.set(rx, ry, -0.11);
      rim.castShadow = true;
      slab.add(rim);
    }
    const seal = new THREE.Mesh(new RoundedBoxGeometry(doorW - 0.04, H + 2 * T - 0.04, 0.02, 2, 0.02), gasket);
    seal.position.set(0, (H + 2 * T) / 2, -0.085);
    slab.add(seal);
    // bar handle on the inside edge (towards the centre seam)
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 1.5, 6, 16), handleMat);
    bar.position.set(-side * (doorW / 2 - 0.12), FOOT + H * 0.55, 0.16);
    bar.castShadow = true;
    slab.add(bar);
    for (const yy of [0.62, 1.22]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 12), handleMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(-side * (doorW / 2 - 0.12), FOOT + H * 0.55 + (yy - 0.92), 0.115);
      slab.add(post);
    }
    // door bins: clear trays facing into the fridge
    const bins = [];
    for (const yy of [0.82, 1.52, 2.22]) {
      const bin = new THREE.Group();
      bin.position.set(0, yy, -0.18);
      const front = new THREE.Mesh(new RoundedBoxGeometry(doorW - 0.24, 0.2, 0.02, 2, 0.008), binMat);
      front.position.set(0, 0.1, -0.13);
      const base = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.24, 0.015, 0.26), binMat);
      bin.add(front, base);
      slab.add(bin);
      bins.push(bin);
    }
    doors.push({ side, hinge, slab, bins });
  }

  /* ---------- the pantry: open oak shelving on the wall ---------- */
  const PX = 5.6; // pantry centre x
  const pantry = new THREE.Group();
  pantry.position.set(PX, 0, 0);
  scene.add(pantry);
  const PW = 2.9, PD = 0.5;
  const PANTRY_SHELVES = [1.3, 1.98, 2.66];
  const LED_OFF = new THREE.Color(0xd8cfc3);
  const LED_ON = new THREE.Color(0xfff1d6);
  const ledMat = new THREE.MeshBasicMaterial({ color: LED_OFF });
  const shelfLights = [];
  for (const y of PANTRY_SHELVES) {
    const board = new THREE.Mesh(new RoundedBoxGeometry(PW, 0.07, PD, 3, 0.02), oak);
    board.position.set(0, y, -0.6 + PD / 2);
    board.castShadow = true;
    board.receiveShadow = true;
    pantry.add(board);
    // a warm LED strip tucked under the front lip: on at night
    const led = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.2, 0.012, 0.02), ledMat);
    led.position.set(0, y - 0.042, -0.6 + PD - 0.06);
    pantry.add(led);
    // two soft downlights per strip wash the shelf below in warm light
    for (const sx of [-PW / 4, PW / 4]) {
      const wash = new THREE.SpotLight(0xffd29a, 0, 1.6, 1.15, 0.9, 1.2);
      wash.position.set(PX + sx, y - 0.05, -0.6 + PD - 0.1);
      wash.target.position.set(PX + sx, y - 0.8, -0.55);
      scene.add(wash, wash.target);
      shelfLights.push(wash);
    }
    // slim brass brackets under each end
    for (const sx of [-PW / 2 + 0.3, PW / 2 - 0.3]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, PD * 0.8), brass);
      br.position.set(sx, y - 0.14, -0.6 + PD * 0.42);
      br.castShadow = true;
      pantry.add(br);
    }
  }
  // a low oak cabinet below, with a stone top, so the shelves feel grounded
  const cabinet = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.2, 0.62, 0.7, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0xf6f1ea, roughness: 0.55 }));
  cabinet.position.set(0, 0.31, -0.6 + 0.35);
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  pantry.add(cabinet);
  const top = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.3, 0.06, 0.76, 3, 0.02), new THREE.MeshPhysicalMaterial({ color: 0xece6dd, roughness: 0.25, clearcoat: 0.6 }));
  top.position.set(0, 0.65, -0.6 + 0.36);
  top.castShadow = true;
  top.receiveShadow = true;
  pantry.add(top);
  for (const sx of [-0.8, 0.8]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), brass);
    knob.position.set(sx, 0.42, 0.11);
    pantry.add(knob);
  }
  // a little potted herb for life
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.24, 24), new THREE.MeshStandardMaterial({ color: 0xe9b9a2, roughness: 0.8 }));
  pot.position.set(PW / 2 - 0.25, 0.8, -0.3);
  pot.castShadow = true;
  pantry.add(pot);
  for (let k = 0; k < 9; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7fb08a, roughness: 0.7 }));
    const a = k * 2.4;
    leaf.scale.set(1, 0.55, 0.7);
    leaf.position.set(PW / 2 - 0.25 + Math.cos(a) * 0.1, 0.98 + (k % 3) * 0.07, -0.3 + Math.sin(a) * 0.1);
    leaf.rotation.set(Math.random(), a, 0.5);
    leaf.castShadow = true;
    pantry.add(leaf);
  }

  /* ---------- containers ---------- */
  const tintMat = new Map();
  const tinted = (hex, opts = {}) => {
    const k = hex + JSON.stringify(opts);
    if (!tintMat.has(k)) tintMat.set(k, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: 0.45, clearcoat: 0.35, ...opts }));
    return tintMat.get(k);
  };
  const white = new THREE.MeshPhysicalMaterial({ color: 0xfbfaf7, roughness: 0.4, clearcoat: 0.3 });
  const clearGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.9, thickness: 0.05, ior: 1.5, transparent: true, opacity: 0.6 });
  const tin = new THREE.MeshPhysicalMaterial({ color: 0xd9dcde, metalness: 0.85, roughness: 0.28 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xe8d6b8, roughness: 0.9 });
  const lathe = (pts, mat, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);

  // each builder returns a group sitting on y = 0, plus its footprint width
  const BUILD = {
    milk(t) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.5, 0.26, 3, 0.02), white);
      body.position.y = 0.25;
      const label = new THREE.Mesh(new RoundedBoxGeometry(0.262, 0.22, 0.262, 2, 0.015), tinted(t));
      label.position.y = 0.22;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.185, 0.12, 4, 1), white);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.98);
      roof.position.y = 0.56;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16), tinted(t, { roughness: 0.3 }));
      cap.position.set(0.05, 0.6, 0.05);
      g.add(body, label, roof, cap);
      return [g, 0.3];
    },
    juice(t) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.62, 0.16, 3, 0.03), tinted(t, { roughness: 0.35, clearcoat: 0.8 }));
      body.position.y = 0.31;
      const band = new THREE.Mesh(new RoundedBoxGeometry(0.242, 0.18, 0.162, 2, 0.02), white);
      band.position.y = 0.36;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 18), tinted("#f39a6b", { roughness: 0.3 }));
      cap.position.set(0, 0.65, 0.0);
      const orange = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), tinted("#f6a04d"));
      orange.position.set(0, 0.36, 0.085);
      orange.scale.z = 0.3;
      g.add(body, band, cap, orange);
      return [g, 0.28];
    },
    bottle(t) {
      const g = new THREE.Group();
      const pts = [[0, 0], [0.085, 0], [0.095, 0.02], [0.095, 0.34], [0.075, 0.42], [0.032, 0.5], [0.03, 0.6], [0, 0.6]];
      const glassBody = lathe(pts, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(t).lerp(new THREE.Color(0x6b4a2a), 0.45), roughness: 0.08, transmission: 0.55, thickness: 0.2, transparent: true, opacity: 0.85, ior: 1.5 }));
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.097, 0.097, 0.14, 32, 1, true), tinted(t, { side: THREE.DoubleSide }));
      label.position.y = 0.2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.05, 16), tinted("#2f3437", { metalness: 0.5, roughness: 0.3 }));
      cap.position.y = 0.62;
      g.add(glassBody, label, cap);
      return [g, 0.22];
    },
    jar(t) {
      const g = new THREE.Group();
      const pts = [[0, 0], [0.1, 0], [0.115, 0.02], [0.115, 0.2], [0.098, 0.23], [0.098, 0.25], [0, 0.25]];
      const contents = lathe(pts.map(([x, y]) => [x * 0.94, y * 0.88]), tinted(t, { roughness: 0.5 }));
      contents.position.y = 0.01;
      const jarGlass = lathe(pts, clearGlass);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 32), tinted("#e9c46a", { metalness: 0.6, roughness: 0.3 }));
      lid.position.y = 0.27;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.117, 0.117, 0.09, 32, 1, true), white);
      label.position.y = 0.11;
      g.add(contents, jarGlass, label, lid);
      return [g, 0.26];
    },
    tub(t) {
      const g = new THREE.Group();
      const body = lathe([[0, 0], [0.12, 0], [0.145, 0.16], [0, 0.16]], white);
      const label = lathe([[0.122, 0.03], [0.142, 0.14]], tinted(t, { side: THREE.DoubleSide }));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.03, 32), tinted(t, { roughness: 0.35 }));
      lid.position.y = 0.17;
      g.add(body, label, lid);
      return [g, 0.32];
    },
    butter(t) {
      const g = new THREE.Group();
      const block = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.09, 0.13, 3, 0.02), tinted("#f7e7a6", { roughness: 0.5 }));
      block.position.y = 0.045;
      const wrap = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.092, 0.132, 2, 0.02), tinted(t));
      wrap.position.set(0.04, 0.046, 0);
      g.add(block, wrap);
      return [g, 0.32];
    },
    eggs() {
      const g = new THREE.Group();
      const tray = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.08, 0.2, 3, 0.03), paper);
      tray.position.y = 0.04;
      g.add(tray);
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3dcc4, roughness: 0.55, clearcoat: 0.15 });
      for (let i = 0; i < 6; i++) {
        const egg = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 16), shell);
        egg.scale.y = 1.28;
        egg.position.set(-0.2 + (i % 3) * 0.2 * 1.0 + (i >= 3 ? 0 : 0), 0.11, i < 3 ? -0.045 : 0.045);
        egg.position.x = -0.18 + (i % 3) * 0.18;
        g.add(egg);
      }
      return [g, 0.56];
    },
    cheese(t) {
      const g = new THREE.Group();
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.32, -0.06);
      shape.lineTo(0.32, 0.12);
      shape.closePath();
      const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 }), tinted("#f6d36b", { roughness: 0.55 }));
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.set(-0.16, 0.0, 0.03);
      const rind = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.19), tinted(t));
      rind.position.set(0.17, 0.065, -0.0);
      g.add(wedge, rind);
      // a few holes, for the cartoon of it
      for (const [x, z] of [[0.02, 0.0], [0.1, 0.04]]) {
        const hole = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), tinted("#e7b94c"));
        hole.position.set(x, 0.13, z);
        hole.scale.y = 0.3;
        g.add(hole);
      }
      return [g, 0.36];
    },
    tray(t, item) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.05, 0.26, 3, 0.02), white);
      base.position.y = 0.025;
      const fish = /salmon|fish|prawn/.test(item.name);
      const meatCol = fish ? "#f4a07d" : /tofu/.test(item.name) ? "#f3ead2" : "#e9867a";
      const cut = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.06, 0.18, 3, 0.03), tinted(meatCol, { roughness: 0.5, clearcoat: 0.6 }));
      cut.position.y = 0.075;
      const film = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.07, 0.26, 3, 0.025), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.35, thickness: 0.01 }));
      film.position.y = 0.06;
      const sticker = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.005, 0.07, 1, 0.002), tinted(t));
      sticker.position.set(0.1, 0.098, 0.05);
      g.add(base, cut, film, sticker);
      return [g, 0.44];
    },
    veg(t, item) {
      const g = new THREE.Group();
      const n = item.name;
      const colour = /lemon/.test(n) ? "#f4d75e" : /lime|avocado|cucumber|zucchini|broccoli/.test(n) ? "#86b76c" : /capsicum|tomato|chilli/.test(n) ? "#e8604c" : /carrot|orange|pumpkin/.test(n) ? "#f29a4a" : /onion/.test(n) ? "#d9a26b" : /garlic/.test(n) ? "#f4ece0" : /potato|ginger/.test(n) ? "#d2b07a" : /mushroom/.test(n) ? "#d9c7b0" : /banana/.test(n) ? "#f4d75e" : t;
      const count = /garlic|ginger/.test(n) ? 1 : 3;
      if (/carrot/.test(n)) {
        for (let i = 0; i < 3; i++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 14), tinted(colour));
          c.rotation.z = Math.PI / 2;
          c.position.set(0, 0.04 + i * 0.05, (i - 1) * 0.06);
          const top = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), tinted("#7fb08a"));
          top.rotation.z = -Math.PI / 2;
          top.position.set(0.19, 0.04 + i * 0.05, (i - 1) * 0.06);
          g.add(c, top);
        }
        return [g, 0.4];
      }
      for (let i = 0; i < count; i++) {
        const r = /garlic/.test(n) ? 0.08 : 0.075;
        const v = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), tinted(colour, { roughness: 0.4, clearcoat: 0.5 }));
        v.scale.set(1, /lemon|lime/.test(n) ? 0.82 : /onion|garlic/.test(n) ? 0.9 : 0.95, /lemon/.test(n) ? 0.82 : 1);
        v.position.set((i - (count - 1) / 2) * 0.15, r * 0.95, i === 1 ? 0.05 : -0.02);
        if (/capsicum/.test(n)) v.scale.set(1.05, 1.1, 1.05);
        g.add(v);
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.04, 6), tinted(/onion|garlic/.test(n) ? "#cdb38c" : "#6f9a5d"));
        stalk.position.set(v.position.x, r * 1.85, v.position.z);
        g.add(stalk);
      }
      return [g, Math.max(0.2, count * 0.15)];
    },
    leafy(t) {
      const g = new THREE.Group();
      const bag = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.34, 0.12, 3, 0.05), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transmission: 0.8, transparent: true, opacity: 0.45, thickness: 0.02 }));
      bag.position.y = 0.17;
      g.add(bag);
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), tinted(i % 2 ? "#79b07a" : "#5f9e6a", { roughness: 0.6 }));
        leaf.scale.set(1, 0.55, 0.35);
        leaf.position.set((i % 3 - 1) * 0.07, 0.06 + Math.floor(i / 3) * 0.09, (i % 2 - 0.5) * 0.03);
        leaf.rotation.z = (i % 3 - 1) * 0.6;
        g.add(leaf);
      }
      const tag = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.06, 0.005, 1, 0.002), tinted(t));
      tag.position.set(0, 0.26, 0.062);
      g.add(tag);
      return [g, 0.3];
    },
    can(t) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 32), tin);
      body.position.y = 0.1;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0765, 0.0765, 0.15, 32, 1, true), tinted(t, { side: THREE.DoubleSide }));
      label.position.y = 0.1;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.006, 8, 32), tin);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.2;
      g.add(body, label, rim);
      return [g, 0.18];
    },
    box(t) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.42, 0.1, 2, 0.01), tinted(t, { roughness: 0.55 }));
      box.position.y = 0.21;
      const window_ = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.14, 0.004, 2, 0.01), clearGlass);
      window_.position.set(0, 0.2, 0.051);
      const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.282, 0.05, 0.102, 1, 0.005), white);
      stripe.position.y = 0.36;
      g.add(box, window_, stripe);
      return [g, 0.3];
    },
    sack(t) {
      const g = new THREE.Group();
      const pts = [[0, 0], [0.12, 0], [0.14, 0.05], [0.13, 0.3], [0.11, 0.36], [0.09, 0.38], [0, 0.38]];
      const bag = lathe(pts, paper, 6);
      bag.rotation.y = Math.PI / 6;
      bag.scale.z = 0.62;
      const label = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.12, 0.005, 1, 0.003), tinted(t));
      label.position.set(0, 0.18, 0.083);
      const fold = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.04, 0.1, 2, 0.01), paper);
      fold.position.y = 0.38;
      g.add(bag, label, fold);
      return [g, 0.3];
    },
    loaf() {
      const g = new THREE.Group();
      const loaf = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.2, 0.2, 4, 0.08), tinted("#d9a464", { roughness: 0.75 }));
      loaf.position.y = 0.1;
      for (let i = 0; i < 3; i++) {
        const score = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.01, 0.16), tinted("#f3d9a7"));
        score.position.set(-0.1 + i * 0.1, 0.2, 0);
        score.rotation.y = 0.5;
        g.add(score);
      }
      g.add(loaf);
      return [g, 0.46];
    },
    spice(t) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 24), clearGlass);
      body.position.y = 0.08;
      const fillCol = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 24), tinted(t === "#bfe3cf" ? "#d4a24c" : "#c86b3c", { roughness: 0.8 }));
      fillCol.position.y = 0.065;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.04, 24), tinted("#2f3437", { roughness: 0.4 }));
      cap.position.y = 0.18;
      g.add(fillCol, body, cap);
      return [g, 0.12];
    },
  };

  /* ---------- place items on shelves ---------- */
  // Fridge zones: crisper (produce), three glass shelves, door bins
  // (bottles/juice/milk/butter/eggs go in the door when they fit).
  const DOOR_MODELS = new Set(["juice", "bottle", "butter"]);
  const fridgeItems = items.filter((i) => i.place === "fridge");
  const pantryItems = items.filter((i) => i.place === "pantry");
  const pickables = [];
  const itemsById = new Map();

  function addItem(item, parent, x, y, z, rotY = 0) {
    const builder = BUILD[item.model] ?? BUILD.jar;
    const [mesh] = builder(item.tint, item);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.itemId = item.id;
      }
    });
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = rotY;
    holder.add(mesh);
    // hit-test against a still box that covers the item at rest AND lifted,
    // so lifting on hover never pulls it out from under the pointer
    const bb = new THREE.Box3().setFromObject(mesh);
    const size = bb.getSize(new THREE.Vector3());
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + 0.04, size.y + 0.2, size.z + 0.04),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set((bb.min.x + bb.max.x) / 2, bb.min.y + (size.y + 0.2) / 2, (bb.min.z + bb.max.z) / 2);
    holder.add(hit);
    // which way it rocks when it lands, and how far from its middle to the
    // edge it rocks on (so tall bottles tip less than squat tubs)
    const rockDir = Math.sin(item.id * 78.233) > 0 ? 1 : -1;
    const halfW = Math.max(0.04, size.x / 2);
    holder.userData = { item, baseY: y, lift: 0, hover: 0, sel: 0, mesh, hit, entered: 0, delay: 0, landAt: null, rockDir, halfW, tall: size.y };
    // expiring soon: a small glowing dot floats above it (measured in the
    // holder's own space, before it joins the scene)
    if (item.fresh === "soon" || item.fresh === "expired") {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), new THREE.MeshBasicMaterial({ color: item.fresh === "expired" ? 0xef6b5b : 0xf2b04c }));
      dot.position.set((bb.min.x + bb.max.x) / 2, bb.max.y + 0.06, (bb.min.z + bb.max.z) / 2);
      holder.userData.dotY = dot.position.y;
      holder.add(dot);
      holder.userData.dot = dot;
    }
    parent.add(holder);
    pickables.push(holder);
    itemsById.set(item.id, holder);
    return holder;
  }

  // A lane is one shelf: items pack along it left to right by footprint, a
  // front row then a back row. It remembers where the next one goes, so an
  // item added later drops into the gap rather than reshuffling the shelf.
  const lane = (name, parent, xMin, xMax, y, zFront, zBack) => ({ name, parent, xMin, xMax, y, zFront, zBack, x: xMin, row: 0, n: 0 });
  const footprint = (item) => (BUILD[item.model] ?? BUILD.jar)(item.tint, item)[1];
  // (a hair of slack, so an item that exactly fills a row still counts)
  const inRow = (ln, w) => ln.x + w <= ln.xMax + 0.01;
  const room = (ln, w) => inRow(ln, w) || ln.row === 0;
  function place(item, ln) {
    const w = footprint(item);
    if (!inRow(ln, w)) {
      if (ln.row === 1) return null;
      ln.x = ln.xMin;
      ln.row = 1;
    }
    const z = ln.row === 0 ? ln.zFront : ln.zBack;
    const h = addItem(item, ln.parent, ln.x + w / 2, ln.y, z, (Math.sin(item.id * 12.9898) * 0.25));
    h.userData.delay = ln.n * 0.06 + ln.row * 0.1;
    h.userData.lane = ln;
    ln.n++;
    ln.x += w + 0.06;
    return h;
  }
  function layRow(list, ln) {
    for (const item of list) if (!place(item, ln)) return;
  }
  // door bins: alternate left and right doors, three bins each
  let bi = 0;
  function placeInDoor(item) {
    if (bi >= 12) return null;
    const door = doors[bi % 2];
    const bin = door.bins[Math.floor(bi / 2) % 3];
    const slot = Math.floor(bi / 6);
    const x = -0.18 + slot * 0.32;
    const h = addItem(item, bin, x * -door.side, 0.01, -0.02, door.side * 0.2);
    h.userData.delay = 0.3 + bi * 0.05;
    bi++;
    return h;
  }

  // sort: door candidates first to the door; produce to the crisper; the rest
  // by height onto shelves (tall at the back)
  const doorQueue = fridgeItems.filter((i) => DOOR_MODELS.has(i.model));
  const crisperQueue = fridgeItems.filter((i) => i.model === "veg" || i.model === "leafy");
  let shelfQueue = fridgeItems.filter((i) => !DOOR_MODELS.has(i.model) && i.model !== "veg" && i.model !== "leafy");

  const overflow = doorQueue.filter((item) => !placeInDoor(item));
  shelfQueue = [...shelfQueue, ...overflow];

  // crisper: produce sits in the drawer, just behind its frosted front
  const crisperLane = lane("in the crisper", fridge, -W / 2 + 0.12, W / 2 - 0.12, FOOT + T + 0.02, -0.38, -0.72);
  layRow(crisperQueue, crisperLane);
  // shelves: spread the rest across the three shelves, tallest at the top
  const SHELF_NAMES = ["bottom", "middle", "top"];
  const shelfLanes = SHELVES.map((y, si) => lane(`on the ${SHELF_NAMES[si]} shelf`, fridge, -W / 2 + 0.12, W / 2 - 0.12, y + 0.002, -0.36, -0.74));
  const perShelf = Math.ceil(shelfQueue.length / 3) || 1;
  shelfLanes.forEach((ln, si) => layRow(shelfQueue.slice(si * perShelf, (si + 1) * perShelf), ln));

  // pantry shelves: heavy things low (sacks, cans), jars and boxes up high
  const order = { sack: 0, can: 1, veg: 1, loaf: 2, box: 2, bottle: 3, jar: 3, spice: 4 };
  const sortedPantry = [...pantryItems].sort((a, b) => (order[a.model] ?? 3) - (order[b.model] ?? 3));
  const perPShelf = Math.ceil(sortedPantry.length / 4) || 1;
  const PANTRY_NAMES = ["on the pantry bench", "on the bottom pantry shelf", "on the middle pantry shelf", "on the top pantry shelf"];
  const pantryLanes = [0.68, ...PANTRY_SHELVES.map((y) => y + 0.035)].map((y, si) =>
    lane(PANTRY_NAMES[si], pantry, -PW / 2 + 0.15, si === 0 ? PW / 2 - 0.55 : PW / 2 - 0.15, y, -0.25, -0.45),
  );
  pantryLanes.forEach((ln, si) => layRow(sortedPantry.slice(si * perPShelf, (si + 1) * perPShelf), ln));

  // Somewhere for an item added from the panel, by the same rules: door
  // things to the door, produce to the crisper, the rest to a shelf. A spot
  // in a front row beats any back row, so the new arrival is seen landing;
  // in the pantry, nearer the level its weight says beats further.
  function shelve(item) {
    const w = footprint(item);
    const front = (ln) => ln.row === 0 && inRow(ln, w);
    const pick = (lanes) => lanes.find(front) ?? lanes.find((ln) => room(ln, w));
    if (item.place === "fridge") {
      if (DOOR_MODELS.has(item.model)) {
        const h = placeInDoor(item);
        if (h) return h;
      }
      // produce goes in the crisper while it has room in either row (its
      // frosted front hides both alike); the rest to the emptiest shelf
      const produce = item.model === "veg" || item.model === "leafy";
      if (produce && room(crisperLane, w)) return place(item, crisperLane);
      const ln = pick([...shelfLanes].sort((a, b) => a.x - b.x));
      return ln ? place(item, ln) : null;
    }
    const want = Math.round(((order[item.model] ?? 3) * 3) / 4);
    const ln = pick([...pantryLanes].sort((a, b) => Math.abs(pantryLanes.indexOf(a) - want) - Math.abs(pantryLanes.indexOf(b) - want)));
    return ln ? place(item, ln) : null;
  }

  /* ---------- post: outline on hover/selection ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new THREE.Vector2(256, 256), scene, camera);
  outline.edgeStrength = 4.2;
  outline.edgeGlow = 0.35;
  outline.edgeThickness = 1.6;
  outline.pulsePeriod = 0;
  outline.visibleEdgeColor.set(0xffffff);
  outline.hiddenEdgeColor.set(0xffffff);
  // The stock overlay adds light, which vanishes on a cream background. Paint
  // the edge in an ink colour instead (premultiplied), so it reads in both
  // themes: deep sage by day, pale sage at night.
  {
    const m = outline.overlayMaterial;
    m.uniforms.inkColor = { value: new THREE.Color(0x3f8a63) };
    m.fragmentShader = m.fragmentShader
      .replace("uniform bool usePatternTexture;", "uniform bool usePatternTexture;\nuniform vec3 inkColor;")
      .replace(
        "gl_FragColor = finalColor;",
        "float k = clamp(max(finalColor.r, max(finalColor.g, finalColor.b)) * 1.6, 0.0, 1.0);\ngl_FragColor = vec4(inkColor * k, k);",
      );
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.needsUpdate = true;
  }
  composer.addPass(outline);
  composer.addPass(new OutputPass());

  /* ---------- views: camera framing for fridge and pantry ---------- */
  const VIEWS = {
    fridge: { pos: new THREE.Vector3(0.1, 2.05, 7.9), look: new THREE.Vector3(0.0, 1.55, -0.35) },
    pantry: { pos: new THREE.Vector3(PX + 0.1, 2.05, 7.0), look: new THREE.Vector3(PX, 1.7, -0.35) },
  };
  let view = location.hash === "#pantry" ? "pantry" : "fridge";
  const camPos = VIEWS[view].pos.clone();
  const camLook = VIEWS[view].look.clone();
  let travel = null; // { from, to, fromLook, toLook, t }
  // a gentle parallax from the pointer
  const parallax = new THREE.Vector2();
  const parallaxT = new THREE.Vector2();

  // `keep` leaves the side panel open (adding an item carries you over to
  // wherever it went) and skips the pantry's welcome landing, so the new
  // arrival is the only thing that drops in
  function go(next, keep = false) {
    if (next === view && !travel) return;
    view = next;
    openTarget = next === "fridge" ? 1 : 0;
    travel = { from: camPos.clone(), to: VIEWS[next].pos.clone(), fromLook: camLook.clone(), toLook: VIEWS[next].look.clone(), t: 0 };
    // the pantry's jars land again as you arrive, just before the slide ends
    if (next === "pantry" && !keep) {
      const now = clock.elapsedTime;
      for (const h of pickables) if (h.parent === pantry) h.userData.landAt = now + 0.75 + h.userData.delay * 0.6;
    }
    root.dataset.view = next;
    root.querySelector("[data-kx-title]").textContent = next === "fridge" ? "Fridge" : "Pantry";
    history.replaceState(null, "", next === "pantry" ? "#pantry" : location.pathname + location.search);
    // an open item would be left behind; the add form comes along
    if (!keep && !adding()) closePanel();
  }
  root.querySelectorAll("[data-kx-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.kxGo)));
  root.dataset.view = view;
  root.querySelector("[data-kx-title]").textContent = view === "fridge" ? "Fridge" : "Pantry";
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "ArrowRight") go("pantry");
    if (e.key === "ArrowLeft") go("fridge");
  });
  // swipe on phones
  let touchX = null;
  canvas.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) go(dx < 0 ? "pantry" : "fridge");
    touchX = null;
  });

  /* ---------- interaction ---------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-9, -9);
  let hovered = null;
  let selected = null;

  function holderOf(obj) {
    while (obj && !pickables.includes(obj)) obj = obj.parent;
    return obj ?? null;
  }
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables.map((p) => p.userData.hit), false);
    return hits.length ? holderOf(hits[0].object) : null;
  }
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    parallaxT.set(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    if (e.pointerType === "touch") return;
    const h = pick(e.clientX, e.clientY);
    if (h !== hovered) {
      hovered = h;
      canvas.style.cursor = h ? "pointer" : "";
      syncOutline();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    parallaxT.set(0, 0);
    canvas.style.cursor = "";
    syncOutline();
  });
  canvas.addEventListener("click", (e) => {
    const h = pick(e.clientX, e.clientY);
    if (h) openPanel(h);
    else closePanel();
  });
  // items just added stay outlined while they land, so the eye finds them
  const arrivals = new Set();
  function syncOutline() {
    outline.selectedObjects = [hovered, selected, ...arrivals].filter(Boolean).map((h) => h.userData.mesh);
  }

  /* ---------- side panel ---------- */
  const panel = root.querySelector("[data-kx-panel]");
  const panelBody = root.querySelector("[data-kx-panel-body]");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function openPanel(h) {
    selected = h;
    syncOutline();
    const it = h.userData.item;
    const freshClass = { expired: "kx-pill-bad", soon: "kx-pill-warn", fresh: "kx-pill-good", none: "" }[it.fresh] ?? "";
    panelBody.innerHTML = `
      <p class="kx-panel-kind">${esc(it.place === "fridge" ? "In the fridge" : "On the shelf")}</p>
      <h2>${esc(it.name)}</h2>
      <p class="kx-panel-qty">${esc(it.qty)}${it.price ? ` · paid ${esc(it.price)}` : ""}</p>
      <div class="kx-expiry ${freshClass}">
        <span class="kx-expiry-label">${it.fresh === "none" ? "No expiry date" : it.fresh === "expired" ? "Expired" : "Use by"}</span>
        <strong>${esc(it.expiry ?? "—")}</strong>
        <span class="kx-expiry-note">${esc(it.freshLabel)}</span>
      </div>
      <h3>Planned for</h3>
      ${it.uses.length
        ? `<ul class="kx-uses">${it.uses
            .map((u) => `<li><a href="/recipes/${u.recipe_id}"><span class="kx-use-day">${esc(u.day)}</span><span class="kx-use-meal">${esc(u.meal)}</span><strong>${esc(u.title)}</strong></a></li>`)
            .join("")}</ul>`
        : `<p class="kx-empty">Not in any planned meal yet. <a href="/recipes?q=${encodeURIComponent(it.name)}">Find a recipe that uses it →</a></p>`}
      <div class="kx-panel-actions">
        <a class="button button-soft button-small" href="/pantry?edit=${it.id}#item-${it.id}">Edit</a>
        <a class="button button-ghost button-small" href="/calendar">Open calendar</a>
      </div>`;
    showPanel(false);
  }
  // the panel holds either an item's details or the add form; reopening
  // within the close transition cancels the pending hide
  let panelSeq = 0;
  function showPanel(adding) {
    panelSeq++;
    panelBody.hidden = adding;
    addForm.hidden = !adding;
    panel.classList.toggle("adding", adding);
    panel.hidden = false;
    shiftTarget = 0.13;
    requestAnimationFrame(() => panel.classList.add("open"));
    root.classList.add("panel-open");
  }
  function closePanel() {
    if (!selected && panel.hidden) return;
    const wasAdding = addForm.contains(document.activeElement);
    selected = null;
    syncOutline();
    shiftTarget = -0.16;
    panel.classList.remove("open");
    root.classList.remove("panel-open");
    const seq = panelSeq;
    setTimeout(() => {
      if (seq === panelSeq) panel.hidden = true;
    }, 320);
    if (wasAdding) addButton.focus({ preventScroll: true });
  }
  root.querySelector("[data-kx-close]")?.addEventListener("click", closePanel);

  /* ---------- adding an item, without leaving the scene ---------- */
  // The panel's form posts to the same route as the form below the scene.
  // The server decides where the item lives; the reply's scene data says, and
  // the new item drops onto its shelf (the camera slides over if it belongs
  // on the other side). Without JS or WebGL the button is a link to that form.
  const addForm = root.querySelector("[data-kx-add-form]");
  const addButton = root.querySelector("[data-kx-add]");
  const addErrors = addForm.querySelector("[data-kx-add-errors]");
  const nameInput = addForm.querySelector('[name="name"]');
  const expiryInput = addForm.querySelector('[name="expiry_date"]');
  const quick = [...addForm.querySelectorAll("[data-days]")];
  const toast = stage.querySelector("[data-kx-toast]");
  const narrow = window.matchMedia("(max-width: 900px)");

  const adding = () => !panel.hidden && panel.classList.contains("open") && !addForm.hidden;
  function openAdd() {
    selected = null;
    syncOutline();
    showPanel(true);
    setTimeout(() => nameInput.focus({ preventScroll: true }), reduce ? 0 : 120);
  }
  addButton.addEventListener("click", (e) => {
    e.preventDefault();
    openAdd();
  });

  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const press = (b) => quick.forEach((q) => q.setAttribute("aria-pressed", String(q === b)));
  for (const b of quick) {
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      const d = new Date();
      d.setDate(d.getDate() + Number(b.dataset.days));
      expiryInput.value = on ? localIso(d) : "";
      press(on ? b : null);
    });
  }
  expiryInput.addEventListener("input", () => press(null));

  let toastTimer;
  function say(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
  }

  const where = (h) => h.userData.lane?.name ?? "in the fridge door";

  function arrive(item) {
    const h = shelve(item);
    if (!h) {
      say(`Added ${item.name}. The shelves are full, so it's in the list below.`);
      return;
    }
    const away = item.place !== view;
    if (away) go(item.place, true);
    // arriving at the fridge, wait for the doors to swing most of the way
    h.userData.landAt = clock.elapsedTime + (!away ? 0.15 : item.place === "fridge" ? 1.45 : 0.95);
    arrivals.add(h);
    syncOutline();
    setTimeout(() => {
      arrivals.delete(h);
      syncOutline();
    }, away ? 3400 : 2600);
    say(`Added ${item.name} ${where(h)}.`);
  }

  // the stats, the counts under the switcher and everything below the scene
  // (the form, the table) come from the fresh page, so they all agree
  function refresh(doc) {
    const stats = doc.querySelector(".kx-stats");
    if (stats) root.querySelector(".kx-stats").replaceChildren(...stats.childNodes);
    for (const key of ["data-kx-count-fridge", "data-kx-count-pantry"]) {
      const fresh = doc.querySelector(`[${key}]`);
      if (fresh) root.querySelector(`[${key}]`).textContent = fresh.textContent;
    }
    const mark = document.getElementById("kitchen-data");
    const next = doc.getElementById("kitchen-data");
    mark.textContent = next.textContent;
    while (mark.nextSibling) mark.nextSibling.remove();
    const below = [];
    for (let n = next.nextSibling; n; n = n.nextSibling) below.push(n);
    mark.after(...below);
  }

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (addForm.dataset.busy) return;
    addForm.dataset.busy = "1";
    const submit = addForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      let res;
      try {
        res = await fetch(addForm.action, {
          method: "POST",
          body: new URLSearchParams(new FormData(addForm)),
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
        });
      } catch {
        addForm.submit(); // offline or blocked: post it the ordinary way
        return;
      }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (res.status === 422) {
        addErrors.replaceChildren(...(doc.querySelector(".kx-add .form-errors") ? [doc.querySelector(".kx-add .form-errors")] : []));
        addErrors.querySelector(".form-errors")?.setAttribute("tabindex", "-1");
        addErrors.querySelector(".form-errors")?.focus();
        return;
      }
      const data = doc.getElementById("kitchen-data");
      // signed out meanwhile, or anything else unexpected: go where it went
      if (!res.ok || !data) {
        location.assign(res.url);
        return;
      }
      addErrors.replaceChildren();
      const added = JSON.parse(data.textContent).filter((it) => !itemsById.has(it.id));
      refresh(doc);
      for (const item of added) arrive(item);
      addForm.reset();
      press(null);
      // a phone's panel covers the lower shelves, so get out of the way to
      // let the item be seen landing; on a wide screen stay ready for the next
      if (narrow.matches) closePanel();
      else nameInput.focus({ preventScroll: true });
    } finally {
      delete addForm.dataset.busy;
      submit.disabled = false;
    }
  });

  /* ---------- theme: in dark mode it's night, the fridge light is on ---------- */
  let dark = isDark();
  let lightLevel = dark ? 1 : 0.15;
  let lightTarget = lightLevel;
  function applyTheme(d) {
    dark = d;
    lightTarget = d ? 1 : 0.15;
    wallMat.color.set(d ? 0x2a2420 : 0xf3eee7);
    floorMat.color.set(d ? 0x221d19 : 0xe9e1d6);
    skirting.material.color.set(d ? 0x332c27 : 0xfbf8f3);
    hemi.intensity = d ? 0.22 : 0.7;
    hemi.color.set(d ? 0x8a7f74 : 0xfff8ef);
    key.intensity = d ? 0.35 : 2.6;
    key.color.set(d ? 0x9fb2d6 : 0xfff1e0); // moonlight vs. morning sun
    fill.intensity = d ? 0.12 : 0.55;
    scene.environmentIntensity = d ? 0.25 : 0.85;
    renderer.toneMappingExposure = d ? 1.15 : 1.0;
    outline.overlayMaterial.uniforms.inkColor.value.set(d ? 0xa8d8b6 : 0x3f8a63);
  }
  applyTheme(dark);
  window.addEventListener("larder:theme", (e) => applyTheme(e.detail.dark));

  /* ---------- resize ---------- */
  // Horizontal framing: on wide screens the scene sits right of the headline;
  // with the side panel open it slides left so nothing hides behind the panel.
  let wide = true;
  let openAngle = 2.18; // ~125°: wide enough to show the door bins (set in resize)
  let shift = -0.16;
  let shiftTarget = -0.16;
  function applyOffset() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!wide) camera.clearViewOffset();
    else camera.setViewOffset(w, h, shift * w, 0, w, h);
  }
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    outline.resolution.set(w, h);
    camera.aspect = w / h;
    // phones see the fridge from further back so both doors fit
    const narrow = w / h < 0.9;
    camera.fov = narrow ? 44 : 30;
    // on wide screens push the scene right so the headline has its own space;
    // the side panel then opens over empty floor rather than the fridge
    wide = !narrow;
    applyOffset();
    // the open doors are the widest thing in the room: on laptop-shaped
    // screens step back far enough that both still clear the edge and the
    // headline
    VIEWS.fridge.pos.z = narrow ? 9.6 : Math.max(7.9, 12.0 / camera.aspect);
    // on a phone the doors swing a little less wide (~110°) so both stay in frame
    openAngle = narrow ? 1.92 : 2.18;
    VIEWS.pantry.pos.z = narrow ? 8.8 : 7.0;
    if (!travel) camPos.z = VIEWS[view].pos.z;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---------- loop ---------- */
  const clock = new THREE.Clock();
  // the doors swing open as the page arrives (items then pop onto shelves),
  // close behind you as you slide over to the pantry, and open again when
  // you come back. Starting on the pantry, they stay shut until you visit.
  let openTarget = view === "fridge" ? 1 : 0;
  let opening = reduce ? openTarget : 0;
  stage.classList.add("ready");

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // doors: open over 1.6s; shut a little quicker, a beat after the camera
    // starts moving away, as if pushed closed in passing. One curve both ways
    // (soft-close), so turning back mid-swing never jumps.
    if (reduce) opening = openTarget;
    else if (opening < openTarget) opening = Math.min(openTarget, opening + dt / 1.6);
    else if (opening > openTarget && (!travel || travel.t > 0.18)) opening = Math.max(openTarget, opening - dt / 0.9);
    const swing = easeInOut(Math.max(0, (opening - 0.08) / 0.92));
    // each door turns outward about its hinge: left door anticlockwise seen
    // from above (negative y), right door clockwise
    for (const d of doors) d.hinge.rotation.y = d.side * swing * openAngle;

    // fridge light: fades up as the doors open; brighter at night
    lightLevel += (lightTarget - lightLevel) * Math.min(1, dt * 3);
    const lit = lightLevel * swing;
    bulb.intensity = lit * 6.5;
    liner.emissiveIntensity = lit * (dark ? 0.32 : 0.06);
    glowSpot.intensity = lit * (dark ? 22 : 4);
    strip.material.color.setScalar(0.75 + lit * 0.25).multiply(new THREE.Color(0xfff6e4));
    // pantry under-shelf strips follow the same night level, no door needed
    const night = Math.max(0, (lightLevel - 0.15) / 0.85);
    for (const l of shelfLights) l.intensity = night * 3.2;
    ledMat.color.copy(LED_OFF).lerp(LED_ON, night);

    // camera travel between fridge and pantry, eased, with a soft arc
    if (travel) {
      travel.t = Math.min(1, travel.t + dt / (reduce ? 0.01 : 1.15));
      const k = easeInOut(travel.t);
      camPos.lerpVectors(travel.from, travel.to, k);
      camPos.z += Math.sin(k * Math.PI) * 1.4; // pull back mid-slide, like a dolly
      camLook.lerpVectors(travel.fromLook, travel.toLook, k);
      if (travel.t >= 1) travel = null;
    }
    if (Math.abs(shiftTarget - shift) > 0.0005) {
      shift += (shiftTarget - shift) * Math.min(1, dt * (reduce ? 60 : 5));
      applyOffset();
      camera.updateProjectionMatrix();
    }
    parallax.lerp(parallaxT, Math.min(1, dt * 3));
    const px = reduce ? 0 : parallax.x * 0.18;
    const py = reduce ? 0 : parallax.y * 0.1;
    camera.position.set(camPos.x + px, camPos.y - py, camPos.z);
    camera.lookAt(camLook.x + px * 0.3, camLook.y - py * 0.3, camLook.z);

    // items: drop onto their shelf after the doors open (the pantry's land
    // again each time you arrive), squash a touch, rock on their base and
    // settle; then lift on hover / selection
    for (const h of pickables) {
      const u = h.userData;
      if (u.landAt === null) u.landAt = (h.parent === pantry ? 0.25 : 0.55) + u.delay;
      const land = reduce ? null : landing(t - u.landAt, u);
      u.entered = land ? land.entered : 1;
      u.hover += ((h === hovered ? 1 : 0) - u.hover) * Math.min(1, dt * 10);
      u.sel += ((h === selected ? 1 : 0) - u.sel) * Math.min(1, dt * 8);
      const lift = Math.max(u.hover, u.sel);
      const bob = reduce ? 0 : Math.sin(t * 2.4 + u.item.id) * 0.012 * lift;
      const drop = land ? land.drop : 0;
      u.mesh.position.y = lift * 0.14 + bob + drop;
      if (u.dot) u.dot.position.y = u.dotY + lift * 0.14 + drop;
      const s = (land ? land.scale : 1) * (1 + lift * 0.06);
      const squash = land ? land.squash : 0;
      h.scale.set(Math.max(0.001, s * (1 + squash * 0.5)), Math.max(0.001, s * (1 - squash)), Math.max(0.001, s * (1 + squash * 0.5)));
      // rock about the bottom edge it tips onto: turn, then shift so that
      // edge stays planted on the shelf (meshes sit with their base at y = 0)
      const rock = land ? land.rock * u.rockDir : 0;
      const e = Math.sign(rock) * u.halfW;
      u.mesh.rotation.z = rock;
      u.mesh.position.x = e * (1 - Math.cos(rock));
      u.mesh.position.y -= e * Math.sin(rock);
      h.rotation.z = reduce ? 0 : Math.sin(t * 1.8 + u.item.id) * 0.025 * lift;
      if (u.dot) {
        u.dot.scale.setScalar(1 + Math.sin(t * 4 + u.item.id) * 0.18);
      }
    }

    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Pale oak floorboards, so the room has a ground plane with some life.
function floorTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d");
  const PL = 128;
  g.fillStyle = "#cdbca4"; // the seams between boards
  g.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += PL) {
    const off = (y / PL) % 2 ? 300 : 0;
    for (let x = -off; x < 1024; x += 620) {
      const tone = 214 + Math.random() * 14;
      g.fillStyle = `rgb(${tone}, ${tone - 14}, ${tone - 32})`;
      g.fillRect(x, y, 618, PL - 2);
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = `rgba(150, 110, 70, ${0.04 + Math.random() * 0.06})`;
        g.beginPath();
        const yy = y + Math.random() * PL;
        g.moveTo(x, yy);
        g.bezierCurveTo(x + 200, yy + 4, x + 400, yy - 4, x + 618, yy + 2);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 2);
  t.anisotropy = 8;
  return t;
}

// A soft procedural oak grain, so the shelves read as wood up close.
function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#c99b6b";
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 64;
    g.strokeStyle = `rgba(${120 + Math.random() * 40}, ${80 + Math.random() * 30}, ${40 + Math.random() * 20}, ${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 0.5 + Math.random() * 1.8;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 2.2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
