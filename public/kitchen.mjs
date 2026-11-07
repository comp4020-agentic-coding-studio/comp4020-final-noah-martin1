// The fridge and pantry: a 3D kitchen built from the person's own inventory.
// A double-door fridge and, past a low sideboard, an old-fashioned larder
// cupboard; the arrow slides the camera between them, and each one's doors
// close behind you as the other's open ahead. Every item is
// drawn as itself (a lemon, a tray of mince, a jar of peanut butter) by
// public/kitchen-models.mjs, from a model and look chosen server-side in
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
import { dropFor, fitScale, fitsPlan, frontToBack, inLarderDoor, larderLevelFor, liftFor, newLane, orderStack, planLane, rotatedExtent, shelfFor, takeSlot } from "./kitchen-layout.mjs";
import { PRODUCE, buildModel } from "./kitchen-models.mjs";
import { t } from "./i18n.mjs";

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
  const DRAWER_TOP = FOOT + T + 0.005; // the cavity floor holds the drawer
  for (const y of SHELVES) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.02, D - T - 0.06), glass);
    pane.position.set(0, y - 0.01, -D / 2 - 0.0);
    pane.receiveShadow = true;
    fridge.add(pane);
    const edge = new THREE.Mesh(new RoundedBoxGeometry(W - 0.04, 0.035, 0.035, 2, 0.012), glassEdge);
    edge.position.set(0, y - 0.012, -0.06);
    fridge.add(edge);
  }
  // crisper drawer, sitting on the cavity floor: a clear front with a frosted
  // band along its top edge and a handle, so the produce inside shows
  const crisperGlass = new THREE.MeshPhysicalMaterial({ color: 0xe4f2ee, roughness: 0.1, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false });
  const crisper = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.5, 0.03, 3, 0.012), crisperGlass);
  crisper.position.set(0, FOOT + T + 0.25, -0.08);
  fridge.add(crisper);
  const crisperBand = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.07, 0.034, 2, 0.012), new THREE.MeshPhysicalMaterial({ color: 0xeef5f2, roughness: 0.35, transparent: true, opacity: 0.85 }));
  crisperBand.position.set(0, FOOT + T + 0.465, -0.08);
  fridge.add(crisperBand);

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

  /* ---------- the pantry: an old-fashioned larder cupboard ---------- */
  // A tall painted larder the height of the fridge, so the two read as a
  // pair: a cornice and a plinth, two panelled doors with pierced zinc vents
  // (a larder breathes), brass knobs and hinges. Inside: boarded walls, pine
  // shelves with scalloped paper edging, a cold slate shelf, and spice racks
  // on the backs of the doors. The doors open as you arrive and close
  // behind you when you go back to the fridge.
  const PX = 5.6; // larder centre x
  const pantry = new THREE.Group();
  pantry.position.set(PX, 0, 0);
  scene.add(pantry);
  const LW = 2.0; // inside width
  const LT = 0.07; // carcass wall thickness
  const LF = 0.3; // front face z (the wall is at -0.62)
  const LB = -0.52; // inside face of the back boards
  const L_FLOOR = 0.16; // top of the larder's floor
  const L_CEIL = 2.8; // underside of its top
  const SLATE = 0.7; // top of the cold slate shelf
  const L_SHELVES = [1.2, 1.64, 2.06]; // tops of the pine shelves above it
  const SHELF_FRONT = 0.13; // the shelves stop short of the door racks
  // an old duck-egg blue-grey, so the larder stands out from the cream wall
  // as a piece of furniture and sits well beside the sage fridge
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x8fa9ae, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 });
  const plinthPaint = new THREE.MeshStandardMaterial({ color: 0x5f6f72, roughness: 0.7 });
  const pine = new THREE.MeshStandardMaterial({ color: 0xe6c697, roughness: 0.6, map: woodTexture() });
  const slate = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, map: slateTexture() });
  // the boarded inside, in a pale limewash; it glows a little when the
  // larder's bulb is on, like the fridge's liner
  const boardTex = boardTexture("#e3ebe5");
  const boardMats = [];
  const boards = (rx) => {
    const map = boardTex.clone();
    map.repeat.set(rx, 1);
    map.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map, emissive: 0xffe6c4, emissiveIntensity: 0 });
    boardMats.push(m);
    return m;
  };
  const part = (parent, w, h, d, x, y, z, m, r = 0.012) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const OW = LW + 2 * LT; // outside width
  const LD = LF - (LB - 0.06); // outside depth, back boards included
  const LZ = LF - LD / 2; // its middle
  // carcass: sides, back, floor, top, then the cornice and a recessed plinth
  for (const s of [-1, 1]) part(pantry, LT, 2.84, LD, s * (LW / 2 + LT / 2), 1.54, LZ, paint, 0.01);
  part(pantry, LW, 2.76, 0.06, 0, 1.5, LB - 0.03, boards(2), 0.004);
  for (const s of [-1, 1]) part(pantry, 0.012, L_CEIL - L_FLOOR, LF - LB, s * (LW / 2 - 0.006), (L_CEIL + L_FLOOR) / 2, (LF + LB) / 2, boards(0.8), 0.003);
  part(pantry, LW, 0.04, LF - LB, 0, L_FLOOR - 0.02, (LF + LB) / 2, boards(2), 0.004);
  part(pantry, OW, 0.16, LD, 0, L_CEIL + 0.08, LZ, paint, 0.01);
  part(pantry, OW + 0.06, 0.05, LD + 0.04, 0, 2.985, LZ + 0.02, paint, 0.012);
  part(pantry, OW + 0.14, 0.06, LD + 0.08, 0, 3.04, LZ + 0.04, paint, 0.02);
  part(pantry, OW + 0.2, 0.04, LD + 0.11, 0, 3.09, LZ + 0.055, paint, 0.015);
  part(pantry, OW - 0.08, 0.12, LD - 0.1, 0, 0.06, LZ - 0.05, plinthPaint, 0.01);
  part(pantry, OW, 0.04, LD, 0, 0.12, LZ, paint, 0.008);
  // the cold slate shelf, and three pine shelves, each with a strip of
  // scalloped paper pinned along its front
  const shelfDepth = SHELF_FRONT - LB;
  part(pantry, LW - 0.004, 0.05, shelfDepth, 0, SLATE - 0.025, (SHELF_FRONT + LB) / 2, slate, 0.006);
  const edging = new THREE.MeshStandardMaterial({ map: edgingTexture(LW), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  for (const y of L_SHELVES) {
    part(pantry, LW - 0.004, 0.04, shelfDepth, 0, y - 0.02, (SHELF_FRONT + LB) / 2, pine, 0.008);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(LW - 0.01, 0.052), edging);
    strip.position.set(0, y - 0.022, SHELF_FRONT + 0.004);
    pantry.add(strip);
  }
  // a caged bulb on the inside of the top rail: on when the doors are open,
  // warm and bright at night (it's dark; you've opened the larder)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
  const lamp = new THREE.Group();
  lamp.position.set(0, L_CEIL, LF - 0.09);
  pantry.add(lamp);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), lampMat);
  globe.position.y = -0.075;
  lamp.add(globe);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.025, 20), brass);
  rose.position.y = -0.012;
  lamp.add(rose);
  for (let k = 0; k < 3; k++) {
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0035, 6, 24), brass);
    wire.position.y = -0.075;
    wire.rotation.y = (k * Math.PI) / 3;
    lamp.add(wire);
  }
  const larderBulb = new THREE.PointLight(0xffd39c, 0, 3.4, 1.5);
  larderBulb.position.set(0, L_CEIL - 0.18, 0.0);
  pantry.add(larderBulb);
  const larderGlow = new THREE.SpotLight(0xffd6a0, 0, 7, 0.95, 0.85, 1.4);
  larderGlow.position.set(0, 1.9, -0.25);
  larderGlow.target.position.set(0, 0.1, 2.6);
  pantry.add(larderGlow, larderGlow.target);

  // the doors: hinged at the outer edges like the fridge's, each a painted
  // slab with a raised frame, a fielded panel below and a pierced zinc vent
  // above, a brass knob by the meeting edge and brass hinges; inside,
  // boards and three spice racks with a brass rail
  const L_DOOR_W = LW / 2 + LT;
  const L_DOOR_T = 0.05;
  const L_DOOR_H = 2.81; // from y 0.13 up to just under the cornice
  const RACK_D = 0.14;
  const RACK_W = L_DOOR_W - 0.25;
  const zinc = new THREE.MeshStandardMaterial({ map: zincTexture(), metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
  const larderDoors = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (LW / 2 + LT), 0.13, LF);
    pantry.add(hinge);
    const slab = new THREE.Group();
    slab.position.set((-side * L_DOOR_W) / 2, 0, L_DOOR_T / 2);
    hinge.add(slab);
    const dw = L_DOOR_W - 0.006;
    part(slab, dw, L_DOOR_H, L_DOOR_T, 0, L_DOOR_H / 2, 0, paint, 0.01);
    const STILE = 0.11;
    const MID = 2.06; // the middle rail: vent above, panel below
    const fz = L_DOOR_T / 2 + 0.006;
    for (const [w, h, x, y] of [
      [STILE, L_DOOR_H, -dw / 2 + STILE / 2, L_DOOR_H / 2],
      [STILE, L_DOOR_H, dw / 2 - STILE / 2, L_DOOR_H / 2],
      [dw, 0.16, 0, 0.08],
      [dw, 0.11, 0, MID],
      [dw, 0.11, 0, L_DOOR_H - 0.055],
    ]) part(slab, w, h, 0.012, x, y, fz, paint, 0.004);
    const inner = dw - 2 * STILE;
    const panelLo = 0.16, panelHi = MID - 0.055;
    part(slab, inner - 0.05, panelHi - panelLo - 0.05, 0.01, 0, (panelLo + panelHi) / 2, L_DOOR_T / 2 + 0.005, paint, 0.008);
    const ventLo = MID + 0.055, ventHi = L_DOOR_H - 0.11;
    for (const face of [1, -1]) {
      const vent = new THREE.Mesh(new THREE.PlaneGeometry(inner - 0.02, ventHi - ventLo - 0.02), zinc);
      vent.position.set(0, (ventLo + ventHi) / 2, face * (L_DOOR_T / 2 + 0.0015));
      if (face < 0) vent.rotation.y = Math.PI;
      slab.add(vent);
    }
    // the boarded back of the door
    const back = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.04, L_DOOR_H - 0.04), boards(1.05));
    back.rotation.y = Math.PI;
    back.position.set(0, L_DOOR_H / 2, -L_DOOR_T / 2 - 0.0008);
    back.receiveShadow = true;
    slab.add(back);
    // knob on the meeting stile, and three hinge knuckles on the outer edge
    const kx = -side * (dw / 2 - STILE / 2);
    const knobRose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 20), brass);
    knobRose.rotation.x = Math.PI / 2;
    knobRose.position.set(kx, 1.42, L_DOOR_T / 2 + 0.016);
    const knobNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.035, 12), brass);
    knobNeck.rotation.x = Math.PI / 2;
    knobNeck.position.set(kx, 1.42, L_DOOR_T / 2 + 0.035);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), brass);
    knob.position.set(kx, 1.42, L_DOOR_T / 2 + 0.06);
    knob.castShadow = true;
    slab.add(knobRose, knobNeck, knob);
    for (const y of [0.3, 1.4, 2.5]) {
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 12), brass);
      knuckle.position.set(0, y, L_DOOR_T * 0.55);
      hinge.add(knuckle);
    }
    // spice racks: a pine ledge, end cheeks and a brass rail along the front
    const racks = [];
    for (const ry of [0.82, 1.29, 1.76]) {
      const rack = new THREE.Group();
      rack.position.set(0, ry, -L_DOOR_T / 2);
      slab.add(rack);
      part(rack, RACK_W, 0.014, RACK_D, 0, 0.007, -RACK_D / 2, pine, 0.004);
      for (const ex of [-RACK_W / 2, RACK_W / 2]) part(rack, 0.014, 0.075, RACK_D, ex, 0.037, -RACK_D / 2, pine, 0.004);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, RACK_W, 10), brass);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 0.042, -RACK_D + 0.008);
      rack.add(rail);
      racks.push(rack);
    }
    larderDoors.push({ side, hinge, slab, racks });
  }

  /* ---------- between them: a low painted sideboard ---------- */
  // Kept low, under the headline, so the wall above stays quiet for the
  // text; it ties the fridge and the larder into one kitchen as the camera
  // slides between them. Nothing on it is food, so nothing on it is clickable.
  const sideboard = new THREE.Group();
  sideboard.position.set(2.78, 0, 0);
  scene.add(sideboard);
  part(sideboard, 1.72, 0.08, 0.46, 0, 0.04, -0.37, plinthPaint, 0.01);
  part(sideboard, 1.8, 0.7, 0.52, 0, 0.43, -0.34, paint, 0.015);
  part(sideboard, 1.9, 0.05, 0.58, 0, 0.805, -0.32, pine, 0.012);
  for (const sx of [-0.44, 0.44]) {
    part(sideboard, 0.8, 0.2, 0.014, sx, 0.66, -0.077, paint, 0.005);
    part(sideboard, 0.8, 0.36, 0.014, sx, 0.3, -0.077, paint, 0.005);
    for (const ky of [0.66, 0.33]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), brass);
      k.position.set(sx + (ky > 0.5 ? 0 : -Math.sign(sx) * 0.3), ky, -0.055);
      sideboard.add(k);
    }
  }
  // a potted herb and a stoneware crock of wooden spoons, kept short so they
  // stay clear of the headline above
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 24), new THREE.MeshStandardMaterial({ color: 0xe2ad94, roughness: 0.8 }));
  pot.position.set(0.55, 0.94, -0.3);
  pot.castShadow = true;
  sideboard.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x7fb08a, roughness: 0.7 });
  for (let k = 0; k < 9; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), leafMat);
    const a = k * 2.4;
    leaf.scale.set(1, 0.55, 0.7);
    leaf.position.set(0.55 + Math.cos(a) * 0.1, 1.1 + (k % 3) * 0.065, -0.3 + Math.sin(a) * 0.1);
    leaf.rotation.set(k * 0.7, a, 0.5);
    leaf.castShadow = true;
    sideboard.add(leaf);
  }
  const crockMat = new THREE.MeshPhysicalMaterial({ color: 0xe0d5bf, roughness: 0.35, clearcoat: 0.6 });
  const crock = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.22, 24), crockMat);
  crock.position.set(-0.5, 0.94, -0.33);
  crock.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x4f6f8c, roughness: 0.5 }));
  band.position.set(-0.5, 0.99, -0.33);
  sideboard.add(crock, band);
  for (const [dx, dz, tilt] of [[-0.03, 0.01, 0.12], [0.03, -0.02, -0.1], [0.0, 0.03, 0.02]]) {
    const spoon = new THREE.Group();
    spoon.position.set(-0.5 + dx, 0.88, -0.33 + dz);
    spoon.rotation.z = tilt;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.34, 8), pine);
    handle.position.y = 0.17;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), pine);
    bowl.scale.set(1, 1.5, 0.45);
    bowl.position.y = 0.37;
    spoon.add(handle, bowl);
    sideboard.add(spoon);
  }

  /* ---------- place items on shelves ---------- */
  // Fridge zones: crisper (produce), three glass shelves, door bins
  // (milk, juice, bottles, jars, tins and butter go in the door while it has room).
  const DOOR_MODELS = new Set(["milk", "juice", "cream", "bottle", "jar", "can", "butter"]);
  const fridgeItems = items.filter((i) => i.place === "fridge");
  const pantryItems = items.filter((i) => i.place === "pantry");
  const pickables = [];
  const itemsById = new Map();

  // What a model measures at rest (footprint and height), built once per look,
  // so the shelves pack by the real size rather than a hand-typed width.
  const sizes = new Map();
  function measure(item) {
    const key = item.model + JSON.stringify(item.look ?? {});
    let m = sizes.get(key);
    if (!m) {
      const [g] = buildModel(item);
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      m = { w: size.x, d: size.z, h: size.y };
      sizes.set(key, m);
    }
    return m;
  }

  // The builders only roughly centre a model and sit it on y = 0 (a bevel dips
  // under, a wedge of cheese is lopsided). So each is measured, shifted so its
  // footprint is centred and its lowest point rests exactly on the shelf, and
  // shrunk a little if the shelf above would otherwise cut through it.
  // `free` is the headroom above the shelf.
  function addItem(item, parent, x, y, z, rotY = 0, free = Infinity) {
    const [raw] = buildModel(item);
    const meshes = [];
    raw.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.itemId = item.id;
        meshes.push(o);
      }
    });
    const bb = new THREE.Box3().setFromObject(raw);
    const size = bb.getSize(new THREE.Vector3());
    raw.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    // `mesh` is what hover lifts and rocks; `raw` inside it carries the offset
    const mesh = new THREE.Group();
    mesh.add(raw);
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = rotY;
    holder.add(mesh);
    const fit = fitScale(size.y, free);
    const { lift, grow } = liftFor(size.y * fit, free);
    // A still box around the item and the room it rises into, for a pointer
    // that lands just beside it; the real geometry is tested first.
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + 0.03, size.y + lift / fit + 0.03, size.z + 0.03),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(0, (size.y + lift / fit) / 2, 0);
    holder.add(hit);
    // which way it rocks when it lands, and how far from its middle to the
    // edge it rocks on (so tall bottles tip less than squat tubs)
    const rockDir = Math.sin(item.id * 78.233) > 0 ? 1 : -1;
    const halfW = Math.max(0.04, size.x / 2);
    holder.userData = { item, baseY: y, lift: 0, hover: 0, sel: 0, mesh, hit, meshes, entered: 0, delay: 0, landAt: null, rockDir, halfW, tall: size.y * fit, fit, free, liftMax: lift, grow };
    // expiring soon: a small glowing dot floats above it
    if (item.fresh === "soon" || item.fresh === "expired") {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), new THREE.MeshBasicMaterial({ color: item.fresh === "expired" ? 0xef6b5b : 0xf2b04c }));
      dot.position.set(0, size.y + 0.06 / fit, 0);
      holder.userData.dotY = dot.position.y;
      holder.add(dot);
      holder.userData.dot = dot;
    }
    parent.add(holder);
    pickables.push(holder);
    itemsById.set(item.id, holder);
    return holder;
  }

  // A lane is one shelf. public/kitchen-layout.mjs packs it: items stand on
  // their measured footprint (turned as they're turned), in a front row and a
  // staggered back row that never overlap, inside zNear..zFar. `free` is the
  // headroom up to whatever is overhead, so nothing is made to stand through
  // the shelf above it.
  const lane = (name, parent, xMin, xMax, y, zNear, zFar, free) => newLane({ name, parent, xMin, xMax, y, zNear, zFar, free });
  const jitter = (item) => Math.sin(item.id * 12.9898) * 0.12;
  function spot(item) {
    const m = measure(item);
    const rot = jitter(item);
    const e = rotatedExtent(m.w, m.d, rot);
    return { m, rot, w: e.x, d: e.z };
  }
  // fits if it stands on this lane without being squashed noticeably
  function fitsLane(item, ln) {
    const s = spot(item);
    return fitScale(s.m.h, ln.free) >= 0.8 && !!takeSlot(ln, s.w, s.d, true);
  }
  function place(item, ln) {
    if (!fitsLane(item, ln)) return null;
    const s = spot(item);
    const slot = takeSlot(ln, s.w, s.d);
    const h = addItem(item, ln.parent, slot.x, ln.y, slot.z, s.rot, ln.free);
    h.userData.delay = slot.index * 0.06 + slot.row * 0.1;
    h.userData.lane = ln;
    return h;
  }
  // Lay a list out over several lanes. First each item is given a lane: its
  // own if there's room, and only once everything has had its own does what
  // didn't fit take room on the nearest level that has it (so a crowded meat
  // shelf can't push the milk out, and potatoes that miss the bench go to
  // the bottom shelf, not the top). Then each lane is set out whole
  // (kitchen-layout.mjs planLane): shortest in front, spread evenly, the
  // taller ones standing in the gaps behind. Room is judged by the same plan,
  // so what's given a lane gets a spot on it. One that fits nowhere stays in
  // the list below the scene rather than being squeezed in.
  function layAll(list, lanes, preferred) {
    const into = new Map(lanes.map((ln) => [ln, []]));
    const ordered = (ln, extra) => frontToBack([...into.get(ln), extra], (item) => measure(item).h);
    const take = (item, ln) => {
      if (fitScale(measure(item).h, ln.free) < 0.8 || !fitsPlan(ln, ordered(ln, item).map(spot))) return false;
      into.get(ln).push(item);
      return true;
    };
    const left = list.filter((item, i) => !take(item, lanes[preferred(item, i)]));
    for (const item of left) {
      const from = preferred(item, list.indexOf(item));
      [...lanes].sort((a, b) => Math.abs(lanes.indexOf(a) - from) - Math.abs(lanes.indexOf(b) - from)).find((ln) => take(item, ln));
    }
    for (const ln of lanes) {
      const items = frontToBack(into.get(ln), (item) => measure(item).h);
      const spots = items.map(spot);
      planLane(ln, spots).forEach((slot, i) => {
        const h = addItem(items[i], ln.parent, slot.x, ln.y, slot.z, spots[i].rot, ln.free);
        h.userData.delay = slot.index * 0.06 + slot.row * 0.1;
        h.userData.lane = ln;
      });
    }
  }
  // door bins: alternate left and right doors, three bins each. The bin's base
  // is a thin tray, so an item stands on its top face, with the next bin's
  // tray as the ceiling.
  // Each bin is packed by width, one row from the hinge side, so it holds as
  // many as fit; bins fill alternately left and right, bottom up, tall things
  // first to the bottom bins where the swing shows them whole. Items are
  // turned round to face out of the door (labels towards the room) and a
  // little more towards the camera.
  let bi = 0;
  const BIN_FLOOR = 0.0075;
  const BIN_W = doorW - 0.28;
  const binOrder = [0, 1, 2].flatMap((k) => doors.map((door) => ({ door, bin: door.bins[k], used: 0 })));
  function placeInDoor(item) {
    const m = measure(item);
    const turn = Math.PI + 0.35;
    const w = rotatedExtent(m.w, m.d, turn).x;
    if (m.h * fitScale(m.h, 0.68) < m.h * 0.8) return null;
    const spot = binOrder.find((b) => b.used + w <= BIN_W);
    if (!spot) return null;
    const { door, bin } = spot;
    // from the hinge side inward
    const x = (-BIN_W / 2 + spot.used + w / 2) * -door.side;
    spot.used += w + 0.03;
    const h = addItem(item, bin, x, BIN_FLOOR + 0.0005, -0.02, Math.PI + door.side * 0.35, 0.68);
    h.userData.delay = 0.3 + bi * 0.05;
    bi++;
    return h;
  }

  // sort: door candidates first to the door; produce to the crisper; the rest
  // onto the shelves (tall things where there's headroom, the rest spread out)
  // Herbs stand in their glass of water on a shelf, not lying in the drawer.
  const crisperModel = (i) => PRODUCE.has(i.model) && i.model !== "herbs";
  const doorQueue = [...fridgeItems.filter((i) => DOOR_MODELS.has(i.model))].sort((a, b) => measure(b).h - measure(a).h);
  const crisperQueue = fridgeItems.filter(crisperModel);
  let shelfQueue = fridgeItems.filter((i) => !DOOR_MODELS.has(i.model) && !crisperModel(i));

  const overflow = doorQueue.filter((item) => !placeInDoor(item));
  shelfQueue = [...shelfQueue, ...overflow];

  // crisper: produce sits on the drawer's floor, behind its clear front
  const crisperLane = lane("in the crisper", fridge, -W / 2 + 0.14, W / 2 - 0.14, DRAWER_TOP, -0.16, -0.82, SHELVES[0] - 0.02 - DRAWER_TOP);
  // as many as the drawer holds, shortest first (they fill its front row and
  // the rest stand in the gaps behind)
  const inCrisper = [];
  const overCrisper = [];
  for (const item of frontToBack(crisperQueue, (x) => measure(x).h)) {
    const fits = fitScale(measure(item).h, crisperLane.free) >= 0.8 && fitsPlan(crisperLane, frontToBack([...inCrisper, item], (x) => measure(x).h).map(spot));
    (fits ? inCrisper : overCrisper).push(item);
  }
  layAll(inCrisper, [crisperLane], () => 0);
  // shelves: meat and fish on the bottom, dairy in the middle, tall cartons
  // and the rest up top (src/kitchen-layout.mjs shelfFor); produce the
  // crisper couldn't take comes last, into whatever room is left
  const SHELF_NAMES = ["bottom", "middle", "top"];
  const CEILING = FOOT + T + H - 0.06;
  const shelfLanes = SHELVES.map((y, si) =>
    lane(`on the ${SHELF_NAMES[si]} shelf`, fridge, -W / 2 + 0.12, W / 2 - 0.12, y + 0.002, -0.17, -0.84, (si < 2 ? SHELVES[si + 1] - 0.02 : CEILING) - (y + 0.002)),
  );
  // herbs in their glass and produce the crisper couldn't take go up top,
  // never down by the raw meat
  const shelfOf = (item) => (PRODUCE.has(item.model) ? 2 : shelfFor(item.model));
  layAll([...shelfQueue, ...overCrisper], shelfLanes, shelfOf);

  // the larder door racks: spices and little bottles, packed by width from
  // the hinge side, the eye-level racks first, alternating doors; turned to
  // face out of the door and a little towards the camera, as in the fridge
  const RACK_FLOOR = 0.0145;
  const RACK_FREE = 0.43;
  const IN_RACK = "in a pantry door rack";
  const rackOrder = [1, 0, 2].flatMap((k) => larderDoors.map((door) => ({ door, rack: door.racks[k], used: 0 })));
  let ri = 0;
  function placeInRack(item) {
    const m = measure(item);
    if (!inLarderDoor(item.model, m.h)) return null;
    const turn = Math.PI + 0.35;
    const e = rotatedExtent(m.w, m.d, turn);
    // (jars and tins are round, so turning them doesn't make them deeper)
    if (Math.max(m.w, m.d) > RACK_D - 0.01) return null;
    const spot = rackOrder.find((r) => r.used + e.x <= RACK_W - 0.04);
    if (!spot) return null;
    const { door, rack } = spot;
    const x = (-(RACK_W - 0.04) / 2 + spot.used + e.x / 2) * -door.side;
    spot.used += e.x + 0.025;
    const h = addItem(item, rack, x, RACK_FLOOR, -RACK_D / 2 - 0.004, Math.PI + door.side * 0.35, RACK_FREE);
    h.userData.delay = 0.25 + ri * 0.04;
    h.userData.lane = { name: IN_RACK };
    ri++;
    return h;
  }
  // larder levels (kitchen-layout.mjs larderLevelFor): sacks and roots on
  // the floor, tins, cartons and bread on the cold slate, packets, then jars,
  // then bottles; spices in the door racks while they have room, the rest
  // up top with the bottles
  const PANTRY_NAMES = ["on the pantry floor", "on the cold slate shelf", "on the bottom pantry shelf", "on the middle pantry shelf", "on the top pantry shelf"];
  const levelTops = [L_FLOOR, SLATE, ...L_SHELVES];
  const ceilings = [SLATE - 0.05, L_SHELVES[0] - 0.04, L_SHELVES[1] - 0.04, L_SHELVES[2] - 0.04, L_CEIL - 0.13];
  const pantryLanes = levelTops.map((y, si) => lane(PANTRY_NAMES[si], pantry, -LW / 2 + 0.06, LW / 2 - 0.06, y + 0.0015, SHELF_FRONT - 0.015, LB + 0.015, ceilings[si] - y - 0.0015));
  const pantryStart = (item) => larderLevelFor(item.model);
  const rackQueue = [...pantryItems].sort((a, b) => measure(a).h - measure(b).h);
  const onRack = new Set(rackQueue.filter((item) => placeInRack(item)));
  const sortedPantry = pantryItems.filter((i) => !onRack.has(i)).sort((a, b) => pantryStart(a) - pantryStart(b));
  layAll(sortedPantry, pantryLanes, pantryStart);

  // Somewhere for an item added from the panel, by the same rules: door
  // things to the door, produce to the crisper, the rest to a shelf. A spot
  // in a front row beats any back row, so the new arrival is seen landing;
  // in the pantry, nearer the level its weight says beats further.
  function shelve(item) {
    const fits = (ln) => fitsLane(item, ln);
    const front = (ln) => ln.row === 0 && fits(ln);
    const pick = (lanes) => lanes.find(front) ?? lanes.find(fits);
    if (item.place === "fridge") {
      if (DOOR_MODELS.has(item.model)) {
        const h = placeInDoor(item);
        if (h) return h;
      }
      // produce goes in the crisper while it has room in either row (its
      // frosted front hides both alike); the rest to the emptiest shelf
      if (crisperModel(item) && fits(crisperLane)) return place(item, crisperLane);
      const ln = pick([...shelfLanes].sort((a, b) => a.x - b.x));
      return ln ? place(item, ln) : null;
    }
    const rack = placeInRack(item);
    if (rack) return rack;
    const want = pantryStart(item);
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
  // the larder is the fridge's size and opens the same way, so it's framed
  // the same; the slide between them is a straight track along the kitchen
  const VIEWS = {
    fridge: { pos: new THREE.Vector3(0.1, 2.05, 7.9), look: new THREE.Vector3(0.0, 1.55, -0.35) },
    pantry: { pos: new THREE.Vector3(PX + 0.1, 2.05, 7.9), look: new THREE.Vector3(PX, 1.55, -0.35) },
  };
  let view = location.hash === "#pantry" ? "pantry" : "fridge";
  // whether the larder's items have landed yet (they do the first time it opens)
  let larderStocked = view === "pantry";
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
    larderTarget = next === "pantry" ? 1 : 0;
    travel = { from: camPos.clone(), to: VIEWS[next].pos.clone(), fromLook: camLook.clone(), toLook: VIEWS[next].look.clone(), t: 0 };
    // the first time the larder opens, its jars land on their shelves as the
    // doors swing back (like the fridge's on arrival); adding an item skips
    // that, so the new arrival is the only thing that drops in
    if (next === "pantry" && !larderStocked) {
      larderStocked = true;
      const now = clock.elapsedTime;
      for (const h of pickables) if (h.userData.item.place === "pantry") h.userData.landAt = keep ? -9 : now + 1.25 + h.userData.delay * 0.6;
    }
    root.dataset.view = next;
    root.querySelector("[data-kx-title]").textContent = next === "fridge" ? t("Fridge") : t("Pantry");
    buildBrowse();
    history.replaceState(null, "", next === "pantry" ? "#pantry" : location.pathname + location.search);
    // an open item would be left behind; the add form comes along
    if (!keep && !adding()) closePanel();
  }
  root.querySelectorAll("[data-kx-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.kxGo)));
  root.dataset.view = view;
  root.querySelector("[data-kx-title]").textContent = view === "fridge" ? t("Fridge") : t("Pantry");
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
  // Picking tests an item's real meshes first, so what you can see is what
  // you get: a carrot showing beside a milk carton is the carrot, not the
  // carton's padded box. An item the ray only grazes (its padded box, or
  // hidden behind another) comes after, and clicking the same spot again
  // steps through them. The keyboard list below reaches every item too.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-9, -9);
  let hovered = null;
  let selected = null;
  let pinned = false; // a click or tap keeps the panel; hover alone only peeks
  let lastPoint = null;
  // how far the fridge and larder doors have swung (0 shut, 1 open): items
  // behind a shut door can't be reached, so the pointer never lights up
  // something it can't see
  let doorSwing = 0;
  let larderSwing = 0;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const wideScreen = window.matchMedia("(min-width: 901px)");

  function holderOf(obj) {
    while (obj && !pickables.includes(obj)) obj = obj.parent;
    return obj ?? null;
  }
  // every item under the pointer, best first
  function stackAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const mine = pickables.filter((p) => (p.userData.item.place === "pantry" ? larderSwing : doorSwing) > 0.3);
    const exact = new Map();
    for (const h of raycaster.intersectObjects(mine.flatMap((p) => p.userData.meshes), false)) {
      const id = h.object.userData.itemId;
      if (!exact.has(id)) exact.set(id, h.distance);
    }
    const hits = [];
    for (const h of raycaster.intersectObjects(mine.map((p) => p.userData.hit), false)) {
      const holder = holderOf(h.object);
      hits.push({ id: holder.userData.item.id, exact: exact.get(holder.userData.item.id) ?? null, proxy: h.distance });
    }
    return orderStack(hits).map((id) => itemsById.get(id));
  }
  function pick(cx, cy) {
    const stack = stackAt(cx, cy);
    // A lifted item keeps the pointer while it's over the still box round
    // where it stood, so the hover doesn't flutter as it rises, and lifting
    // it doesn't hand the pointer to whatever it uncovered behind it. Only
    // something really in front of that box (nearer the eye) takes over.
    if (hovered && stack.includes(hovered)) {
      const box = raycaster.intersectObject(hovered.userData.hit, false)[0];
      const nearer = box && stack.some((h) => h !== hovered && exactHit(h) !== null && exactHit(h) < box.distance);
      if (box && !nearer) return hovered;
    }
    return stack[0] ?? null;
  }
  // how far along the current ray this item's own meshes are (null: missed)
  function exactHit(h) {
    return raycaster.intersectObjects(h.userData.meshes, false)[0]?.distance ?? null;
  }
  let peekTimer = 0;
  let leaveTimer = 0;
  function setHover(h) {
    if (h === hovered) return;
    hovered = h;
    canvas.style.cursor = h ? "pointer" : "";
    syncOutline();
    clearTimeout(peekTimer);
    if (!peekOk()) return;
    if (h) {
      clearTimeout(leaveTimer);
      // quick enough to feel immediate, slow enough that sweeping across
      // the shelf doesn't strobe the panel
      peekTimer = setTimeout(() => peek(h), panel.hidden || !panel.classList.contains("open") ? 110 : 60);
    } else {
      scheduleLeave();
    }
  }
  const peekOk = () => finePointer.matches && wideScreen.matches && !pinned && !adding();
  function scheduleLeave() {
    clearTimeout(leaveTimer);
    if (pinned) return;
    leaveTimer = setTimeout(() => {
      if (!pinned && !hovered && !panel.matches(":hover") && !panel.contains(document.activeElement)) closePanel();
    }, 380);
  }
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    parallaxT.set(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    if (e.pointerType === "touch") return;
    lastPoint = { x: e.clientX, y: e.clientY };
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (lastPoint) setHover(pick(lastPoint.x, lastPoint.y));
    });
  });
  let moveQueued = false;
  canvas.addEventListener("pointerleave", () => {
    lastPoint = null;
    parallaxT.set(0, 0);
    setHover(null);
  });
  // clicking the same spot again steps to the next item under it
  let lastClick = null;
  canvas.addEventListener("click", (e) => {
    const stack = stackAt(e.clientX, e.clientY);
    const again = lastClick && Math.hypot(lastClick.x - e.clientX, lastClick.y - e.clientY) < 8 && stack.includes(selected);
    lastClick = { x: e.clientX, y: e.clientY };
    // what's lifted and outlined under the pointer is what you meant, even
    // though lifting it uncovered whatever stands behind it
    const lifted = e.pointerType !== "touch" && hovered && pick(e.clientX, e.clientY) === hovered ? hovered : null;
    const h = again && stack.length > 1 ? stack[(stack.indexOf(selected) + 1) % stack.length] : (lifted ?? stack[0]);
    if (h) openPanel(h, true);
    else {
      lastClick = null;
      closePanel();
    }
  });
  // items just added stay outlined while they land, so the eye finds them
  const arrivals = new Set();
  function syncOutline() {
    outline.selectedObjects = [hovered, selected, focusRing, ...arrivals].filter(Boolean).map((h) => h.userData.mesh);
  }
  let focusRing = null;

  // The same items as real buttons, for keyboard and screen readers: tab in,
  // arrow between them, Enter keeps one open. They stay visually tucked away
  // until focused, so the scene is the interface for everyone else.
  const browse = document.createElement("div");
  browse.className = "kx-browse";
  browse.setAttribute("role", "group");
  browse.setAttribute("aria-label", t("Items in view. Press Enter to open one."));
  stage.append(browse);
  function buildBrowse() {
    browse.replaceChildren(
      ...pickables
        .filter((h) => (h.userData.item.place === "pantry") === (view === "pantry"))
        .map((h) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "kx-browse-item";
          b.dataset.id = String(h.userData.item.id);
          b.textContent = `${h.userData.item.name}, ${h.userData.item.qty}`;
          b.addEventListener("focus", () => {
            focusRing = h;
            syncOutline();
            if (!pinned) peek(h);
          });
          b.addEventListener("blur", () => {
            if (focusRing === h) focusRing = null;
            syncOutline();
          });
          b.addEventListener("click", () => openPanel(h, true));
          return b;
        }),
    );
  }
  browse.addEventListener("keydown", (e) => {
    const bs = [...browse.querySelectorAll("button")];
    const i = bs.indexOf(document.activeElement);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!next || i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    bs[(i + next + bs.length) % bs.length].focus();
  });

  /* ---------- side panel ---------- */
  const panel = root.querySelector("[data-kx-panel]");
  const panelBody = root.querySelector("[data-kx-panel-body]");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let shownId = null;
  function fillPanel(h) {
    const it = h.userData.item;
    if (shownId === it.id) return;
    shownId = it.id;
    const freshClass = { expired: "kx-pill-bad", soon: "kx-pill-warn", fresh: "kx-pill-good", kept: "", none: "" }[it.fresh] ?? "";
    // the grace day: ask, right here, whether it's still in the kitchen
    const grace = it.grace
      ? `<div class="kx-grace" role="group" aria-label="${esc(t("Do you still have {name}?", { name: it.name }))}">
          <p><strong>${esc(t("Do you still have this?"))}</strong> ${esc(t("It passed its date. Unless you keep it, it leaves your kitchen on {date}.", { date: it.grace.removes }))}</p>
          <div class="kx-grace-actions">
            <form method="post" action="/pantry/${it.id}/keep"><input type="hidden" name="return_to" value="/pantry" /><button class="button button-small" type="submit">${esc(t("I still have it"))}</button></form>
            <form method="post" action="/pantry/${it.id}/gone"><input type="hidden" name="return_to" value="/pantry" /><button class="button button-small button-ghost" type="submit">${esc(t("It's gone"))}</button></form>
          </div>
        </div>`
      : "";
    panelBody.innerHTML = `
      <p class="kx-panel-kind">${esc(it.place === "fridge" ? t("In the fridge") : t("In the pantry"))}</p>
      <h2>${esc(it.name)}</h2>
      <p class="kx-panel-qty">${esc(it.qty)}${it.price ? ` · ${esc(t("paid {price}", { price: it.price }))}` : ""}</p>
      <div class="kx-expiry ${freshClass}">
        <span class="kx-expiry-label">${esc(it.fresh === "none" ? t("No expiry date") : it.fresh === "expired" || it.fresh === "kept" ? t("Expired") : t("Use by"))}</span>
        <strong>${esc(it.expiry ?? "—")}</strong>
        <span class="kx-expiry-note">${esc(it.freshLabel)}</span>
      </div>
      ${grace}
      <h3>${esc(t("Planned for"))}</h3>
      ${it.uses.length
        ? `<ul class="kx-uses">${it.uses
            .map((u) => `<li><a href="/recipes/${u.recipe_id}"><span class="kx-use-day">${esc(u.day)}</span><span class="kx-use-meal">${esc(u.meal)}</span><strong>${esc(u.title)}</strong></a></li>`)
            .join("")}</ul>`
        : `<p class="kx-empty">${esc(t("Not in any planned meal yet."))} <a href="/recipes?q=${encodeURIComponent(it.name)}">${esc(t("Find a recipe that uses it →"))}</a></p>`}
      <div class="kx-panel-actions">
        <a class="button button-soft button-small" href="/pantry?edit=${it.id}#item-${it.id}">${esc(t("Edit"))}</a>
        <a class="button button-ghost button-small" href="/calendar">${esc(t("Open calendar"))}</a>
      </div>`;
    panelBody.classList.remove("swap");
    void panelBody.offsetWidth;
    panelBody.classList.add("swap");
  }
  // A click or tap keeps the panel (and slides the scene aside for it); hover
  // only peeks, in a card on the empty left that never moves the scene, so
  // nothing shifts under the pointer.
  function openPanel(h, keep) {
    clearTimeout(peekTimer);
    clearTimeout(leaveTimer);
    pinned = keep;
    selected = keep ? h : null;
    syncOutline();
    fillPanel(h);
    showPanel(false, keep);
  }
  function peek(h) {
    if (!peekOk() || h !== hovered && h !== focusRing) return;
    openPanel(h, false);
  }
  // the panel holds either an item's details or the add form; reopening
  // within the close transition cancels the pending hide
  let panelSeq = 0;
  function showPanel(adding, keep = true) {
    panelSeq++;
    panelBody.hidden = adding;
    addForm.hidden = !adding;
    panel.classList.toggle("adding", adding);
    panel.classList.toggle("peek", !keep && !adding);
    panel.hidden = false;
    if (keep || adding) shiftTarget = 0.13;
    requestAnimationFrame(() => panel.classList.add("open"));
    root.classList.toggle("panel-open", keep || adding);
    root.classList.toggle("peek-open", !keep && !adding);
  }
  function closePanel() {
    clearTimeout(peekTimer);
    clearTimeout(leaveTimer);
    if (!selected && panel.hidden && !pinned) return;
    const wasAdding = addForm.contains(document.activeElement);
    selected = null;
    pinned = false;
    shownId = null;
    syncOutline();
    shiftTarget = -0.16;
    panel.classList.remove("open");
    root.classList.remove("panel-open", "peek-open");
    const seq = panelSeq;
    setTimeout(() => {
      if (seq === panelSeq) panel.hidden = true;
    }, 320);
    if (wasAdding) addButton.focus({ preventScroll: true });
  }
  root.querySelector("[data-kx-close]")?.addEventListener("click", closePanel);
  // moving from an item onto its panel keeps it open; leaving both closes it
  panel.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
  panel.addEventListener("pointerleave", () => {
    if (!pinned) scheduleLeave();
  });
  panel.addEventListener("focusout", () => {
    if (!pinned) scheduleLeave();
  });

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

  // where an item landed, said whole so each language can order it its own
  // way; the lane names are the English keys ("on the top shelf")
  const PLACED = {
    "in the fridge door": "Added {name} in the fridge door.",
    "in the crisper": "Added {name} in the crisper.",
    "on the bottom shelf": "Added {name} on the bottom shelf.",
    "on the middle shelf": "Added {name} on the middle shelf.",
    "on the top shelf": "Added {name} on the top shelf.",
    "in a pantry door rack": "Added {name} in a pantry door rack.",
    "on the pantry floor": "Added {name} on the pantry floor.",
    "on the cold slate shelf": "Added {name} on the cold slate shelf.",
    "on the bottom pantry shelf": "Added {name} on the bottom pantry shelf.",
    "on the middle pantry shelf": "Added {name} on the middle pantry shelf.",
    "on the top pantry shelf": "Added {name} on the top pantry shelf.",
  };
  const where = (h) => h.userData.lane?.name ?? "in the fridge door";

  function arrive(item) {
    const h = shelve(item);
    if (!h) {
      say(t("Added {name}. The shelves are full, so it's in the list below.", { name: item.name }));
      return;
    }
    const away = item.place !== view;
    if (away) go(item.place, true);
    else buildBrowse();
    // arriving at the fridge or the larder, wait for its doors to swing most
    // of the way
    h.userData.landAt = clock.elapsedTime + (!away ? 0.15 : item.place === "fridge" ? 1.45 : 1.75);
    arrivals.add(h);
    syncOutline();
    setTimeout(() => {
      arrivals.delete(h);
      syncOutline();
    }, away ? 3400 : 2600);
    const spot = where(h);
    say(PLACED[spot] ? t(PLACED[spot], { name: item.name }) : `Added ${item.name} ${spot}.`);
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
    VIEWS.pantry.pos.z = VIEWS.fridge.pos.z;
    if (!travel) camPos.z = VIEWS[view].pos.z;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---------- loop ---------- */
  buildBrowse();
  root.dataset.placed = String(pickables.length);
  // where each item is on screen, for the browser spec (specs read it, nothing else does)
  window.__kitchen = {
    screenOf(id) {
      const h = itemsById.get(id);
      if (!h) return null;
      camera.updateMatrixWorld();
      const p = new THREE.Box3().setFromObject(h.userData.mesh).getCenter(new THREE.Vector3()).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    stackAt: (x, y) => stackAt(x, y).map((h) => h.userData.item.name),
    bounds(id) {
      const h = itemsById.get(id);
      const b = new THREE.Box3().setFromObject(h.userData.mesh);
      const pw = new THREE.Vector3();
      h.parent.getWorldPosition(pw);
      return { min: b.min.toArray(), max: b.max.toArray(), lane: h.userData.lane?.name ?? "door" };
    },
    ids: () => pickables.map((h) => h.userData.item.id),
    doors: () => doorSwing,
    larderDoors: () => larderSwing,
    // How much of an item you can see: of the points on screen where the
    // camera would see it, the share where nothing else is in front (glass,
    // film and the clear crisper front don't count; you see through them).
    seen(id) {
      const h = itemsById.get(id);
      if (!h) return null;
      camera.updateMatrixWorld();
      const box = new THREE.Box3().setFromObject(h.userData.mesh);
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera));
      const [x0, x1] = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x))];
      const [y0, y1] = [Math.min(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.y))];
      const opaque = (o) => o.isMesh && o.visible && o.material.visible !== false && !(o.material.transparent && o.material.opacity < 0.6);
      const solids = [];
      scene.traverse((o) => opaque(o) && solids.push(o));
      let mine = 0;
      let shown = 0;
      const N = 14;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          pointer.set(x0 + ((x1 - x0) * (i + 0.5)) / N, y0 + ((y1 - y0) * (j + 0.5)) / N);
          raycaster.setFromCamera(pointer, camera);
          if (!raycaster.intersectObjects(h.userData.meshes.filter(opaque), false).length) continue;
          mine++;
          const first = raycaster.intersectObjects(solids, false)[0];
          if (first && h.userData.meshes.includes(first.object)) shown++;
        }
      }
      return mine ? shown / mine : 0;
    },
  };
  const clock = new THREE.Clock();
  // the doors swing open as the page arrives (items then pop onto shelves),
  // close behind you as you slide over to the pantry, and open again when
  // you come back. Starting on the pantry, they stay shut until you visit.
  let openTarget = view === "fridge" ? 1 : 0;
  let opening = reduce ? openTarget : 0;
  // the larder's doors the same way: open on arrival, shut when you leave
  let larderTarget = view === "pantry" ? 1 : 0;
  let larderOpening = reduce ? larderTarget : 0;
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
    doorSwing = swing;
    // each door turns outward about its hinge: left door anticlockwise seen
    // from above (negative y), right door clockwise
    for (const d of doors) d.hinge.rotation.y = d.side * swing * openAngle;
    // the larder's doors: they start to open as the camera nears (so you
    // arrive to them swinging back, not to a shut cupboard) and shut a beat
    // after it leaves, on the same soft-close curve
    const nearLarder = !travel || view !== "pantry" || travel.t > 0.4;
    if (reduce) larderOpening = larderTarget;
    else if (larderOpening < larderTarget && nearLarder) larderOpening = Math.min(larderTarget, larderOpening + dt / 1.5);
    else if (larderOpening > larderTarget && (!travel || travel.t > 0.12)) larderOpening = Math.max(larderTarget, larderOpening - dt / 0.85);
    const lswing = easeInOut(Math.max(0, (larderOpening - 0.06) / 0.94));
    larderSwing = lswing;
    for (const d of larderDoors) d.hinge.rotation.y = d.side * lswing * openAngle;

    // fridge light: fades up as the doors open; brighter at night
    lightLevel += (lightTarget - lightLevel) * Math.min(1, dt * 3);
    const lit = lightLevel * swing;
    bulb.intensity = lit * 6.5;
    liner.emissiveIntensity = lit * (dark ? 0.32 : 0.06);
    glowSpot.intensity = lit * (dark ? 22 : 4);
    strip.material.color.setScalar(0.75 + lit * 0.25).multiply(new THREE.Color(0xfff6e4));
    // the larder's bulb, the same way: on as its doors open, warmer at night
    const llit = lightLevel * lswing;
    larderBulb.intensity = llit * 5;
    larderGlow.intensity = llit * (dark ? 16 : 2.5);
    for (const m of boardMats) m.emissiveIntensity = llit * (dark ? 0.2 : 0.03);
    lampMat.color.setScalar(0.62 + llit * 0.38).multiply(new THREE.Color(0xffe2b0));

    // camera travel between fridge and larder, eased, with a soft arc: it
    // steps back a little mid-slide, like walking across the kitchen, so the
    // sideboard between them passes by and both doors stay in frame
    if (travel) {
      travel.t = Math.min(1, travel.t + dt / (reduce ? 0.01 : 1.5));
      const k = easeInOut(travel.t);
      camPos.lerpVectors(travel.from, travel.to, k);
      camPos.z += Math.sin(k * Math.PI) * 1.1;
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
      if (u.landAt === null) u.landAt = (u.item.place === "pantry" ? 0.75 : 0.55) + u.delay;
      const land = reduce ? null : landing(t - u.landAt, u);
      u.entered = land ? land.entered : 1;
      u.hover += ((h === hovered ? 1 : 0) - u.hover) * Math.min(1, dt * 10);
      u.sel += ((h === selected ? 1 : 0) - u.sel) * Math.min(1, dt * 8);
      const lift = Math.max(u.hover, u.sel);
      // rising and growing on hover stop short of the shelf above (liftMax and
      // grow were worked out from the headroom when the item was placed)
      // (the holder is scaled by `fit`, so heights worked out in shelf units
      // are divided by it to be set on the mesh inside)
      const rise = (lift * u.liftMax) / u.fit;
      const bob = reduce ? 0 : (Math.sin(t * 2.4 + u.item.id) * Math.min(0.012, u.liftMax * 0.3) * lift) / u.fit;
      const drop = land ? dropFor(land.drop, u.tall, u.free) / u.fit : 0;
      u.mesh.position.y = rise + bob + drop;
      if (u.dot) u.dot.position.y = u.dotY + rise + drop;
      const s = u.fit * (land ? land.scale : 1) * (1 + lift * u.grow);
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

    // the scene moving under a still pointer (doors swinging, the panel
    // nudging the camera) changes what's beneath it: look again
    if (lastPoint && (travel || Math.abs(shiftTarget - shift) > 0.002 || (opening > 0 && opening < 1) || (larderOpening > 0 && larderOpening < 1))) {
      setHover(pick(lastPoint.x, lastPoint.y));
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

// Blue-grey slate for the larder's cold shelf: a cool wash with faint
// cleavage streaks, so it reads as stone against the pine.
function slateTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#5d6670";
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 128;
    const l = 70 + Math.random() * 40;
    g.strokeStyle = `rgba(${l + 10}, ${l + 18}, ${l + 28}, ${0.06 + Math.random() * 0.1})`;
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + Math.random() * 6 - 3, 340, y + Math.random() * 6 - 3, 512, y + Math.random() * 4 - 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Tongue-and-groove boards for the inside of the larder, upright, in a pale
// limewash `tone`; `repeat.x` on a clone sets how many boards show.
function boardTexture(tone) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = tone;
  g.fillRect(0, 0, 512, 256);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = (i * 512) / n;
    g.fillStyle = `rgba(255, 255, 255, ${0.05 + (i % 3) * 0.03})`;
    g.fillRect(x + 4, 0, 512 / n - 8, 256);
    for (let k = 0; k < 6; k++) {
      g.strokeStyle = `rgba(120, 110, 90, ${0.03 + Math.random() * 0.04})`;
      g.lineWidth = 1;
      g.beginPath();
      const xx = x + 8 + Math.random() * (512 / n - 16);
      g.moveTo(xx, 0);
      g.bezierCurveTo(xx + 3, 90, xx - 3, 170, xx + 1, 256);
      g.stroke();
    }
    // the groove between boards: a shadow line with a highlight beside it
    g.fillStyle = "rgba(80, 74, 62, 0.35)";
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = "rgba(255, 255, 255, 0.35)";
    g.fillRect(x + 3, 0, 1.5, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// The pierced zinc of a larder door's vent: a grid of small holes punched in
// a pattern of diamonds, dark where they let the dark inside show through.
function zincTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#b9bcb8";
  g.fillRect(0, 0, 256, 256);
  const step = 16;
  for (let y = step / 2; y < 256; y += step) {
    for (let x = step / 2; x < 256; x += step) {
      const cx = (x / step) % 4, cy = (y / step) % 4;
      const big = Math.abs(cx - 1.5) + Math.abs(cy - 1.5) < 1.6;
      g.fillStyle = "#3a3a36";
      g.beginPath();
      g.arc(x, y, big ? 3.4 : 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.35)";
      g.beginPath();
      g.arc(x + 0.8, y + (big ? 3.6 : 2.3), big ? 1.6 : 1, 0, Math.PI);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.2, 1.8);
  t.anisotropy = 4;
  return t;
}

// Scalloped shelf paper pinned along the front of each larder shelf: a
// cream strip with a printed sprig line, its lower edge cut in scallops
// (transparent between them), for a shelf `width` wide.
function edgingTexture(width) {
  const scallops = Math.round(width / 0.06);
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 64;
  const g = c.getContext("2d");
  const sw = 1024 / scallops;
  g.fillStyle = "#f7efdd";
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(1024, 0);
  g.lineTo(1024, 34);
  for (let i = scallops; i > 0; i--) g.arc((i - 0.5) * sw, 34, sw / 2, 0, Math.PI, false);
  g.closePath();
  g.fill();
  // a red rule and a row of small printed dots, like old larder paper
  g.fillStyle = "#b8483e";
  g.fillRect(0, 8, 1024, 3);
  for (let i = 0; i < scallops; i++) {
    g.beginPath();
    g.arc((i + 0.5) * sw, 30, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
