// A short looping 3D guide at the top of each scan page, in the same room
// and materials as the fridge and larder (public/kitchen.mjs). Seen over
// your shoulder: your hand brings a phone up, its screen shows what its
// camera sees, your thumb taps the shutter, a soft flash and a tick, the
// phone comes down a little, and after a pause it begins again. One scene
// per way to scan:
//
//   fridge   the open fridge, framed whole from a couple of metres back
//   receipt  a receipt flat on the bench, the phone held level above it
//   barcode  your other hand turns a cereal box round to its barcode
//
// The phone's screen is a live view, not a picture: the scene is rendered a
// second time from the phone's own camera (a portrait 3:4 frame, 53° across,
// like a phone's main camera) into a texture on the screen, so it shows
// exactly what the phone is pointed at and moves with your hand.
//
// The phone is posed relative to your eye (where on the picture, how far
// away), its camera aimed at what you're photographing; your arm runs from
// a shoulder just below and to the right of your eye to the hand, through a
// bending elbow (a two-bone reach), so it always comes up from the bottom
// edge and never floats.
//
// Sizes are real: a 72 x 147 mm phone, an 80 mm receipt, a fridge 1.9 m
// tall, a barcode 56 x 39 mm (150%, which GS1 allows) on the lower right of
// the box's back.
//
// It's a picture of what to do, not a control: the canvas is aria-hidden,
// the caption under it says the same in words, and the page's form works
// the same without it. It plays only while on screen, can be paused, holds
// a single frame (the moment of the photo) for reduced motion, and isn't
// drawn at all without WebGL.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildModel } from "./kitchen-models.mjs";

const root = document.querySelector("[data-scan-guide]");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// (once the module's helpers below are defined)
queueMicrotask(() => {
  if (root && webgl()) start(root.dataset.scanGuide);
  else root?.classList.add("no-3d");
});

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

/* ---------------- timing ---------------- */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoother = (x) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// 0 before a, easing up to 1 at b
const span = (t, a, b) => smoother((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Every scene keeps one calm rhythm, a little under nine seconds: rest,
// bring the phone up, line it up, hold, tap, flash, tick, lower, rest. The
// first and last moments match, and the rest either side of the action is
// what keeps the loop from feeling busy.
const LOOP = 8.8;
const BEAT = {
  raise: [0.08, 0.3],
  frame: [0.3, 0.44], // a small adjustment as you line it up
  tap: 0.52, // the thumb meets the shutter
  flash: [0.515, 0.6],
  tick: [0.56, 0.78],
  lower: [0.8, 0.95],
};
// for reduced motion: the photo just taken, tick showing
const STILL = 0.6;
// how far up the phone is at moment t (0 resting, 1 held up)
const raised = (t, lag = 0) => span(t, BEAT.raise[0] + lag, BEAT.raise[1] + lag) * (1 - span(t, BEAT.lower[0], BEAT.lower[1]));
// the little sway as you line the shot up
const nudge = (t, lag = 0) => Math.sin(span(t, BEAT.frame[0] + lag, BEAT.frame[1] + lag) * Math.PI);

/* ---------------- materials and parts ---------------- */

const mat = (hex, opts = {}) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: 0.5, clearcoat: 0.2, ...opts });
const matte = (hex, opts = {}) => mat(hex, { roughness: 0.9, clearcoat: 0, ...opts });
const SKIN = () => mat("#e2b296", { roughness: 0.62, clearcoat: 0.12, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color("#f7d6c2") });
const SLEEVE = () => matte("#62808c", { roughness: 0.92 });

function part(parent, w, h, d, x, y, z, m, r = 0.01) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const UP = V(0, 1, 0);
// a capsule from a to b (built once, fixed)
function capsule(parent, a, b, r, m) {
  const len = Math.max(0.0001, a.distanceTo(b));
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m);
  c.position.copy(a).add(b).multiplyScalar(0.5);
  c.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  c.castShadow = true;
  parent.add(c);
  return c;
}
function ball(parent, p, r, m, scale) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
  s.position.copy(p);
  if (scale) s.scale.set(...scale);
  s.castShadow = true;
  parent.add(s);
  return s;
}
// a tapering tube moved every frame: a unit cylinder stretched between points
function bone(scene, r0, r1, m) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 20, 1, true), m);
  c.castShadow = true;
  scene.add(c);
  return {
    mesh: c,
    set(a, b) {
      c.position.copy(a).add(b).multiplyScalar(0.5);
      c.scale.set(1, Math.max(0.0001, a.distanceTo(b)), 1);
      c.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    },
  };
}

/* ---------------- an arm ---------------- */

// Shoulder to wrist through an elbow placed by the two-bone rule: the bones
// keep their lengths and the elbow bends towards `hint` (down and out). A
// sleeve to just short of the wrist, then a little bare wrist into the hand.
// The shoulder can move (it's placed from your eye each frame).
function arm(scene, skinMat, sleeveMat) {
  const L1 = 0.31, L2 = 0.27;
  const upper = bone(scene, 0.052, 0.044, sleeveMat);
  const fore = bone(scene, 0.044, 0.036, sleeveMat);
  const wrist = bone(scene, 0.027, 0.024, skinMat);
  const elbowBall = ball(scene, V(0, 0, 0), 0.046, sleeveMat);
  const shoulderBall = ball(scene, V(0, 0, 0), 0.056, sleeveMat);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 8, 28), sleeveMat);
  scene.add(cuff);
  return {
    reach(shoulder, w, hint) {
      shoulderBall.position.copy(shoulder);
      const d = w.clone().sub(shoulder);
      const dist = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.004);
      const dir = d.clone().normalize();
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const side = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
      const elbow = shoulder.clone().add(dir.clone().multiplyScalar(a)).add(side.multiplyScalar(h));
      // the hand itself, where the arm can't quite reach, is where it is
      const end = w.clone();
      const sleeveEnd = elbow.clone().lerp(end, 0.78);
      upper.set(shoulder, elbow);
      fore.set(elbow, sleeveEnd);
      wrist.set(sleeveEnd, end);
      elbowBall.position.copy(elbow);
      cuff.position.copy(sleeveEnd);
      cuff.quaternion.setFromUnitVectors(V(0, 0, 1), end.clone().sub(elbow).normalize());
      return elbow;
    },
  };
}

/* ---------------- the stage ---------------- */

function start(kind) {
  const canvas = root.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

  // the room: the kitchen's warm wall, floorboards and skirting
  const wallMat = matte("#f1e8dc", { roughness: 0.95 });
  const floorMat = matte("#dccdb9", { roughness: 0.75, map: floorTexture() });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat);
  wall.position.set(0, 4, -0.62);
  wall.receiveShadow = true;
  scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 5);
  floor.receiveShadow = true;
  scene.add(floor);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.04), matte("#fbf8f3", { roughness: 0.6 }));
  skirting.position.set(0, 0.06, -0.6);
  scene.add(skirting);

  const hemi = new THREE.HemisphereLight(0xfff8ef, 0xe8e0d4, 0.8);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1e0, 2.3);
  key.position.set(-3, 6, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3.5, bottom: -1, near: 1, far: 16 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.5);
  fill.position.set(5, 3, 4);
  scene.add(fill);

  // the viewer: your eye
  const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 40);

  /* ---------- the phone ---------- */
  // 72 x 147 x 8 mm in a soft sage case to match the fridge. The screen is
  // dark, with the camera's 3:4 picture across its upper part and the
  // shutter below it, as a phone's camera app looks held upright.
  const PW = 0.072, PH = 0.147, PD = 0.008;
  const phone = new THREE.Group();
  scene.add(phone);
  part(phone, PW, PH, PD, 0, 0, 0, mat("#9cc1aa", { roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.25 }), 0.009);
  // the camera bump: top left seen from the back, so behind the screen's top right
  const bumpX = PW / 2 - 0.019, bumpY = PH / 2 - 0.019;
  part(phone, 0.028, 0.028, 0.003, bumpX, bumpY, -PD / 2 - 0.0012, mat("#8db39b", { roughness: 0.3, clearcoat: 1 }), 0.007);
  for (const [dx, dy] of [[-0.0055, 0.0055], [0.0055, -0.0055]]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 24), mat("#151817", { roughness: 0.12, clearcoat: 1 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(bumpX + dx, bumpY + dy, -PD / 2 - 0.003);
    phone.add(lens);
  }
  const SW = PW - 0.005, SH = PH - 0.005;
  const FACE = PD / 2 + 0.0003;
  const glassFace = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ color: 0x0c0e0d }));
  glassFace.position.z = FACE;
  phone.add(glassFace);
  // the preview: 3:4, from just under the top bar
  const VW = SW, VH = (SW * 4) / 3;
  const VY = SH / 2 - 0.013 - VH / 2;
  // (three draws into a target in linear light, untoned; the screen tones it
  // like the rest of the picture, so the two match)
  const viewTarget = new THREE.WebGLRenderTarget(420, 560, { samples: 4, type: THREE.HalfFloatType });
  const preview = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ map: viewTarget.texture }));
  preview.position.set(0, VY, FACE + 0.0002);
  phone.add(preview);
  const corners = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ map: cornersTexture(), transparent: true, toneMapped: false, depthWrite: false }));
  corners.position.set(0, VY, FACE + 0.0004);
  phone.add(corners);
  // the shutter, centred in the dark band below: a ring and a white button
  const SHUTTER = V(0, (-SH / 2 + (VY - VH / 2)) / 2, FACE + 0.0005);
  const shutter = new THREE.Mesh(new THREE.CircleGeometry(0.0058, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  shutter.position.copy(SHUTTER);
  phone.add(shutter);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0069, 0.0078, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  ring.position.copy(SHUTTER);
  phone.add(ring);
  // the flash over the picture, then the tick
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), flashMat);
  flash.position.set(0, VY, FACE + 0.0006);
  phone.add(flash);
  const tickMat = new THREE.MeshBasicMaterial({ map: tickTexture(), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.026), tickMat);
  tick.position.set(0, VY, FACE + 0.0008);
  phone.add(tick);
  // the phone's camera looks out of its back (a camera looks down its own
  // -z): 67° tall by 53° across
  const phoneCam = new THREE.PerspectiveCamera(67, 3 / 4, 0.03, 30);
  phoneCam.position.set(bumpX, bumpY, -PD / 2 - 0.003);
  phone.add(phoneCam);

  /* ---------- your hand and arm ---------- */
  const skinMat = SKIN();
  const sleeveMat = SLEEVE();
  const hand = buildHand(phone, skinMat, { PW, PH, PD, SHUTTER });
  const rightArm = arm(scene, skinMat, sleeveMat);
  const set = (SCENES[kind] ?? SCENES.fridge)(scene, { skinMat, sleeveMat });

  /* ---------- theme ---------- */
  function applyTheme(d) {
    wallMat.color.set(d ? "#2a2420" : "#f3eee7");
    floorMat.color.set(d ? "#3a322c" : "#e9e1d6");
    skirting.material.color.set(d ? "#332c27" : "#fbf8f3");
    hemi.intensity = d ? 0.3 : 0.62;
    hemi.color.set(d ? 0x8a7f74 : 0xfff8ef);
    key.intensity = d ? 0.6 : 2.3;
    key.color.set(d ? 0xb4c2dc : 0xfff1e0);
    fill.intensity = d ? 0.15 : 0.5;
    scene.environmentIntensity = d ? 0.32 : 0.7;
    renderer.toneMappingExposure = d ? 1.12 : 0.95;
    set.theme?.(d);
    if (!running) draw(shown);
  }

  /* ---------- size ---------- */
  let narrow = false;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // the stage is 16:7 on wide screens and 4:3 on narrow ones
    narrow = w / h < 1.6;
    camera.fov = narrow ? 52 : 40;
    camera.updateProjectionMatrix();
    if (!running) draw(shown);
  }

  /* ---------- drawing one moment ---------- */
  // A point on the picture, `d` metres in front of your eye: (sx, sy) run
  // -1..1 across and up the picture.
  const tmp = new THREE.Vector3();
  function inView(sx, sy, d) {
    tmp.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    return camera.position.clone().add(tmp.multiplyScalar(d / tmp.dot(fwd)));
  }
  let shown = (reduce ? STILL : 0) * LOOP;
  const shoulder = V(0, 0, 0), wristAt = V(0, 0, 0), elbowAt = V(0, 0, 0);
  function draw(seconds) {
    shown = seconds;
    const t = (((seconds % LOOP) + LOOP) % LOOP) / LOOP;
    const eye = set.eye(t, narrow);
    camera.position.copy(eye.pos);
    camera.lookAt(eye.look);
    camera.updateMatrixWorld(true);
    // your shoulders: level, a little ahead of the view and below it, out
    // of the picture (side 1 your right, -1 your left)
    const right = V(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const ahead = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const body = set.body ?? { side: 0.18, ahead: 0.1, down: 0.26 };
    const shoulderAt = (side) => camera.position.clone().addScaledVector(right, side * body.side).addScaledVector(ahead, body.ahead).add(V(0, -body.down, 0));
    set.update(t, { shoulderAt, right, ahead });
    // the phone: where it sits on the picture, aimed at its subject
    const p = set.phone(t, narrow);
    // at rest it sits low on the picture; held up, a scene may name the
    // exact spot (above the receipt, in front of the barcode)
    const restPos = inView(p.sx, p.sy, p.d);
    phone.position.copy(p.at ? restPos.lerp(p.at, p.mix) : restPos);
    const up = camera.up.clone().applyQuaternion(camera.quaternion);
    phone.up.copy(p.up ?? up);
    // the screen (+z) faces away from what it's aimed at
    phone.lookAt(phone.position.clone().multiplyScalar(2).sub(p.aim));
    phone.rotateZ(p.roll ?? 0);
    // the camera, not the middle of the phone, is what's on that spot, so
    // what it's aimed at is in the middle of its picture
    phone.position.sub(V(bumpX, bumpY, 0).applyQuaternion(phone.quaternion));
    phone.updateMatrixWorld(true);
    hand.press(1 - clamp01(Math.abs(t - BEAT.tap) / 0.055));
    shoulder.copy(shoulderAt(1));
    wristAt.copy(phone.localToWorld(hand.wrist.clone()));
    elbowAt.copy(rightArm.reach(shoulder, wristAt, set.elbow ?? V(0.7, -1, 0.1)));
    // flash and tick on the screen
    const f = (t - BEAT.flash[0]) / (BEAT.flash[1] - BEAT.flash[0]);
    flashMat.opacity = f > 0 && f < 1 ? Math.sin(f * Math.PI) ** 1.5 * 0.9 : 0;
    const k = span(t, BEAT.tick[0], BEAT.tick[0] + 0.04) * (1 - span(t, BEAT.tick[1] - 0.05, BEAT.tick[1]));
    tickMat.opacity = k;
    tick.scale.setScalar(0.75 + 0.25 * k);
    shutter.scale.setScalar(1 - 0.16 * clamp01(1 - Math.abs(t - BEAT.tap) / 0.02));
    // what the phone sees (without itself; your arm is behind it)
    phone.visible = false;
    renderer.setRenderTarget(viewTarget);
    renderer.render(scene, phoneCam);
    renderer.setRenderTarget(null);
    phone.visible = true;
    renderer.render(scene, camera);
  }

  /* ---------- playing ---------- */
  let running = false;
  let onScreen = false;
  let paused = reduce;
  let raf = 0;
  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    draw(shown + dt);
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (paused || running || !onScreen || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
  }
  const toggle = root.querySelector("[data-scan-guide-toggle]");
  function setPaused(p) {
    paused = p;
    root.classList.toggle("paused", p);
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(p));
      toggle.setAttribute("aria-label", p ? "Play the animation" : "Pause the animation");
    }
    p ? stop() : play();
  }
  toggle?.addEventListener("click", () => setPaused(!paused));
  if (toggle && reduce) toggle.hidden = true;
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    onScreen ? play() : stop();
  }).observe(root);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : play()));
  window.addEventListener("larder:theme", (e) => applyTheme(e.detail.dark));
  new ResizeObserver(resize).observe(canvas);
  applyTheme(isDark());
  resize();
  setPaused(paused);
  root.classList.add("ready");
  // for the browser checks: hold a moment of the loop (0..1), or carry on
  window.__scanGuide = {
    at(t) {
      setPaused(true);
      draw(t * LOOP);
    },
    play: () => setPaused(false),
    loop: LOOP,
    beats: BEAT,
    // where the arm and phone are at moment t, for the clipping checks
    pose(t) {
      setPaused(true);
      draw(t * LOOP);
      const corners = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(phone.localToWorld(V((x * PW) / 2, (y * PH) / 2, (z * PD) / 2)).toArray());
      return { shoulder: shoulder.toArray(), elbow: elbowAt.toArray(), wrist: wristAt.toArray(), phone: corners, extra: set.pose?.() ?? null };
    },
    // the same moment, seen from close to the phone, to check the hand
    inspect(t, dx = 0.05, dy = 0.03, dz = 0.28) {
      setPaused(true);
      draw(t * LOOP);
      const c = phone.localToWorld(V(dx, dy, dz));
      camera.position.copy(c);
      camera.up.copy(V(0, 1, 0).transformDirection(phone.matrixWorld));
      camera.lookAt(phone.localToWorld(V(0, -0.02, 0)));
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    },
    // the same moment from anywhere ([x, y, z] in metres)
    view(t, from, to) {
      setPaused(true);
      draw(t * LOOP);
      camera.position.set(...from);
      camera.up.set(0, 1, 0);
      camera.lookAt(...to);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    },
  };
}

/* ---------------- the hand on the phone ---------------- */

// Your right hand, seen from behind the phone: the phone lies across the
// palm, the four fingers curl round its left edge (their tips showing
// there), the heel of the hand and the ball of the thumb show at its lower
// right, and the thumb lies over the screen, coming down onto the shutter.
// Coordinates are the phone's own: screen +z, top +y, its right +x.
function buildHand(phone, skinMat, { PW, PH, PD, SHUTTER }) {
  const g = new THREE.Group();
  phone.add(g);
  const back = -PD / 2;
  // the palm, behind the phone's lower half, out past its right edge
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.09, 0.026, 4, 0.012), skinMat);
  palm.position.set(0.014, -0.036, back - 0.0135);
  palm.rotation.z = -0.12;
  palm.castShadow = true;
  g.add(palm);
  // the ball of the thumb, against the lower right edge
  ball(g, V(PW / 2 + 0.009, -0.052, -0.0035), 0.0148, skinMat, [1, 1.35, 1]);
  // four fingers: from the knuckles across the back, round the left edge,
  // the last joint lying along the edge with its tip just over the glass
  [0.034, 0.012, -0.01, -0.03].forEach((y, i) => {
    const r = 0.0083 - i * 0.0004;
    const knuckle = V(-0.012 + i * 0.004, y - 0.012 - i * 0.004, back - 0.016);
    const bend = V(-PW / 2 - 0.002, y, back - 0.0085);
    const tip = V(-PW / 2 - 0.0062, y + 0.002, 0.0006);
    capsule(g, knuckle, bend, r, skinMat);
    capsule(g, bend, tip, r * 0.95, skinMat);
  });
  // the wrist leaves the heel of the hand below the phone's lower right
  const wrist = V(0.03, -PH / 2 - 0.035, back - 0.026);
  capsule(g, V(0.02, -0.072, back - 0.016), wrist, 0.025, skinMat);
  // the thumb: two joints and a nail, pivoting at its root so its tip comes
  // down onto the shutter; at the press its tip just meets the glass
  const tipR = 0.0086;
  const thumbRoot = V(PW / 2 + 0.005, -0.046, 0);
  const pivot = new THREE.Group();
  pivot.position.copy(thumbRoot);
  g.add(pivot);
  const tip = SHUTTER.clone().sub(thumbRoot);
  tip.z = PD / 2 + 0.0003 + tipR;
  const joint = V(tip.x * 0.52, tip.y * 0.4 + 0.004, tip.z + 0.0035);
  capsule(pivot, V(0, 0, tip.z - 0.001), joint, 0.0106, skinMat);
  capsule(pivot, joint, tip, tipR, skinMat);
  ball(pivot, tip.clone().add(V(-0.002, 0, 0.0056)), 0.0058, mat("#eec7b2", { roughness: 0.3, clearcoat: 0.7 }), [1.25, 0.85, 0.35]);
  return {
    wrist,
    // 0 resting a centimetre above the glass, 1 pressing the shutter
    press(k) {
      pivot.rotation.y = lerp(0.3, 0, smoother(k));
      pivot.rotation.z = lerp(-0.08, 0, smoother(k));
    },
  };
}

/* ---------------- the scenes ---------------- */

// Each scene builds its set and says, for a moment t (0..1 of the loop):
//   eye(t, narrow)    where your eye is and what it looks at
//   phone(t, narrow)  where the phone sits on the picture { sx, sy } (-1..1),
//                     how far from your eye { d }, what its camera is aimed
//                     at { aim }, and optionally { up, roll }
//   update(t)         anything else that moves
const SCENES = { fridge: fridgeScene, receipt: receiptScene, barcode: barcodeScene };

// Painted cupboards and a pine worktop, the larder's colours: the bench in
// the receipt and barcode scenes.
function bench(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const paint = mat("#8fa9ae", { roughness: 0.55, clearcoat: 0.15 });
  // oiled, not lacquered: no hot spot where the light catches it
  const pine = mat("#e6c697", { roughness: 0.72, clearcoat: 0.05, specularIntensity: 0.45, map: woodTexture() });
  part(g, 3.6, 0.08, 0.56, 0, 0.04, -0.34, matte("#5f6f72"), 0.01);
  part(g, 3.6, 0.8, 0.6, 0, 0.48, -0.31, paint, 0.012);
  part(g, 3.7, 0.04, 0.68, 0, 0.9, -0.28, pine, 0.008);
  for (const x of [-1.35, -0.45, 0.45, 1.35]) {
    part(g, 0.86, 0.72, 0.014, x, 0.47, 0.0, paint, 0.006);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), mat("#c9a46a", { metalness: 0.9, roughness: 0.3 }));
    knob.position.set(x + (x < 0 ? 0.34 : -0.34), 0.72, 0.02);
    g.add(knob);
  }
  return { top: 0.92 };
}

// The kitchen draws its models about twice life size, for legibility on its
// shelves; on the bench they're life size (a milk carton 26 cm tall).
const LIFE = 0.45;
function place(parent, model, look, x, y, z, rotY = 0) {
  const [m] = buildModel({ id: 1, name: look.label ?? model, model, look });
  const bb = new THREE.Box3().setFromObject(m);
  m.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  const holder = new THREE.Group();
  holder.add(m);
  holder.position.set(x, y, z);
  holder.rotation.y = rotY;
  holder.scale.setScalar(LIFE);
  m.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  parent.add(holder);
  return { holder, size: bb.getSize(V(0, 0, 0)) };
}

// The fridge: your kitchen's sage double-door fridge at true size (1.9 m
// tall), doors open, stocked a little. You stand a couple of metres back
// with the phone up until the whole fridge fits the frame.
function fridgeScene(scene) {
  const fridge = new THREE.Group();
  scene.add(fridge);
  // the kitchen draws it oversized for legibility; here it's 0.62 of that
  const S = 0.62;
  fridge.scale.setScalar(S);
  const W = 1.9, H = 2.85, D = 0.95, T = 0.07, FOOT = 0.14;
  fridge.position.z = -0.62 + D * S + 0.03;
  const steel = mat("#a9cdb6", { metalness: 0.05, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const liner = mat("#f1f4f2", { roughness: 0.6, emissive: new THREE.Color("#fff3dd"), emissiveIntensity: 0.06 });
  const glass = mat("#dff0ec", { roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false });
  part(fridge, W + 2 * T, T, D, 0, FOOT + H + T / 2, -D / 2, steel, 0.03);
  part(fridge, W + 2 * T, T, D, 0, FOOT + T / 2, -D / 2, steel, 0.03);
  part(fridge, T, H + 2 * T, D, -W / 2 - T / 2, FOOT + H / 2 + T, -D / 2, steel, 0.03);
  part(fridge, T, H + 2 * T, D, W / 2 + T / 2, FOOT + H / 2 + T, -D / 2, steel, 0.03);
  part(fridge, W, H, T, 0, FOOT + T + H / 2, -D + T / 2, liner, 0.02);
  part(fridge, 0.02, H, D - T, -W / 2 + 0.01, FOOT + T + H / 2, -D / 2 - T / 2, liner, 0.005);
  part(fridge, 0.02, H, D - T, W / 2 - 0.01, FOOT + T + H / 2, -D / 2 - T / 2, liner, 0.005);
  part(fridge, W + 2 * T - 0.04, FOOT, D - 0.12, 0, FOOT / 2, -D / 2 - 0.04, mat("#9a9fa3", { roughness: 0.5, metalness: 0.4 }), 0.02);
  const SHELVES = [FOOT + T + 0.62, FOOT + T + 1.3, FOOT + T + 1.98];
  for (const y of SHELVES) part(fridge, W - 0.04, 0.02, D - T - 0.06, 0, y - 0.01, -D / 2, glass, 0.005);
  const crisper = part(fridge, W - 0.08, 0.5, 0.03, 0, FOOT + T + 0.25, -0.08, mat("#e4f2ee", { roughness: 0.1, transparent: true, opacity: 0.2, depthWrite: false }), 0.012);
  crisper.castShadow = false;
  // a few things on each shelf: the kitchen's own models, at kitchen scale
  const rows = [
    [SHELVES[2] + 0.002, [["milk", { label: "Milk", colour: "#2f6fb5" }], ["juice", { label: "Orange juice", colour: "#f2a33a" }], ["herbs", { variant: "lobed", label: "Coriander" }], ["tub", { variant: "big", label: "Yoghurt", colour: "#2f6fb5" }]]],
    [SHELVES[1] + 0.002, [["eggs", {}], ["cheese", { variant: "block", label: "Cheddar" }], ["butter", { label: "Butter" }], ["cheese", { variant: "wedge", label: "Parmesan" }]]],
    [SHELVES[0] + 0.002, [["tray", { variant: "mince", label: "Beef mince" }], ["tray", { variant: "salmon", label: "Salmon" }], ["tray", { variant: "breast", label: "Chicken" }]]],
    [FOOT + T + 0.005, [["tomato", {}], ["carrot", {}], ["broccoli", {}], ["citrus", { variant: "lemon" }], ["capsicum", { colour: "#d6453d" }]]],
  ];
  for (const [y, row] of rows) {
    const built = row.map(([model, look]) => {
      const [m] = buildModel({ id: 1, name: look.label ?? model, model, look });
      const bb = new THREE.Box3().setFromObject(m);
      return { m, bb, w: bb.max.x - bb.min.x };
    });
    const total = built.reduce((s, b) => s + b.w, 0);
    const gap = Math.min(0.14, (W - 0.3 - total) / Math.max(1, built.length - 1));
    let x = -(total + gap * (built.length - 1)) / 2;
    for (const b of built) {
      b.m.position.set(x - b.bb.min.x, y - b.bb.min.y, -0.4 - (b.bb.min.z + b.bb.max.z) / 2);
      b.m.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
      fridge.add(b.m);
      x += b.w + gap;
    }
  }
  const bulb = new THREE.PointLight(0xffe9c7, 2.5, 4.2, 1.6);
  bulb.position.set(0, FOOT + T + H - 0.3, -D * 0.4);
  fridge.add(bulb);
  // the doors stand open, as they do in your kitchen
  const doorW = W / 2 + T;
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (W / 2 + T), FOOT, 0);
    hinge.rotation.y = side * 2.0;
    fridge.add(hinge);
    const slab = new THREE.Group();
    slab.position.set((-side * doorW) / 2, 0, 0.08);
    hinge.add(slab);
    part(slab, doorW - 0.01, H + 2 * T, 0.06, 0, (H + 2 * T) / 2, 0.05, steel, 0.03);
    part(slab, doorW - 0.1, H + 2 * T - 0.1, 0.1, 0, (H + 2 * T) / 2, -0.03, liner, 0.04);
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 1.5, 6, 16), mat("#c9ccce", { metalness: 0.95, roughness: 0.18 }));
    bar.position.set(-side * (doorW / 2 - 0.12), FOOT + H * 0.55, 0.16);
    slab.add(bar);
    for (const yy of [0.82, 1.52, 2.22]) part(slab, doorW - 0.24, 0.2, 0.02, 0, yy + 0.1, -0.31, mat("#e4f1ee", { roughness: 0.1, transparent: true, opacity: 0.4, depthWrite: false }), 0.008);
  }
  const front = fridge.position.z + 0.1;
  const middle = V(0, 0.95, fridge.position.z - 0.25);
  return {
    theme(d) {
      bulb.intensity = d ? 5 : 0.8;
      liner.emissiveIntensity = d ? 0.25 : 0.0;
    },
    // about 2.2 m back, eye height; the fridge to the left of the picture,
    // the phone held up to its right, so you see both
    eye: (t, narrow) => ({ pos: V(narrow ? 0.2 : 0.5, 1.66, front + 3.05 + (narrow ? 0.5 : 0)), look: V(narrow ? 0.08 : 0.42, 1.06, front) }),
    phone(t, narrow) {
      const up = raised(t);
      const n = nudge(t);
      return {
        sx: lerp(narrow ? 0.66 : 0.52, narrow ? 0.42 : 0.3, up) + n * 0.02,
        sy: lerp(-1.1, -0.18, up),
        d: lerp(0.44, 0.48, up),
        aim: middle.clone().lerp(V(0.7, 0.3, front), 1 - up),
        roll: lerp(-0.35, 0, up),
      };
    },
    update() {},
  };
}

// The receipt: flat on the bench, the phone held level about 25 cm over it,
// looking straight down with its top towards the wall, so the receipt runs
// the length of the picture.
function receiptScene(scene) {
  const { top } = bench(scene);
  const R_W = 0.08, R_L = 0.25;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(R_W, R_L, 1, 30), new THREE.MeshStandardMaterial({ map: receiptTexture(), roughness: 0.85 }));
  // the far end curls up a little, as thermal paper does
  const pos = paper.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setZ(i, Math.max(0, (y - R_L * 0.3) / (R_L * 0.2)) ** 2 * 0.007);
  }
  paper.geometry.computeVertexNormals();
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = 0.05;
  // a hand's length in from the edge of the bench, in front of you
  const RX = -0.05, RZ = -0.13;
  paper.position.set(RX, top + 0.0008, RZ);
  paper.receiveShadow = true;
  scene.add(paper);
  // what's just been unpacked, against the wall
  place(scene, "bottle", { variant: "oil", label: "Olive oil", colour: "#7a9a3a" }, -0.42, top, -0.48, 0.15);
  place(scene, "can", { label: "Tomatoes", colour: "#d6453d" }, -0.3, top, -0.5, 0.25);
  place(scene, "jar", { variant: "peanut", label: "Peanut butter", colour: "#d6453d" }, 0.22, top, -0.5, -0.2);
  place(scene, "milk", { label: "Milk", colour: "#2f6fb5" }, 0.36, top, -0.47, -0.3);
  place(scene, "banana", {}, -0.34, top, -0.2, 0.5);
  return {
    // looking this far down, your shoulder is behind the view, not ahead
    body: { side: 0.18, ahead: -0.06, down: 0.28 },
    // standing at the bench, looking down at it over your shoulder
    // (on a narrow screen the wider view fits it in: stepping back would
    // take the receipt out of your reach)
    eye: (t, narrow) => ({ pos: V(0.16, 1.62, 0.3), look: V(-0.03, top + 0.08, RZ - 0.06) }),
    phone(t, narrow) {
      const up = raised(t);
      const n = nudge(t);
      // held up: level, its camera about 24 cm over the receipt, top
      // towards the wall
      const held = V(RX, top + 0.24, RZ + 0.004);
      return {
        sx: narrow ? 0.62 : 0.5,
        sy: -1.05,
        d: 0.36,
        at: held.add(V(0, 0, n * 0.006)),
        mix: up,
        aim: V(lerp(0.3, RX, up), top, lerp(0.1, RZ + 0.004, up)),
        up: V(0, lerp(1, 0.05, up), lerp(-0.1, -1, up)).normalize(),
        roll: 0,
      };
    },
    update() {},
  };
}

// The barcode: your left hand holds a cereal box up, turns it round to its
// back, and the phone comes in close to the barcode on its lower right.
function barcodeScene(scene, { skinMat, sleeveMat }) {
  const { top } = bench(scene);
  place(scene, "jar", { variant: "jam", label: "Jam", colour: "#c2412f" }, 0.42, top, -0.45, -0.2);
  place(scene, "bottle", { variant: "sauce", label: "Soy sauce", colour: "#c2412f" }, 0.6, top, -0.48, -0.1);
  place(scene, "can", { label: "Chickpeas", colour: "#e8b63a" }, -0.5, top, -0.46, 0.2);
  // a 190 x 290 x 70 mm cereal box, sitting on your hand: `box` is at your
  // wrist, tilted so the box faces you; `spin` turns it round on the hand
  const BW = 0.19, BH = 0.29, BD = 0.07;
  const box = new THREE.Group();
  scene.add(box);
  const spin = new THREE.Group();
  box.add(spin);
  const side = mat("#e3ad35", { roughness: 0.6 });
  // RoundedBoxGeometry keeps BoxGeometry's face order: +x, -x, +y, -y, +z, -z
  const carton = new THREE.Mesh(new RoundedBoxGeometry(BW, BH, BD, 2, 0.003), [side, side, side, side, new THREE.MeshPhysicalMaterial({ map: cerealFront(), roughness: 0.5, clearcoat: 0.3 }), new THREE.MeshPhysicalMaterial({ map: cerealBack(), roughness: 0.6, clearcoat: 0.2 })]);
  carton.castShadow = true;
  // the box's bottom rests on the palm, 3 cm over the wrist
  const UNDER = 0.03;
  carton.position.y = UNDER + BH / 2;
  spin.add(carton);
  // your left hand under it, palm up as a waiter's is under a tray, the
  // wrist bent back below it: fingers round the right side, thumb round the
  // left, so the front and back stay clear and turning the box round is a
  // turn of the forearm
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.084, 0.024, 0.072, 4, 0.011), skinMat);
  palm.position.set(0.014, UNDER - 0.012, 0);
  palm.castShadow = true;
  spin.add(palm);
  [-0.025, -0.0085, 0.0085, 0.025].forEach((z) => {
    const r = 0.0079 - Math.abs(z) * 0.02;
    capsule(spin, V(0.05, UNDER - 0.011, z), V(BW / 2 + 0.002, UNDER - r + 0.0005, z), r, skinMat);
    capsule(spin, V(BW / 2 + 0.002, UNDER - r + 0.0005, z), V(BW / 2 + r + 0.0005, UNDER + 0.036 - Math.abs(z) * 0.3, z), r * 0.94, skinMat);
  });
  capsule(spin, V(-0.024, UNDER - 0.013, 0.012), V(-BW / 2 - 0.002, UNDER - 0.0088, 0.014), 0.0094, skinMat);
  capsule(spin, V(-BW / 2 - 0.002, UNDER - 0.0088, 0.014), V(-BW / 2 - 0.0092, UNDER + 0.036, 0.016), 0.0088, skinMat);
  // the heel of the hand down into the wrist (the box's own origin)
  capsule(spin, V(-0.006, UNDER - 0.016, 0), V(0, 0, 0), 0.024, skinMat);
  const leftArm = arm(scene, skinMat, sleeveMat);
  const leftShoulder = V(0, 0, 0), leftWrist = V(0, 0, 0), leftElbow = V(0, 0, 0);
  const code = cerealCode();
  // the barcode's centre once the box is turned round (its back facing you)
  const codeAt = () => carton.localToWorld(V((code.u - 0.5) * BW * -1, (0.5 - code.v) * BH, -BD / 2));
  let eyeNow = V(0, 0, 0);
  return {
    // seen from a little further behind your shoulders, to fit the box
    body: { side: 0.18, ahead: 0.2, down: 0.3 },
    eye: (t, narrow) => {
      eyeNow = V(0.22, 1.64, 1.2 + (narrow ? 0.12 : 0));
      return { pos: eyeNow, look: V(narrow ? -0.13 : -0.06, 1.26, 0.42) };
    },
    phone(t, narrow) {
      const up = raised(t, 0.06);
      const n = nudge(t, 0.05);
      const target = codeAt();
      // between your eye and the barcode, 12 cm off it, as you'd hold it to
      // see the barcode on the screen
      const toEye = eyeNow.clone().sub(target).normalize();
      return {
        sx: narrow ? 0.62 : 0.52,
        sy: -1.0,
        d: 0.42,
        at: target.clone().addScaledVector(toEye, 0.12).add(V(n * 0.005, 0, 0)),
        mix: up,
        aim: target.clone().lerp(V(0.3, 0.6, 0), 1 - up),
        roll: lerp(-0.3, 0, up),
      };
    },
    pose: () => {
      const corners = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(carton.localToWorld(V((x * BW) / 2, (y * BH) / 2, (z * BD) / 2)).toArray());
      return { box: corners, leftShoulder: leftShoulder.toArray(), leftElbow: leftElbow.toArray(), leftWrist: leftWrist.toArray() };
    },
    update(t, { shoulderAt, right, ahead }) {
      // your left arm: the upper arm down by your side and a little
      // forward, the forearm up and forward from the elbow; the box is
      // wherever that puts your hand, so the arm is always its true length
      leftShoulder.copy(shoulderAt(-1));
      const upper = V(0, -0.82, 0).addScaledVector(right, -0.3).addScaledVector(ahead, 0.48).normalize();
      leftElbow.copy(leftShoulder).addScaledVector(upper, 0.31);
      const fore = V(0, 0.42, 0).addScaledVector(right, 0.14).addScaledVector(ahead, 0.9).normalize();
      // (lifted a touch as it turns)
      const turn = span(t, 0.03, 0.2) * (1 - span(t, 0.84, 0.99));
      const lift = 0.012 * Math.sin(turn * Math.PI);
      leftWrist.copy(leftElbow).addScaledVector(fore, 0.27).add(V(0, lift, 0));
      leftArm.reach(leftShoulder, leftWrist, leftElbow.clone().sub(leftShoulder));
      // the box faces your eye, front first; turned round on your hand
      // before the phone comes up, and back again at the end
      const d = eyeNow.clone().sub(leftWrist);
      box.position.copy(leftWrist);
      box.rotation.set(-Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.85, Math.atan2(d.x, d.z), 0, "YXZ");
      spin.rotation.y = Math.PI * turn;
      box.updateMatrixWorld(true);
    },
  };
}
/* ---------------- printed things ---------------- */

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// framing corners over the camera's picture
function cornersTexture() {
  return canvasTexture(360, 480, (g, w, h) => {
    g.strokeStyle = "rgba(255,255,255,0.92)";
    g.lineWidth = 6;
    g.lineCap = "round";
    const m = 22, L = 40;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      g.beginPath();
      g.moveTo(x, y + dy * L);
      g.lineTo(x, y);
      g.lineTo(x + dx * L, y);
      g.stroke();
    }
  });
}

// a round tick in Larder's sage
function tickTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#5b8f72";
    g.beginPath();
    g.arc(64, 64, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 12;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(38, 66);
    g.lineTo(56, 84);
    g.lineTo(90, 46);
    g.stroke();
  });
}

function receiptTexture() {
  return canvasTexture(256, 800, (g, w) => {
    g.fillStyle = "#fbfaf4";
    g.fillRect(0, 0, w, 800);
    g.fillStyle = "#34312d";
    g.textAlign = "center";
    g.font = "700 25px Helvetica, Arial, sans-serif";
    g.fillText("FRESH MARKET", w / 2, 56);
    g.font = "15px Helvetica, Arial, sans-serif";
    g.fillText("12 High St · 07/11", w / 2, 84);
    g.font = "17px 'Courier New', monospace";
    const lines = [["MILK 2L", "3.39"], ["EGGS 12PK", "6.70"], ["BANANAS", "2.80"], ["OLIVE OIL", "11.00"], ["TOMATOES", "1.20"], ["PEANUT BTR", "4.50"], ["SPAGHETTI", "2.00"], ["CHEDDAR", "6.50"], ["SPINACH", "3.00"]];
    lines.forEach(([a, b], i) => {
      const y = 132 + i * 40;
      g.textAlign = "left";
      g.fillText(a, 20, y);
      g.textAlign = "right";
      g.fillText(b, w - 20, y);
    });
    g.fillRect(20, 506, w - 40, 2);
    g.font = "700 22px 'Courier New', monospace";
    g.textAlign = "left";
    g.fillText("TOTAL", 20, 546);
    g.textAlign = "right";
    g.fillText("41.09", w - 20, 546);
    g.textAlign = "center";
    g.font = "14px Helvetica, Arial, sans-serif";
    g.fillText("Thank you!", w / 2, 600);
    for (let i = 0; i < 44; i++) g.fillRect(34 + i * 4.3, 640, i % 3 ? 2 : 3, 56);
  });
}

function cerealFront() {
  return canvasTexture(380, 580, (g, w, h) => {
    g.fillStyle = "#e8b63a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c2412f";
    g.beginPath();
    g.ellipse(w / 2, 128, 162, 86, -0.08, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fffaf0";
    g.textAlign = "center";
    g.font = "900 66px Helvetica, Arial, sans-serif";
    g.fillText("OAT", w / 2, 120);
    g.font = "900 46px Helvetica, Arial, sans-serif";
    g.fillText("CRUNCH", w / 2, 170);
    // a bowl of cereal
    g.fillStyle = "#f6f3ec";
    g.beginPath();
    g.moveTo(w / 2 - 140, 400);
    g.quadraticCurveTo(w / 2, 560, w / 2 + 140, 400);
    g.fill();
    for (let i = 0; i < 30; i++) {
      g.fillStyle = i % 2 ? "#c98a3a" : "#dba45c";
      g.beginPath();
      g.arc(w / 2 - 120 + ((i * 37) % 240), 392 + ((i * 13) % 20), 11, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(w / 2, 400, 142, 26, 0, 0, Math.PI);
    g.fill();
  });
}

// where the barcode sits on the back, as a share of its width and height
// (the lower right quarter, GS1's preferred spot, clear of the edges)
function cerealCode() {
  return { u: 0.7, v: 0.8 };
}

function cerealBack() {
  return canvasTexture(380, 580, (g, w, h) => {
    g.fillStyle = "#f4e2b0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7a5a2a";
    g.font = "700 24px Helvetica, Arial, sans-serif";
    g.fillText("Nutrition information", 24, 52);
    g.fillStyle = "rgba(122,90,42,0.32)";
    for (let i = 0; i < 9; i++) g.fillRect(24, 76 + i * 26, w - 48 - (i % 3) * 46, 11);
    g.fillStyle = "rgba(122,90,42,0.5)";
    g.font = "16px Helvetica, Arial, sans-serif";
    g.fillText("Ingredients: whole oats, honey,", 24, 340);
    g.fillText("almonds, sunflower oil.", 24, 362);
    // the barcode, 56 x 39 mm on a white panel, centred where cerealCode says
    const { u, v } = cerealCode();
    const cw = (0.056 / 0.19) * w, ch = (0.039 / 0.29) * h;
    const cx = u * w, cy = v * h;
    g.fillStyle = "#ffffff";
    g.fillRect(cx - cw / 2 - 8, cy - ch / 2 - 8, cw + 16, ch + 16);
    g.fillStyle = "#1d1a17";
    const bars = [1, 1, 1, 2, 1, 1, 3, 2, 1, 1, 2, 2, 2, 1, 1, 3, 1, 2, 1, 1, 4, 1, 1, 1, 1, 1, 1, 2, 3, 1, 2, 1, 2, 1, 1, 3, 1, 1, 2, 2, 1, 1, 1, 1];
    const unit = cw / bars.reduce((s, b) => s + b, 0);
    let x = cx - cw / 2;
    bars.forEach((b, i) => {
      if (i % 2 === 0) g.fillRect(x, cy - ch / 2, b * unit, ch * 0.78);
      x += b * unit;
    });
    g.font = `${Math.round(ch * 0.17)}px 'Courier New', monospace`;
    g.textAlign = "center";
    g.fillText("9 300633 603109", cx, cy + ch / 2 - 1);
  });
}

// the kitchen's pale floorboards
function floorTexture() {
  const t = canvasTexture(512, 512, (g) => {
    g.fillStyle = "#cdbca4";
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 64) {
      const off = (y / 64) % 2 ? 150 : 0;
      for (let x = -off; x < 512; x += 310) {
        const tone = 214 + ((x * 7 + y * 3) % 14);
        g.fillStyle = `rgb(${tone}, ${tone - 14}, ${tone - 32})`;
        g.fillRect(x, y, 308, 62);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 6);
  return t;
}

// a soft pine grain for the worktop
function woodTexture() {
  const t = canvasTexture(512, 64, (g) => {
    g.fillStyle = "#e6c697";
    g.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 60; i++) {
      const y = (i * 37) % 64;
      g.strokeStyle = `rgba(150, 105, 60, ${0.05 + (i % 5) * 0.025})`;
      g.lineWidth = 0.6 + (i % 3) * 0.7;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 2);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}
