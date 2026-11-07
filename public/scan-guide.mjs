// A small looping 3D picture beside the photo form on each scan page, in
// soft pastel colours: seen through your own eyes, your hand brings a phone
// up, its screen shows what its camera sees, your thumb lifts and taps the
// shutter, a flash and a tick, and the phone comes down again.
//
//   fridge   the open fridge, framed whole from a couple of metres back
//   receipt  a receipt flat on the worktop, the phone held level over it
//   barcode  your other hand tips a cereal box over onto its front, and the
//            phone comes over the barcode on its back
//
// It moves as a person does, not a machine: hands travel in arcs, slow down
// before they touch anything, arrive in free air with a little overshoot
// and settle, turn a moment after they move, and are never perfectly still.
// The thumb lifts before it presses, and the press pushes the phone back a
// touch. The box is tipped up by its edge, past standing, and falls the
// rest of the way (no wrist turns a box round on the palm of its hand).
// Every sway runs a whole number of times round the loop, so it joins up.
//
// The hands are jointed (three bones to a finger, an opposing thumb, nails,
// a hollow palm) and posed by reaching each fingertip to what it touches:
// round the phone's edge, onto the shutter, against the side of the box,
// never into it. Arms are two-bone reaches from shoulders just out of the
// picture, so they keep their length.
//
// The phone's screen is a live view: the scene drawn again from the
// phone's own camera (a portrait 3:4 frame, like a phone's main camera).
// Sizes are real: a 72 x 147 mm phone, an 80 mm receipt, a fridge 1.9 m
// tall, a barcode 56 x 39 mm on the lower right of the box's back.
//
// It's a picture of what to do, not a control: the canvas is aria-hidden,
// the caption beside it says the same in words, and the page's form works
// the same without it. It plays only while on screen, can be paused, holds
// a single frame (the photo just taken) for reduced motion, and isn't drawn
// at all without WebGL.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildModel } from "./kitchen-models.mjs";
import { t } from "./i18n.mjs";

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

/* ---------------- timing and movement ---------------- */

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const smoother = (x) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// 0 before a, easing up to 1 at b
const span = (t, a, b) => smoother((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// 0 to 1 the way a hand arrives in free air: a touch past, then back
const settle = (x) => {
  const t = clamp01(x);
  return smoother(Math.min(1, t * 1.18)) + 0.045 * Math.sin(Math.PI * clamp01((t - 0.5) / 0.5)) ** 2;
};
// a slow sway, n times round the loop
const wave = (t, n, phase = 0) => Math.sin(TAU * (n * t + phase));
// 0 away from c, rising smoothly to 1 at c, w either side
const bump = (t, c, w) => {
  const u = clamp01(1 - Math.abs(t - c) / w);
  return u * u * (3 - 2 * u);
};
// along a curve from a to b, bowed towards c (k a little past 1 carries on
// past b, which is the overshoot)
function arc(a, c, b, k) {
  const u = 1 - k;
  return a.clone().multiplyScalar(u * u).addScaledVector(c, 2 * u * k).addScaledVector(b, k * k);
}
function arc3(a, b, c, d, k) {
  const u = 1 - k;
  return a.clone().multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * k).addScaledVector(c, 3 * u * k * k).addScaledVector(d, k * k * k);
}
// a rotation that points an object's -z at `target`, its +y towards `up`
function aim(pos, target, up) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, target, up));
}
// a pose { pos, quat } from a matrix
function poseOf(m) {
  const pos = V(0, 0, 0), quat = new THREE.Quaternion();
  m.decompose(pos, quat, V(0, 0, 0));
  return { pos, quat };
}

/* ---------------- materials ---------------- */

// [material, light colour, dark colour]: the theme switch walks this
const themed = [];
function tone(material, light, dark) {
  themed.push([material, light, dark]);
  material.color.set(light);
  return material;
}
const soft = (hex, o = {}) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.68, sheen: 0.2, sheenRoughness: 0.8, sheenColor: "#ffffff", ...o });
// skin with a little warmth in its shadows, as light through skin gives
const SKIN = () => new THREE.MeshPhysicalMaterial({ color: "#efc3a8", roughness: 0.56, sheen: 0.55, sheenRoughness: 0.5, sheenColor: "#ffdccb", emissive: "#e08a6e", emissiveIntensity: 0.07, clearcoat: 0.06 });
const NAIL = () => new THREE.MeshPhysicalMaterial({ color: "#f8dcd2", roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, emissive: "#e8a898", emissiveIntensity: 0.05 });
const SLEEVE = () => tone(soft("#a9bedd", { roughness: 0.88, sheen: 0.7, sheenRoughness: 0.45, sheenColor: "#eef2ff" }), "#a9bedd", "#56667f");

const SPHERE = new THREE.SphereGeometry(1, 24, 16);
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
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.0001, a.distanceTo(b)), 6, 16), m);
  c.position.copy(a).add(b).multiplyScalar(0.5);
  c.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  c.castShadow = true;
  parent.add(c);
  return c;
}
function ball(parent, p, r, m, [sx, sy, sz] = [1, 1, 1]) {
  const s = new THREE.Mesh(SPHERE, m);
  s.position.copy(p);
  s.scale.set(r * sx, r * sy, r * sz);
  s.castShadow = true;
  parent.add(s);
  return s;
}
// a tapering tube moved every frame: a unit cylinder stretched between points
function bone(scene, r0, r1, m) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 22, 1, true), m);
  c.castShadow = true;
  scene.add(c);
  return {
    set(a, b) {
      c.position.copy(a).add(b).multiplyScalar(0.5);
      c.scale.set(1, Math.max(0.0001, a.distanceTo(b)), 1);
      c.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    },
  };
}
// signed distance from p to a box centred at the origin with half sizes h
// and rounded edges r (negative inside)
function boxDistance(p, h, r = 0) {
  const qx = Math.abs(p.x) - (h.x - r), qy = Math.abs(p.y) - (h.y - r), qz = Math.abs(p.z) - (h.z - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/* ---------------- an arm ---------------- */

// Shoulder to wrist through an elbow placed by the two-bone rule: the bones
// keep their lengths and the elbow bends towards `hint` (down and out). A
// sleeve to just short of the wrist, then bare wrist into the hand.
function arm(scene, skinMat, sleeveMat) {
  const L1 = 0.31, L2 = 0.27;
  const upper = bone(scene, 0.054, 0.045, sleeveMat);
  const fore = bone(scene, 0.045, 0.035, sleeveMat);
  const wrist = bone(scene, 0.024, 0.021, skinMat);
  const elbowBall = ball(scene, V(0, 0, 0), 0.047, sleeveMat);
  const shoulderBall = ball(scene, V(0, 0, 0), 0.058, sleeveMat);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0065, 10, 32), sleeveMat);
  cuff.castShadow = true;
  scene.add(cuff);
  return {
    reach(shoulder, w, hint) {
      const d = w.clone().sub(shoulder);
      const dist = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.004);
      const dir = d.clone().normalize();
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const side = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
      const elbow = shoulder.clone().add(dir.clone().multiplyScalar(a)).add(side.multiplyScalar(h));
      const sleeveEnd = elbow.clone().lerp(w, 0.8);
      upper.set(shoulder, elbow);
      fore.set(elbow, sleeveEnd);
      wrist.set(sleeveEnd, w);
      elbowBall.position.copy(elbow);
      shoulderBall.position.copy(shoulder);
      cuff.position.copy(sleeveEnd);
      cuff.quaternion.setFromUnitVectors(V(0, 0, 1), w.clone().sub(elbow).normalize());
      return elbow;
    },
  };
}

/* ---------------- a hand ---------------- */

// An adult hand in metres, in its own frame for a right hand: the wrist at
// the origin, +y towards the fingertips, the palm facing -z (the back of the
// hand +z), the thumb on the -x side. A left hand is its mirror image.
const DIGITS = [
  // name, knuckle, bone lengths, radius at the knuckle
  ["index", [-0.026, 0.094, 0], [0.041, 0.025, 0.02], 0.0088],
  ["middle", [-0.0085, 0.098, 0], [0.046, 0.029, 0.021], 0.0091],
  ["ring", [0.0085, 0.094, 0], [0.043, 0.027, 0.02], 0.0086],
  ["little", [0.0245, 0.086, -0.001], [0.034, 0.02, 0.018], 0.0076],
];
const THUMB = { at: [-0.02, 0.017, -0.005], len: [0.044, 0.032, 0.027], radii: [0.0128, 0.0115, 0.0106, 0.0094] };
// a finger is [spread, knuckle bend, middle-joint bend] (its last joint
// follows the middle one, as its tendons make it); the thumb is [three
// turns at its root, two bends]
const FINGER_LIMITS = [[-0.3, 0.3], [-1.55, 0.35], [-1.8, 0.02]];
const THUMB_LIMITS = [[-1.3, 0.8], [-1.1, 1.1], [-0.8, 1.0], [-1.0, 0.25], [-1.3, 0.4]];
const RELAXED = { index: [0.03, -0.24, -0.38], middle: [0, -0.3, -0.45], ring: [-0.03, -0.36, -0.52], little: [-0.07, -0.42, -0.6], thumb: [-0.15, 0, 0.3, -0.12, -0.15] };
const OPEN = { index: [0.1, -0.1, -0.16], middle: [0.02, -0.12, -0.18], ring: [-0.06, -0.14, -0.2], little: [-0.14, -0.16, -0.22], thumb: [-0.05, 0.1, 0.62, -0.05, -0.05] };
// a hand that's just let go of something: fingers easing into a curl, the
// thumb falling in beside the first finger (only reaching for a thing
// spreads it wide)
const LOOSE = { index: [0.05, -0.2, -0.3], middle: [0.01, -0.24, -0.36], ring: [-0.04, -0.28, -0.42], little: [-0.09, -0.32, -0.48], thumb: [-0.22, 0.12, -0.4, -0.18, -0.22] };
const copyPose = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.slice()]));
const mixPose = (a, b, k) => Object.fromEntries(Object.keys(a).map((n) => [n, a[n].map((v, i) => lerp(v, b[n][i], k))]));

// a finger bone: a tube from r0 to r1, a little waisted between the joints
function boneGeometry(len, r0, r1) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push(new THREE.Vector2(lerp(r0, r1, k) * (1 - 0.06 * Math.sin(Math.PI * k)), k * len));
  }
  return new THREE.LatheGeometry(pts, 20);
}

// coordinate descent over a few joint angles, starting from v (kept within
// limits), until nothing makes it better
function descend(v, limits, cost) {
  let best = cost(v);
  const step = v.map(() => 0.3);
  for (let it = 0; it < 500; it++) {
    let moved = false;
    for (let i = 0; i < v.length; i++) {
      for (const dir of [1, -1]) {
        const old = v[i];
        const nv = clamp(old + dir * step[i], limits[i][0], limits[i][1]);
        if (nv === old) continue;
        v[i] = nv;
        const c = cost(v);
        if (c < best) {
          best = c;
          moved = true;
          break;
        }
        v[i] = old;
      }
    }
    if (!moved) {
      for (let i = 0; i < step.length; i++) step[i] *= 0.5;
      if (step[0] < 0.001) break;
    }
  }
  return best;
}

function makeHand(side, skin, nailMat) {
  const root = new THREE.Group();
  const hand = new THREE.Group();
  if (side === "left") hand.scale.x = -1;
  root.add(hand);
  const solid = (m) => ((m.castShadow = true), (m.receiveShadow = true), m);
  // the palm: narrower at the wrist, thinner on the little finger's side,
  // a little hollow in the middle
  const pg = new RoundedBoxGeometry(0.082, 0.098, 0.026, 4, 0.0115);
  const pp = pg.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), z = pp.getZ(i);
    const y = pp.getY(i);
    const k = (y + 0.049) / 0.098;
    x *= lerp(0.8, 1, smoother(k));
    z *= 1 - 0.16 * (x / 0.041);
    if (z < 0) z += 0.0035 * Math.max(0, 1 - (x / 0.041) ** 2) * Math.sin(Math.PI * clamp01(k));
    pp.setXYZ(i, x, y, z);
  }
  const palm = solid(new THREE.Mesh(pg, skin));
  palm.position.y = 0.05;
  hand.add(palm);
  // the ball of the thumb and the heel of the hand
  ball(hand, V(-0.022, 0.034, -0.006), 0.02, skin, [0.95, 1.5, 0.85]).rotation.z = -0.35;
  ball(hand, V(0.023, 0.03, -0.0045), 0.0155, skin, [0.85, 1.6, 0.8]);
  const wristMesh = capsule(hand, V(0, -0.02, 0), V(0, 0.014, 0), 0.0205, skin);
  wristMesh.scale.x = 1.22;

  const digits = {};
  const digit = (parent, at, len, radii) => {
    const joints = [];
    let p = parent;
    let pos = V(...at);
    for (let j = 0; j < 3; j++) {
      const g = new THREE.Group();
      g.rotation.order = "ZXY";
      g.position.copy(pos);
      p.add(g);
      const knuckle = solid(new THREE.Mesh(SPHERE, skin));
      knuckle.scale.setScalar(radii[j] * (j === 0 ? 1.04 : 1));
      g.add(knuckle);
      g.add(solid(new THREE.Mesh(boneGeometry(len[j], radii[j], radii[j + 1]), skin)));
      joints.push(g);
      p = g;
      pos = V(0, len[j], 0);
    }
    const r = radii[3];
    const end = solid(new THREE.Mesh(SPHERE, skin));
    end.position.set(0, len[2], -r * 0.08);
    end.scale.set(r, r * 1.12, r * 0.98);
    p.add(end);
    const nail = new THREE.Mesh(SPHERE, nailMat);
    nail.position.set(0, len[2] * 0.66, r * 0.74);
    nail.scale.set(r * 0.74, len[2] * 0.36, r * 0.3);
    p.add(nail);
    // the pad, the part that touches things
    const pad = new THREE.Object3D();
    pad.position.set(0, len[2] * 0.8, -r * 0.18);
    p.add(pad);
    return { joints, pad, len, radii, r };
  };
  for (const [name, at, len, r] of DIGITS) digits[name] = digit(hand, at, len, [r, r * 0.9, r * 0.82, r * 0.78]);
  // the thumb points out at about 50° from the fingers
  const thumbBase = new THREE.Group();
  thumbBase.position.set(...THUMB.at);
  thumbBase.rotation.z = 0.85;
  hand.add(thumbBase);
  digits.thumb = digit(thumbBase, [0, 0, 0], THUMB.len, THUMB.radii);
  digits.thumb.joints[0].rotation.order = "XYZ";

  const pose = copyPose(RELAXED);
  function apply(name, v) {
    const j = digits[name].joints;
    if (name === "thumb") {
      j[0].rotation.set(v[0], v[1], v[2]);
      j[1].rotation.set(v[3], 0, 0);
      j[2].rotation.set(v[4], 0, 0);
    } else {
      j[0].rotation.set(v[1], 0, v[0]);
      j[1].rotation.set(v[2], 0, 0);
      j[2].rotation.set(v[2] * 0.72, 0, 0);
    }
  }
  function setPose(p) {
    for (const n of Object.keys(p)) apply(n, p[n]);
  }
  // points through the hand, each with its radius, for keeping out of things
  function digitPoints(name, out) {
    const d = digits[name];
    d.joints.forEach((g, j) => {
      out.push([g.localToWorld(V(0, 0, 0)), d.radii[j]]);
      out.push([g.localToWorld(V(0, d.len[j] * 0.5, 0)), (d.radii[j] + d.radii[j + 1]) / 2]);
    });
    out.push([d.joints[2].localToWorld(V(0, d.len[2], -d.r * 0.08)), d.r]);
    return out;
  }
  const PALM_POINTS = [[-0.032, 0.014, 0, 0.011], [0.03, 0.014, 0, 0.01], [-0.033, 0.088, 0, 0.012], [0.032, 0.084, 0, 0.011], [0, 0.05, 0, 0.012], [-0.016, 0.07, 0, 0.012], [0.016, 0.03, 0, 0.012], [-0.022, 0.034, -0.006, 0.016], [0.023, 0.03, -0.0045, 0.013], [0, -0.006, 0, 0.02]];
  function palmPoints(out = []) {
    for (const [x, y, z, r] of PALM_POINTS) out.push([hand.localToWorld(V(x, y, z)), r]);
    return out;
  }
  function points() {
    const out = palmPoints();
    for (const n of Object.keys(digits)) digitPoints(n, out);
    return out;
  }
  // bend one digit until its pad reaches `target` (a world point, or a
  // surface: a function giving its closest point to the pad), staying out
  // of whatever `clear(p)` (a signed distance) says is solid; `faceInto` is
  // the outward normal of the surface the pad should press flat against
  function reach(name, target, clear, faceInto) {
    const d = digits[name];
    const limits = name === "thumb" ? THUMB_LIMITS : FINGER_LIMITS;
    const at = V(0, 0, 0);
    const padDir = V(0, 0, 0);
    const cost = (p) => {
      apply(name, p);
      d.joints[0].updateMatrixWorld(true);
      d.pad.getWorldPosition(at);
      let c = at.distanceToSquared(typeof target === "function" ? target(at) : target);
      for (const [q, r] of digitPoints(name, [])) {
        const s = clear(q);
        if (s < r * 0.9) c += 30 * (r * 0.9 - s) ** 2;
      }
      if (faceInto) {
        padDir.set(0, 0, -1).transformDirection(d.joints[2].matrixWorld);
        c += 4e-6 * (1 + padDir.dot(faceInto));
      }
      return c + 3e-7 * p.reduce((s, x) => s + x * x, 0);
    };
    // from where it is, and from a straight and a curled start: the best
    let best = null;
    for (const startFrom of [pose[name].slice(), limits.map(([a, b]) => clamp(0, a, b)), name === "thumb" ? [-0.6, 0, 0.4, -0.4, -0.4] : [0, -0.8, -1.0]]) {
      const v = startFrom.slice();
      const c = descend(v, limits, cost);
      if (!best || c < best.c) best = { c, v };
    }
    pose[name] = best.v;
    apply(name, best.v);
    d.joints[0].updateMatrixWorld(true);
    d.pad.getWorldPosition(at);
    return at.distanceTo(typeof target === "function" ? target(at) : target);
  }
  return { root, hand, digits, pose, setPose, reach, points, palmPoints };
}

// Your right hand round the phone, held upright to take a photo: the phone
// lies diagonally across the fingers, the heel of the hand and the ball of
// the thumb at its lower right, each finger crossing its back and curling
// round its left edge where it meets it, and the thumb rising from the lower
// right over the glass. `GRIP` (where the wrist is, and the fingers' angle)
// was found by searching for the placement that lets every finger and the
// thumb reach without stretching. Returns the thumb's three poses: resting
// over the glass, lifted (just before a press) and pressing the shutter.
const GRIP = { ang: 52, x: 0.046, y: -0.103 };
function gripPhone(hand, phone, { PW, PH, PD, FACE, SHUTTER }, place = GRIP) {
  phone.add(hand.root);
  const half = V(PW / 2, PH / 2, PD / 2);
  // (its edges are rounded right round: half its 8 mm depth)
  const clear = (p) => boxDistance(phone.worldToLocal(p.clone()), half, PD / 2.01);
  // fingers up and to the left, the palm against the phone's back
  const ang = THREE.MathUtils.degToRad(place.ang);
  const y = V(-Math.cos(ang), Math.sin(ang), 0), z = V(0, 0, -1), x = y.clone().cross(z);
  hand.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  hand.root.position.set(place.x, place.y, -PD / 2 - 0.0125);
  hand.setPose(OPEN);
  // back off until the palm only touches
  for (let i = 0; i < 60; i++) {
    hand.root.updateMatrixWorld(true);
    if (Math.min(...hand.palmPoints().map(([q, r]) => clear(q) - r)) >= 0.0004) break;
    hand.root.position.z -= 0.0006;
  }
  hand.root.updateMatrixWorld(true);
  const miss = {};
  for (const name of ["index", "middle", "ring", "little"]) {
    // where this finger's own line crosses the left edge
    const k = phone.worldToLocal(hand.digits[name].joints[0].getWorldPosition(V(0, 0, 0)));
    const along = (k.x + PW / 2) / Math.cos(ang);
    const yy = clamp(k.y + Math.sin(ang) * along, -PH / 2 + 0.012, PH / 2 - 0.012);
    miss[name] = hand.reach(name, phone.localToWorld(V(-PW / 2 - hand.digits[name].r * 0.8, yy, 0)), clear, V(-1, 0, 0));
  }
  const rT = hand.digits.thumb.r;
  const glass = V(0, 0, 1);
  const thumbAt = (dx, dy, lift) => {
    miss[`thumb${lift}`] = hand.reach("thumb", phone.localToWorld(SHUTTER.clone().add(V(dx, dy, 0)).setZ(FACE + rT * 0.8 + lift)), clear, glass);
    return hand.pose.thumb.slice();
  };
  const hover = thumbAt(0.006, -0.003, 0.008);
  const lifted = thumbAt(0.009, -0.005, 0.017);
  const press = thumbAt(0, 0, 0);
  const fingers = copyPose(hand.pose);
  return {
    miss,
    poses: { hover, lifted, press },
    thumb(a, b, k) {
      fingers.thumb = a.map((v, i) => lerp(v, b[i], k));
      hand.setPose(fingers);
    },
  };
}

// Your left hand taking a box lying face up by its left side, to tip it
// over: the palm against the side, the fingers along it pressing on it, and
// the thumb (up, as a left hand held so has it) hooked over the edge onto
// the top. Tipping the box then turns the forearm a quarter turn, thumb-up
// to palm-down, as it does when you tip a box over. `BOX_GRIP` (the wrist's
// place along and up the side, and the fingers' slope) was found by
// searching for the placement where every finger and the thumb touch.
const BOX_GRIP = { y: -0.14, z: 0.02, tilt: 0 };
function gripBox(hand, carton, { BW, BH, BD }, solid, place = BOX_GRIP) {
  carton.updateMatrixWorld(true);
  // in the box's own frame: x across it (-x its left side), y along it
  // (+y to the wall), z out of its face (up)
  const yL = V(0, 1, place.tilt).normalize(), zL = V(-1, 0, 0), xL = yL.clone().cross(zL);
  const w = poseOf(carton.matrixWorld.clone().multiply(new THREE.Matrix4().makeBasis(xL, yL, zL).setPosition(V(-BW / 2 - 0.03, place.y, place.z))));
  hand.root.position.copy(w.pos);
  hand.root.quaternion.copy(w.quat);
  hand.setPose(OPEN);
  // in until the palm all but touches the side, no further
  const inward = V(1, 0, 0).transformDirection(carton.matrixWorld);
  const gap = () => (hand.root.updateMatrixWorld(true), Math.min(...hand.palmPoints().map(([q, r]) => solid(q) - r)));
  for (let i = 0; i < 80 && gap() > 0.004; i++) hand.root.position.addScaledVector(inward, 0.0005);
  for (let i = 0; i < 80 && gap() < 0.0025; i++) hand.root.position.addScaledVector(inward, -0.0005);
  const local = (p) => carton.worldToLocal(p.clone());
  const onSide = (r) => (p) => {
    const q = local(p);
    return carton.localToWorld(V(-BW / 2 - r * 0.8, clamp(q.y, -BH / 2 + 0.01, BH / 2 - 0.01), clamp(q.z, -BD / 2 + 0.008, BD / 2 - 0.008)));
  };
  const onTop = (r) => (p) => {
    const q = local(p);
    return carton.localToWorld(V(clamp(q.x, -BW / 2 + 0.012, -BW / 2 + 0.05), clamp(q.y, -BH / 2 + 0.01, BH / 2 - 0.01), BD / 2 + r * 0.8));
  };
  const side = V(-1, 0, 0).transformDirection(carton.matrixWorld);
  const top = V(0, 0, 1).transformDirection(carton.matrixWorld);
  const miss = {};
  for (const n of ["index", "middle", "ring", "little"]) miss[n] = hand.reach(n, onSide(hand.digits[n].r), solid, side);
  miss.thumb = hand.reach("thumb", onTop(hand.digits.thumb.r), solid, top);
  return miss;
}

/* ---------------- the stage ---------------- */

function start(kind) {
  const canvas = root.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // (keeps pastel colours true; filmic curves turn them grey and yellow)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // the room: a warm cream wall and pale floorboards
  const wallMat = tone(soft("#f6efe8", { roughness: 0.95, sheen: 0 }), "#f6efe8", "#2a2622");
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat);
  wall.position.set(0, 4, -0.62);
  wall.receiveShadow = true;
  scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), tone(soft("#ffffff", { roughness: 0.8, sheen: 0, map: floorTexture() }), "#ffffff", "#5b534c"));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 5);
  floor.receiveShadow = true;
  scene.add(floor);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.03), tone(soft("#fcfaf6"), "#fcfaf6", "#35302b"));
  skirting.position.set(0, 0.06, -0.605);
  scene.add(skirting);

  // soft daylight: a sky-and-floor fill, a warm window light with soft
  // shadows, and a cool light from behind for edges
  const hemi = new THREE.HemisphereLight("#fffaf5", "#efe2d6", 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff3e6", 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight("#ece6ff", 0.55);
  scene.add(rim, rim.target);

  // your eye
  const camera = new THREE.PerspectiveCamera(44, 1, 0.03, 40);
  scene.add(camera);
  // a veil over the view, for the one scene that fades between loops
  const veilMat = new THREE.MeshBasicMaterial({ color: "#f6efe8", transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veilMat);
  veil.position.z = -0.1;
  veil.renderOrder = 10;
  veil.visible = false;
  camera.add(veil);

  /* ---------- the phone ---------- */
  // 72 x 147 x 8 mm in a lilac case. The screen is dark, with the camera's
  // 3:4 picture across its upper part and the shutter below it.
  const PW = 0.072, PH = 0.147, PD = 0.008;
  const phone = new THREE.Group();
  scene.add(phone);
  part(phone, PW, PH, PD, 0, 0, 0, tone(soft("#cdc6ee", { roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.3 }), "#cdc6ee", "#8b84b4"), 0.0095);
  // the camera bump: top left seen from the back, so behind the screen's top right
  const bumpX = PW / 2 - 0.019, bumpY = PH / 2 - 0.019;
  part(phone, 0.028, 0.028, 0.003, bumpX, bumpY, -PD / 2 - 0.0012, tone(soft("#bdb5e4", { roughness: 0.3, clearcoat: 1 }), "#bdb5e4", "#7d76a6"), 0.007);
  for (const [dx, dy] of [[-0.0055, 0.0055], [0.0055, -0.0055]]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 24), new THREE.MeshPhysicalMaterial({ color: "#1b1d22", roughness: 0.12, clearcoat: 1 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(bumpX + dx, bumpY + dy, -PD / 2 - 0.003);
    phone.add(lens);
  }
  const SW = PW - 0.0045, SH = PH - 0.0045;
  const FACE = PD / 2 + 0.0003;
  const glass = new THREE.Mesh(roundedRect(SW, SH, 0.0078), new THREE.MeshBasicMaterial({ color: 0x101114 }));
  glass.position.z = FACE;
  phone.add(glass);
  // the preview: 3:4, from just under the top bar
  const VW = SW, VH = (SW * 4) / 3;
  const VY = SH / 2 - 0.013 - VH / 2;
  // (three draws into a target in linear light, untoned; the screen tones
  // it with the rest of the picture, so the two match)
  const viewTarget = new THREE.WebGLRenderTarget(300, 400, { samples: 4, type: THREE.HalfFloatType });
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
  const LENS = V(bumpX, bumpY, -PD / 2 - 0.003);
  const phoneCam = new THREE.PerspectiveCamera(67, 3 / 4, 0.02, 30);
  phoneCam.position.copy(LENS);
  phone.add(phoneCam);

  /* ---------- your hands and arms ---------- */
  const kit = { skin: SKIN(), nail: NAIL(), sleeve: SLEEVE() };
  const hand = makeHand("right", kit.skin, kit.nail);
  phone.updateMatrixWorld(true);
  const grip = gripPhone(hand, phone, { PW, PH, PD, FACE, SHUTTER });
  const rightArm = arm(scene, kit.skin, kit.sleeve);
  const set = (SCENES[kind] ?? SCENES.fridge)(scene, kit);
  const LOOP = set.loop;
  const B = set.beats;
  const sec = (s) => s / LOOP;
  key.position.copy(set.light.at).add(V(-2.4, 4.6, 3.2));
  key.target.position.copy(set.light.at);
  Object.assign(key.shadow.camera, { left: -set.light.size, right: set.light.size, top: set.light.size, bottom: -set.light.size, near: 0.5, far: 14 });
  key.shadow.camera.updateProjectionMatrix();
  rim.position.copy(set.light.at).add(V(2.2, 2.4, -3));
  rim.target.position.copy(set.light.at);

  /* ---------- theme ---------- */
  function applyTheme(d) {
    for (const [m, light, dark] of themed) m.color.set(d ? dark : light);
    hemi.intensity = d ? 0.3 : 0.5;
    hemi.color.set(d ? "#8c8199" : "#fffaf5");
    hemi.groundColor.set(d ? "#2b2622" : "#efe2d6");
    key.intensity = d ? 0.8 : 2.7;
    key.color.set(d ? "#c3cde6" : "#fff3e6");
    rim.intensity = d ? 0.3 : 0.7;
    scene.environmentIntensity = d ? 0.3 : 0.42;
    renderer.toneMappingExposure = d ? 1.1 : 0.96;
    veilMat.color.set(d ? "#2a2622" : "#f6efe8");
    set.theme?.(d);
    if (!running) draw(shown);
  }

  /* ---------- size ---------- */
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = set.fov ?? 44;
    camera.updateProjectionMatrix();
    if (!running) draw(shown);
  }

  /* ---------- your view of the world ---------- */
  const tmp = V(0, 0, 0);
  const view = {
    right: V(1, 0, 0),
    ahead: V(0, 0, -1),
    // a point on the picture (sx, sy run -1..1), `d` metres ahead of your eye
    at(sx, sy, d) {
      tmp.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
      const fwd = camera.getWorldDirection(V(0, 0, 0));
      return camera.position.clone().add(tmp.multiplyScalar(d / tmp.dot(fwd)));
    },
    // your shoulders: level, a little ahead of your eye and below it, out of
    // the picture (side 1 your right, -1 your left)
    // (a scene where you stand at a worktop says where your shoulders are
    // outright: leaning over it, your head is ahead of them)
    shoulder(side) {
      if (set.shoulders) return set.shoulders(side);
      const b = set.body ?? { side: 0.18, ahead: 0.06, down: 0.26 };
      return camera.position.clone().addScaledVector(this.right, side * b.side).addScaledVector(this.ahead, b.ahead).add(V(0, -b.down, 0));
    },
  };

  /* ---------- the phone's movement ---------- */
  // up along an arc (an overshoot, then it settles), its turn a moment
  // behind; two small corrections as you line the shot up, each smaller
  // than the last; never quite still, steadier as the photo's taken; and
  // the press of the thumb pushes it back a touch
  function phoneMotion(t, P) {
    const D = B.raise[1] - B.raise[0];
    let pos, kq;
    if (t < B.lower[0]) {
      pos = arc(P.rest.pos, P.up, P.held.pos, settle((t - B.raise[0]) / D));
      kq = clamp01(settle((t - B.raise[0] - D * 0.14) / D));
    } else {
      pos = arc(P.held.pos, P.down, P.rest.pos, span(t, B.lower[0], B.lower[1]));
      kq = 1 - span(t, B.lower[0] + D * 0.05, B.lower[1] + D * 0.02);
    }
    const quat = P.rest.quat.clone().slerp(P.held.quat, kq);
    const f = (t - B.frame[0]) / (B.frame[1] - B.frame[0]);
    const fix = f > 0 && f < 1 ? Math.sin(TAU * 1.5 * f) * (1 - f) ** 2 * smoother(f * 3) : 0;
    const steady = 1 - 0.65 * bump(t, B.tap, B.tap - B.frame[1] + sec(0.3));
    pos.addScaledVector(view.right, (0.0016 * wave(t, 3, 0.1) + 0.0007 * wave(t, 7, 0.55)) * steady + 0.007 * fix);
    pos.y += (0.0012 * wave(t, 4, 0.3) + 0.0006 * wave(t, 9, 0.8)) * steady + 0.004 * fix;
    quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.012 * wave(t, 5, 0.2) * steady + 0.02 * fix, 0.01 * wave(t, 4, 0.65) * steady - 0.03 * fix, 0.006 * wave(t, 3, 0.4) * steady)));
    const press = bump(t, B.tap + sec(0.03), sec(0.12));
    pos.addScaledVector(V(0, 0, -1).applyQuaternion(quat), 0.0018 * press);
    quat.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.014 * press));
    return { pos, quat };
  }
  // the thumb: resting over the glass, lifted just before, then pressing
  function thumbAt(t) {
    const T = B.tap, g = grip.poses;
    if (t < T - sec(0.13)) return grip.thumb(g.hover, g.lifted, span(t, T - sec(0.55), T - sec(0.13)));
    if (t < T + sec(0.1)) return grip.thumb(g.lifted, g.press, span(t, T - sec(0.13), T - sec(0.01)));
    grip.thumb(g.press, g.hover, span(t, T + sec(0.1), T + sec(0.5)));
  }

  /* ---------- drawing one moment ---------- */
  let shown = (reduce ? set.still : 0) * LOOP;
  const shoulder = V(0, 0, 0), wristAt = V(0, 0, 0), elbowAt = V(0, 0, 0);
  function draw(seconds) {
    shown = seconds;
    const t = (((seconds % LOOP) + LOOP) % LOOP) / LOOP;
    const eye = set.eye(t);
    camera.position.copy(eye.pos);
    camera.lookAt(eye.look);
    camera.updateMatrixWorld(true);
    view.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    camera.getWorldDirection(view.ahead).setY(0).normalize();
    set.update(t, view);
    const p = phoneMotion(t, set.phone(t, view));
    // (the lens, not the middle of the phone, is what's on that spot)
    phone.quaternion.copy(p.quat);
    phone.position.copy(p.pos).sub(LENS.clone().applyQuaternion(p.quat));
    thumbAt(t);
    phone.updateMatrixWorld(true);
    shoulder.copy(view.shoulder(1));
    hand.root.getWorldPosition(wristAt);
    elbowAt.copy(rightArm.reach(shoulder, wristAt, set.elbow ?? V(0.75, -1, 0.2)));
    // the flash (all at once, then fading), the shutter going in, the tick
    const f = (t - B.tap) / sec(0.5);
    flashMat.opacity = f >= 0 && f < 1 ? 0.85 * (1 - f) ** 2 : 0;
    shutter.scale.setScalar(1 - 0.16 * bump(t, B.tap + sec(0.04), sec(0.1)));
    const k = span(t, B.tap + sec(0.32), B.tap + sec(0.55)) * (1 - span(t, B.tap + sec(1.6), B.tap + sec(1.95)));
    tickMat.opacity = k;
    tick.scale.setScalar(0.55 + 0.45 * settle((t - B.tap - sec(0.32)) / sec(0.4)));
    const fade = set.fade ? set.fade(t) : 1;
    veil.visible = fade < 1;
    veilMat.opacity = 1 - fade;
    // what the phone sees (without itself, its hand, or the veil)
    phone.visible = false;
    const veiled = veil.visible;
    veil.visible = false;
    renderer.setRenderTarget(viewTarget);
    renderer.render(scene, phoneCam);
    renderer.setRenderTarget(null);
    phone.visible = true;
    veil.visible = veiled;
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
      toggle.setAttribute("aria-label", p ? t("Play the animation") : t("Pause the animation"));
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
  const hold = (t) => {
    setPaused(true);
    draw(t * LOOP);
  };
  const corner8 = (obj, w, h, d) => {
    const out = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(obj.localToWorld(V((x * w) / 2, (y * h) / 2, (z * d) / 2)).toArray());
    return out;
  };
  window.__scanGuide = {
    at: hold,
    play: () => setPaused(false),
    loop: LOOP,
    beats: B,
    still: set.still,
    // how far each fingertip and the thumb ended from where it was reaching
    miss: { ...grip.miss, ...(set.miss ? { left: set.miss } : {}) },
    // where the arms, hands and phone are at moment t, for the clipping checks
    pose(t) {
      hold(t);
      hand.root.updateMatrixWorld(true);
      return {
        shoulder: shoulder.toArray(),
        elbow: elbowAt.toArray(),
        wrist: wristAt.toArray(),
        handAxis: V(0, 1, 0).transformDirection(hand.root.matrixWorld).toArray(),
        hand: hand.points().map(([q, r]) => [...q.toArray(), r]),
        phone: corner8(phone, PW, PH, PD),
        extra: set.pose?.() ?? null,
        // where those fall on the picture (-1..1 across it and up it)
        camera: { pos: camera.position.toArray(), quat: camera.quaternion.toArray(), fov: camera.fov, aspect: camera.aspect },
      };
    },
    // the same moment, seen from close to the phone (offsets in its frame)
    inspect(t, dx = 0.05, dy = 0.03, dz = 0.28) {
      hold(t);
      camera.position.copy(phone.localToWorld(V(dx, dy, dz)));
      camera.up.copy(V(0, 1, 0).transformDirection(phone.matrixWorld));
      camera.lookAt(phone.localToWorld(V(0, -0.02, 0)));
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      camera.up.set(0, 1, 0);
    },
    // the same moment from anywhere ([x, y, z] in metres)
    view(t, from, to) {
      hold(t);
      camera.position.set(...from);
      camera.lookAt(...to);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
    },
  };
}

/* ---------------- the scenes ---------------- */

// Each scene builds its set and says:
//   loop, beats       its length in seconds, and when (0..1) the phone is
//                     raised, lined up, tapped and lowered
//   still             the moment shown for reduced motion
//   light             where the window light falls { at, size }
//   eye(t)            where your eye is and what it looks at
//   phone(t, view)    the phone's resting and held poses { pos, quat } (pos
//                     is its lens), and the bends of its paths up and down
//   update(t, view)   anything else that moves
const SCENES = { fridge: fridgeScene, receipt: receiptScene, barcode: barcodeScene };

// the usual rhythm: rest, raise, line up, hold, tap, tick, lower, rest
function rhythm(loop, from) {
  const s = (x) => x / loop;
  return { raise: [s(from), s(from + 1.45)], frame: [s(from + 1.45), s(from + 2.4)], tap: s(from + 2.95), lower: [s(from + 4.95), s(from + 6.35)] };
}

// the phone resting low in your hand, screen up, mostly out of the picture
function restingPhone(view, sx, sy, d) {
  const pos = view.at(sx, sy, d);
  return { pos, quat: aim(pos, pos.clone().add(V(0.05, -1, -0.4)), V(0.35, 0.2, -1)) };
}
// at the worktop, the phone rests in your hand just in front of its edge,
// below the picture, screen up and tipped towards you
function worktopRest(top) {
  const pos = V(0.25, top + 0.075, 0.2);
  return { pos, quat: aim(pos, pos.clone().add(V(0.05, -1, -0.45)), V(0.3, 0.15, -1)) };
}
// held level over something, looking straight down, its top to the wall
function overhead(lens) {
  return { pos: lens, quat: aim(lens, lens.clone().add(V(0, -1, 0)), V(0, 0, -1)) };
}

// The worktop scenes' kitchen: cream cupboards with soft brass handles, a
// pale sage terrazzo worktop and peach tiles behind it.
function kitchenBench(scene) {
  const top = 0.92;
  const g = new THREE.Group();
  scene.add(g);
  const paint = tone(soft("#f3ede4", { roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.5 }), "#f3ede4", "#3a3530");
  const stone = tone(soft("#ffffff", { roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0, map: terrazzoTexture() }), "#ffffff", "#5f6a64");
  const brass = new THREE.MeshPhysicalMaterial({ color: "#dcc294", metalness: 0.7, roughness: 0.32 });
  part(g, 3.6, 0.1, 0.54, 0, 0.05, -0.35, tone(soft("#e5ded3"), "#e5ded3", "#2c2824"), 0.01);
  part(g, 3.6, 0.8, 0.6, 0, 0.5, -0.32, paint, 0.012);
  for (const x of [-1.35, -0.45, 0.45, 1.35]) {
    part(g, 0.86, 0.74, 0.018, x, 0.5, -0.011, paint, 0.006);
    capsule(g, V(x - 0.11, 0.8, 0.006), V(x + 0.11, 0.8, 0.006), 0.0075, brass);
  }
  part(g, 3.7, 0.04, 0.68, 0, top - 0.02, -0.28, stone, 0.008);
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.62), tone(soft("#ffffff", { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0, map: tileTexture() }), "#ffffff", "#5c534d"));
  tiles.position.set(0, top + 0.31, -0.615);
  tiles.receiveShadow = true;
  g.add(tiles);
  return { top };
}

// The kitchen draws its models about twice life size, for legibility on its
// shelves; on the worktop they're life size (a milk carton 26 cm tall).
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
  return holder;
}

// The fridge: your kitchen's double-door fridge, in mint, at true size (1.9
// m tall), doors open, stocked a little. You stand a couple of metres back
// with the phone up until the whole fridge fits the frame.
function fridgeScene(scene) {
  const fridge = new THREE.Group();
  scene.add(fridge);
  // the kitchen draws it oversized for legibility; here it's 0.62 of that
  const S = 0.62;
  fridge.scale.setScalar(S);
  const W = 1.9, H = 2.85, D = 0.95, T = 0.07, FOOT = 0.14;
  fridge.position.z = -0.62 + D * S + 0.03;
  const body = tone(soft("#c4e0cf", { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0 }), "#c4e0cf", "#557463");
  const liner = soft("#fbfbf9", { roughness: 0.6, sheen: 0, emissive: "#fff6e6", emissiveIntensity: 0 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#e6f3ef", roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false });
  part(fridge, W + 2 * T, T, D, 0, FOOT + H + T / 2, -D / 2, body, 0.03);
  part(fridge, W + 2 * T, T, D, 0, FOOT + T / 2, -D / 2, body, 0.03);
  part(fridge, T, H + 2 * T, D, -W / 2 - T / 2, FOOT + H / 2 + T, -D / 2, body, 0.03);
  part(fridge, T, H + 2 * T, D, W / 2 + T / 2, FOOT + H / 2 + T, -D / 2, body, 0.03);
  part(fridge, W, H, T, 0, FOOT + T + H / 2, -D + T / 2, liner, 0.02);
  part(fridge, 0.02, H, D - T, -W / 2 + 0.01, FOOT + T + H / 2, -D / 2 - T / 2, liner, 0.005);
  part(fridge, 0.02, H, D - T, W / 2 - 0.01, FOOT + T + H / 2, -D / 2 - T / 2, liner, 0.005);
  part(fridge, W + 2 * T - 0.04, FOOT, D - 0.12, 0, FOOT / 2, -D / 2 - 0.04, tone(soft("#b9bfc2", { metalness: 0.3, roughness: 0.5 }), "#b9bfc2", "#4a4f52"), 0.02);
  const SHELVES = [FOOT + T + 0.62, FOOT + T + 1.3, FOOT + T + 1.98];
  for (const y of SHELVES) part(fridge, W - 0.04, 0.02, D - T - 0.06, 0, y - 0.01, -D / 2, glass, 0.005);
  const crisper = part(fridge, W - 0.08, 0.5, 0.03, 0, FOOT + T + 0.25, -0.08, new THREE.MeshPhysicalMaterial({ color: "#eaf5f1", roughness: 0.1, transparent: true, opacity: 0.2, depthWrite: false }), 0.012);
  crisper.castShadow = false;
  // a few things on each shelf: the kitchen's own models, at kitchen scale
  const rows = [
    [SHELVES[2] + 0.002, [["milk", { label: "Milk", colour: "#7fa9d6" }], ["juice", { label: "Orange juice", colour: "#f3b860" }], ["herbs", { variant: "lobed", label: "Coriander" }], ["tub", { variant: "big", label: "Yoghurt", colour: "#7fa9d6" }]]],
    [SHELVES[1] + 0.002, [["eggs", {}], ["cheese", { variant: "block", label: "Cheddar" }], ["butter", { label: "Butter" }], ["cheese", { variant: "wedge", label: "Parmesan" }]]],
    [SHELVES[0] + 0.002, [["tray", { variant: "mince", label: "Beef mince" }], ["tray", { variant: "salmon", label: "Salmon" }], ["tray", { variant: "breast", label: "Chicken" }]]],
    [FOOT + T + 0.005, [["tomato", {}], ["carrot", {}], ["broccoli", {}], ["citrus", { variant: "lemon" }], ["capsicum", { colour: "#e8786e" }]]],
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
  const bulb = new THREE.PointLight("#ffeccc", 0.8, 4.2, 1.6);
  bulb.position.set(0, FOOT + T + H - 0.3, -D * 0.4);
  fridge.add(bulb);
  // the doors stand open
  const doorW = W / 2 + T;
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * (W / 2 + T), FOOT, 0);
    hinge.rotation.y = s * 1.85;
    fridge.add(hinge);
    const slab = new THREE.Group();
    slab.position.set((-s * doorW) / 2, 0, 0.08);
    hinge.add(slab);
    part(slab, doorW - 0.01, H + 2 * T, 0.06, 0, (H + 2 * T) / 2, 0.05, body, 0.03);
    part(slab, doorW - 0.1, H + 2 * T - 0.1, 0.1, 0, (H + 2 * T) / 2, -0.03, liner, 0.04);
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 1.5, 6, 16), new THREE.MeshPhysicalMaterial({ color: "#d6d9db", metalness: 0.9, roughness: 0.2 }));
    bar.position.set(-s * (doorW / 2 - 0.12), FOOT + H * 0.55, 0.16);
    slab.add(bar);
    for (const yy of [0.82, 1.52, 2.22]) part(slab, doorW - 0.24, 0.2, 0.02, 0, yy + 0.1, -0.31, new THREE.MeshPhysicalMaterial({ color: "#eaf5f1", roughness: 0.1, transparent: true, opacity: 0.4, depthWrite: false }), 0.008);
  }
  const front = fridge.position.z + 0.1;
  const middle = V(0, 0.98, fridge.position.z - 0.3);
  const loop = 9;
  const beats = rhythm(loop, 0.7);
  return {
    loop,
    beats,
    still: beats.tap + 0.75 / loop,
    fov: 42,
    light: { at: V(0, 0.9, 0), size: 1.8 },
    theme(d) {
      bulb.intensity = d ? 5 : 0.8;
      liner.emissiveIntensity = d ? 0.25 : 0;
    },
    // about 2.7 m back at eye height, breathing; the fridge left of middle,
    // the phone held up to its right, so you see both
    eye: (t) => ({ pos: V(0.36, 1.62 + 0.002 * wave(t, 2, 0.1), front + 2.7), look: V(0.16, 1.03, front) }),
    phone(t, view) {
      const held = view.at(0.36, -0.14, 0.44);
      const rest = restingPhone(view, 0.7, -1.38, 0.4);
      return {
        rest,
        held: { pos: held, quat: aim(held, middle, UP) },
        up: view.at(0.72, -0.5, 0.37),
        down: view.at(0.55, -0.9, 0.47),
      };
    },
    update() {},
  };
}

// The receipt: flat on the worktop in front of you, the phone held level
// about 24 cm over it, looking straight down with its top to the wall, so
// the receipt runs the length of the picture.
function receiptScene(scene) {
  const { top } = kitchenBench(scene);
  const [TW, TH] = RECEIPT_TEXTURE;
  const R_W = 0.08, R_L = (R_W * TH) / TW;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(R_W, R_L, 6, 48), new THREE.MeshStandardMaterial({ map: receiptTexture(), roughness: 0.82, alphaTest: 0.5, side: THREE.DoubleSide }));
  // thermal paper keeps the curl of its roll: the far end lifts, the near
  // end a little, and it cups very slightly across
  const pos = paper.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const far = Math.max(0, (y - R_L * 0.28) / (R_L * 0.22)) ** 2 * 0.008;
    const near = Math.max(0, (-y - R_L * 0.4) / (R_L * 0.1)) ** 2 * 0.0018;
    pos.setZ(i, far + near + 0.0007 * (x / (R_W / 2)) ** 2 + 0.0004 * Math.sin(y * 40));
  }
  paper.geometry.computeVertexNormals();
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = 0.06;
  const RX = -0.035, RZ = -0.17;
  paper.position.set(RX, top + 0.0006, RZ);
  paper.castShadow = true;
  paper.receiveShadow = true;
  scene.add(paper);
  // what's just been unpacked, kept to the sides
  place(scene, "milk", { label: "Milk", colour: "#8fb6df" }, 0.33, top, -0.46, -0.3);
  place(scene, "can", { label: "Tomatoes", colour: "#ef9d8c" }, -0.36, top, -0.47, 0.25);
  place(scene, "banana", { colour: "#f4dc84" }, -0.34, top, -0.2, 0.55);
  const loop = 9;
  const beats = rhythm(loop, 0.7);
  return {
    loop,
    beats,
    still: beats.tap + 0.75 / loop,
    fov: 40,
    shoulders: (side) => V(0.1 + side * 0.19, 1.36, 0.22),
    elbow: V(0.9, -0.6, 0.3),
    light: { at: V(0, top, -0.15), size: 0.75 },
    // standing at the worktop, looking down at it
    eye: (t) => ({ pos: V(0.1, 1.55 + 0.002 * wave(t, 2, 0.1), 0.16), look: V(-0.035, top, -0.21) }),
    phone(t, view) {
      const held = overhead(V(RX, top + 0.22, RZ + 0.006));
      const rest = worktopRest(top);
      return {
        rest,
        held,
        up: rest.pos.clone().lerp(held.pos, 0.55).add(V(0.02, 0.07, 0.02)),
        down: rest.pos.clone().lerp(held.pos, 0.5).add(V(0.03, -0.02, 0.03)),
      };
    },
    update() {},
  };
}

// The barcode: a cereal box lies face up on the worktop. Your left hand
// takes its left edge, thumb on top and fingertips against the side, tips
// it up past standing on its right side, and lets it fall over onto its
// front. Your hand goes back to rest and the phone comes over the barcode
// on its back. (The box can't turn back over by itself, so this one loop
// fades out and in again.)
function barcodeScene(scene, kit) {
  const { top } = kitchenBench(scene);
  place(scene, "jar", { variant: "jam", label: "Jam", colour: "#ec8f86" }, 0.36, top, -0.48, -0.2);
  place(scene, "bottle", { variant: "sauce", label: "Soy sauce", colour: "#e48a7c" }, 0.5, top, -0.5, -0.1);
  // a 190 x 290 x 70 mm cereal box. It tips over two edges in turn: up
  // about the right-hand edge it lies on until it stands on its side, then
  // over the edge it's standing on, so it never sinks into the worktop.
  const BW = 0.19, BH = 0.29, BD = 0.07;
  const PIVOT = V(-0.1, top, -0.17);
  const first = new THREE.Group();
  first.position.copy(PIVOT);
  scene.add(first);
  const second = new THREE.Group();
  second.position.set(0, BD, 0);
  first.add(second);
  const side = tone(soft("#f3d27a", { roughness: 0.6 }), "#f3d27a", "#8a7643");
  // RoundedBoxGeometry keeps BoxGeometry's face order: +x, -x, +y, -y, +z, -z
  const carton = new THREE.Mesh(new RoundedBoxGeometry(BW, BH, BD, 3, 0.004), [side, side, side, side, soft("#ffffff", { roughness: 0.5, clearcoat: 0.3, sheen: 0, map: cerealFront() }), soft("#ffffff", { roughness: 0.6, clearcoat: 0.2, sheen: 0, map: cerealBack() })]);
  carton.castShadow = true;
  carton.receiveShadow = true;
  // lying face up: its front to the ceiling, its top to the wall
  carton.rotation.x = -Math.PI / 2;
  carton.position.set(-BW / 2, -BD / 2, 0);
  second.add(carton);
  const tip = (theta) => {
    first.rotation.z = -Math.min(theta, Math.PI / 2);
    second.rotation.z = -Math.max(0, theta - Math.PI / 2);
    first.updateMatrixWorld(true);
  };
  const half = V(BW / 2, BH / 2, BD / 2);
  const solid = (p) => Math.min(boxDistance(carton.worldToLocal(p.clone()), half, 0.004), p.y - top);
  const code = cerealCode();
  // the barcode's centre on the back (local -z), as the texture puts it
  const codeLocal = V((0.5 - code.u) * BW, (0.5 - code.v) * BH, -BD / 2);

  // your left hand, and where it rests: low at your side, out of the
  // picture, fingers relaxed
  const left = makeHand("left", kit.skin, kit.nail);
  scene.add(left.root);
  const leftArm = arm(scene, kit.skin, kit.sleeve);
  const flatOn = (pos, fingers) => {
    const y = fingers.clone().normalize(), z = V(0, 1, 0), x = y.clone().cross(z);
    left.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    left.root.position.copy(pos);
    left.setPose(REST_FLAT);
    left.root.updateMatrixWorld(true);
    const low = Math.min(...left.points().map(([q, r]) => q.y - r));
    left.root.position.y += top + 0.0006 - low;
    left.root.updateMatrixWorld(true);
    return { pos: left.root.position.clone(), quat: left.root.quaternion.clone() };
  };
  flatOn(V(0, 0, 0), V(0.4, 0, -1));
  const REST = { pos: V(-0.22, top + 0.06, 0.34), quat: left.root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.5)) };

  // the grip, worked out with the box lying flat
  tip(0);
  const leftMiss = gripBox(left, carton, { BW, BH, BD }, solid);
  const PINCH = copyPose(left.pose);
  // the thumb lifted 2.5 cm off the face it was hooked over, for letting go
  left.reach("thumb", carton.localToWorld(V(-BW / 2 + 0.03, -0.1, BD / 2 + 0.034)), solid, null);
  const LETTING = copyPose(PINCH);
  LETTING.thumb = left.pose.thumb.slice();
  const gripLocal = carton.matrixWorld.clone().invert().multiply(left.root.matrixWorld);
  const held = (theta) => {
    tip(theta);
    return poseOf(carton.matrixWorld.clone().multiply(gripLocal));
  };
  // stood on its side it would fall back; let go just past the balance
  // point over the far edge (90° + atan(BD / BW) = 110°)
  const LET_GO = Math.PI / 2 + Math.atan(BD / BW) + 0.03;
  const GRIP0 = held(0);
  const GRIPR = held(LET_GO);
  // the way the back of your hand faces as you let go
  const AWAY = V(-1, 0, 0).transformDirection(carton.matrixWorld).add(V(-0.25, 0.35, 0.1)).normalize();
  // the barcode once it's face up, and the phone's lens 15 cm over it
  tip(Math.PI);
  carton.updateMatrixWorld(true);
  const codeUp = carton.localToWorld(codeLocal.clone());
  tip(0);

  const loop = 10.5;
  const s = (x) => x / loop;
  const beats = rhythm(loop, 3.3);
  const T = { reach: [s(0.45), s(1.42)], lift: [s(1.5), s(2.45)], teeter: s(0.2), fall: s(0.44), land: s(0.26), back: [s(2.45), s(3.75)] };
  const leftShoulder = V(0, 0, 0), leftElbow = V(0, 0, 0), leftWrist = V(0, 0, 0);
  let now = 0;
  return {
    loop,
    beats,
    still: beats.tap + 0.75 / loop,
    fov: 40,
    shoulders: (side) => V(0.1 + side * 0.19, 1.36, 0.22),
    elbow: V(0.9, -0.6, 0.3),
    light: { at: V(-0.05, top, -0.15), size: 0.75 },
    miss: leftMiss,
    fade: (t) => span(t, 0, s(0.35)) * (1 - span(t, s(10.1), 1)),
    eye: (t) => ({ pos: V(0.08, 1.55 + 0.002 * wave(t, 2, 0.1), 0.2), look: V(-0.06, top, -0.22) }),
    phone(t, view) {
      const held = overhead(codeUp.clone().add(V(0, 0.15, 0)));
      const rest = worktopRest(top);
      return {
        rest,
        held,
        up: rest.pos.clone().lerp(held.pos, 0.55).add(V(0.02, 0.07, 0.02)),
        down: rest.pos.clone().lerp(held.pos, 0.5).add(V(0.03, -0.02, 0.03)),
      };
    },
    pose: () => {
      const out = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(carton.localToWorld(V((x * BW) / 2, (y * BH) / 2, (z * BD) / 2)).toArray());
      left.root.updateMatrixWorld(true);
      return {
        box: out,
        leftShoulder: leftShoulder.toArray(),
        leftElbow: leftElbow.toArray(),
        leftWrist: leftWrist.toArray(),
        leftAxis: V(0, 1, 0).transformDirection(left.root.matrixWorld).toArray(),
        leftHand: left.points().map(([q, r]) => [...q.toArray(), r]),
        holding: now >= T.reach[1] && now <= T.back[0],
      };
    },
    update(t, view) {
      now = t;
      // the box: lifted by your hand to just past standing, where it hangs a
      // moment, then falls the rest of the way and settles with a bounce
      let theta = LET_GO * span(t, T.lift[0], T.lift[1]);
      // let go just past balance it creeps over, then falls faster and faster
      if (t > T.lift[1]) {
        const u = clamp01((t - T.lift[1]) / (T.teeter + T.fall));
        theta = LET_GO + (Math.PI - LET_GO) * u ** 3;
        const b = (t - T.lift[1] - T.teeter - T.fall) / T.land;
        if (b > 0 && b < 1) theta = Math.PI - 0.06 * Math.sin(Math.PI * b) * (1 - b);
      }
      tip(theta);
      // your left hand: out to the box, slowing as it arrives, turning to
      // face its side on the way; holding it while it's lifted; then up and
      // away as it falls, and back to rest
      let p, fingers;
      if (t < T.reach[0]) {
        p = REST;
        fingers = REST_FLAT;
      } else if (t < T.reach[1]) {
        // over to just off the box's side, already turned to it, then the
        // last few centimetres straight in, slowing to a stop
        const k = span(t, T.reach[0], T.reach[1]);
        const OFF = GRIP0.pos.clone().add(V(-0.06, 0.035, 0));
        const toOff = clamp01(k / 0.78), inn = smoother((k - 0.72) / 0.28);
        const pos = arc3(REST.pos, REST.pos.clone().add(V(-0.02, 0.12, -0.12)), OFF.clone().add(V(-0.05, 0.05, 0.03)), OFF, smoother(toOff));
        p = { pos: pos.lerp(GRIP0.pos, inn), quat: REST.quat.clone().slerp(GRIP0.quat, span(t, T.reach[0] + s(0.05), T.reach[0] + (T.reach[1] - T.reach[0]) * 0.72)) };
        // open on the way, taking the grip's shape just off the box, so the
        // last bit straight in lays them on it
        const shaped = T.reach[0] + (T.reach[1] - T.reach[0]) * 0.72;
        fingers = mixPose(mixPose(REST_FLAT, OPEN, span(t, T.reach[0], T.reach[0] + s(0.45))), PINCH, span(t, shaped - s(0.3), shaped));
      } else if (t <= T.back[0]) {
        p = held(theta);
        // the thumb comes off the face that will fall, before it does
        fingers = mixPose(PINCH, LETTING, span(t, T.lift[1] - s(0.42), T.lift[1] - s(0.05)));
      } else {
        // away along the palm first (off the box, which is falling the
        // other way), then round and down to your side
        const k = span(t, T.back[0], T.back[1]);
        p = {
          pos: arc3(GRIPR.pos, GRIPR.pos.clone().addScaledVector(AWAY, 0.09), REST.pos.clone().add(V(-0.03, 0.16, -0.14)), REST.pos, k),
          quat: GRIPR.quat.clone().slerp(REST.quat, span(t, T.back[0] + s(0.12), T.back[1])),
        };
        // fingers and thumb flat as the palm lifts off (curled, they'd dig
        // in), easing into a loose curl once they're clear of it
        const lifting = { ...copyPose(OPEN), thumb: [0.04, 0.05, -0.36, -0.08, -0.1] };
        fingers = mixPose(mixPose(LETTING, lifting, span(t, T.back[0] + s(0.1), T.back[0] + s(0.32))), LOOSE, span(t, T.back[0] + s(0.48), T.back[0] + s(0.8)));
        fingers = mixPose(fingers, REST_FLAT, span(t, T.back[0] + s(0.85), T.back[1] + s(0.2)));
      }
      // never quite still, except while it's holding the box
      const free = 1 - span(t, T.reach[1] - s(0.3), T.reach[1]) * (1 - span(t, T.back[0], T.back[0] + s(0.3)));
      left.root.position.copy(p.pos).add(V(0.0008 * wave(t, 3, 0.7), 0.0005 * Math.max(0, wave(t, 2, 0.3)), 0.0006 * wave(t, 4, 0.1)).multiplyScalar(free));
      left.root.quaternion.copy(p.quat);
      left.setPose(fingers);
      left.root.updateMatrixWorld(true);
      leftShoulder.copy(view.shoulder(-1));
      left.root.getWorldPosition(leftWrist);
      // the forearm runs on from the hand (a wrist only bends so far), the
      // elbow out to the side to turn the hand over with the box
      const along = V(0, 1, 0).transformDirection(left.root.matrixWorld);
      leftElbow.copy(leftArm.reach(leftShoulder, leftWrist, along.negate().add(V(-0.55, -0.15, 0))));
    },
  };
}
// a hand resting on a surface: fingers loosely curled, their tips down
const REST_FLAT = { index: [0.06, -0.22, -0.5], middle: [0.01, -0.26, -0.55], ring: [-0.04, -0.3, -0.6], little: [-0.1, -0.34, -0.66], thumb: [0.05, 0.05, 0.4, -0.1, -0.12] };

/* ---------------- printed things ---------------- */

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ShapeGeometry(s, 6);
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
    g.arc(64, 64, 60, 0, TAU);
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

// A supermarket's thermal receipt: torn along the cutter's teeth at both
// ends, a faint warmth in the paper, and soft near-black print.
const RECEIPT_TEXTURE = [512, 1400];
function receiptTexture() {
  const [W, H] = RECEIPT_TEXTURE;
  return canvasTexture(W, H, (g) => {
    const r = rng(7);
    g.fillStyle = "#fffdf9";
    g.beginPath();
    g.moveTo(0, 12);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, (x / 8) % 2 ? 3 : 12);
    g.lineTo(W, H - 12);
    for (let x = W; x >= 0; x -= 8) g.lineTo(x, (x / 8) % 2 ? H - 3 : H - 12);
    g.closePath();
    g.fill();
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(190,175,150,${0.025 + r() * 0.045})`;
      g.fillRect(r() * W, 16 + r() * (H - 32), 1 + r() * 3, 1);
    }
    const ink = "rgba(42,40,38,0.9)";
    g.fillStyle = ink;
    g.strokeStyle = ink;
    const mono = (px, w = 500) => `${w} ${px}px ui-monospace, Menlo, Consolas, monospace`;
    const sans = (px, w = 800) => `${w} ${px}px Helvetica, Arial, sans-serif`;
    const row = (a, b, y) => {
      g.textAlign = "left";
      g.fillText(a, 30, y);
      g.textAlign = "right";
      g.fillText(b, W - 30, y);
    };
    const rule = (y) => {
      g.save();
      g.setLineDash([10, 7]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(28, y);
      g.lineTo(W - 28, y);
      g.stroke();
      g.restore();
    };
    g.textAlign = "center";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(W / 2, 80, 30, 0, TAU);
    g.stroke();
    g.font = sans(28);
    g.fillText("FM", W / 2, 90);
    g.font = sans(44);
    g.fillText("FRESH MARKET", W / 2, 162);
    g.font = mono(22);
    g.fillText("12 High St, Braddon", W / 2, 198);
    g.fillText("ABN 51 824 753 556", W / 2, 228);
    g.font = mono(24, 700);
    g.fillText("TAX INVOICE", W / 2, 274);
    g.font = mono(22);
    g.fillText("07/11/2026  17:42   #0193", W / 2, 306);
    rule(334);
    const items = [["MILK 2L", "3.39"], ["FREE RANGE EGGS 12", "6.70"], ["BANANAS", "", "  0.86kg @ 3.50/kg", "3.01"], ["OLIVE OIL 750ML", "11.00"], ["TOMATOES DICED", "", "  2 @ 1.20", "2.40"], ["PEANUT BUTTER", "4.50"], ["SPAGHETTI 500G", "2.00"], ["CHEDDAR 500G", "6.50"], ["BABY SPINACH", "3.00"], ["SOURDOUGH LOAF", "6.00"]];
    let y = 380;
    g.font = mono(25);
    for (const [name, price, sub, subPrice] of items) {
      if (sub) {
        g.textAlign = "left";
        g.fillText(name, 30, y);
        y += 32;
        row(sub, subPrice, y);
      } else row(name, price, y);
      y += 40;
    }
    rule(y - 14);
    y += 28;
    row("SUBTOTAL", "48.50", y);
    y += 36;
    row("GST INCLUDED", "1.42", y);
    y += 54;
    g.font = mono(36, 800);
    row("TOTAL", "$48.50", y);
    y += 52;
    g.font = mono(23);
    row("EFTPOS  **** 4821", "APPROVED", y);
    rule(y + 28);
    y += 62;
    let x = 64;
    while (x < W - 64) {
      const bw = 2 + Math.floor(r() * 3) * 2;
      g.fillRect(x, y, bw, 90);
      x += bw + 2 + Math.floor(r() * 3) * 2;
    }
    g.textAlign = "center";
    g.font = mono(22);
    g.fillText("Thank you for shopping with us", W / 2, y + 138);
  });
}

function cerealFront() {
  return canvasTexture(380, 580, (g, w, h) => {
    g.fillStyle = "#f6dc8c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ef9a85";
    g.beginPath();
    g.ellipse(w / 2, 128, 162, 86, -0.08, 0, TAU);
    g.fill();
    g.fillStyle = "#fffaf0";
    g.textAlign = "center";
    g.font = "900 66px Helvetica, Arial, sans-serif";
    g.fillText("OAT", w / 2, 120);
    g.font = "900 46px Helvetica, Arial, sans-serif";
    g.fillText("CRUNCH", w / 2, 170);
    // a bowl of cereal
    g.fillStyle = "#bcd9e8";
    g.beginPath();
    g.moveTo(w / 2 - 140, 400);
    g.quadraticCurveTo(w / 2, 560, w / 2 + 140, 400);
    g.fill();
    for (let i = 0; i < 30; i++) {
      g.fillStyle = i % 2 ? "#d9a35e" : "#e8bb78";
      g.beginPath();
      g.arc(w / 2 - 120 + ((i * 37) % 240), 392 + ((i * 13) % 20), 11, 0, TAU);
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
    g.fillStyle = "#faefd2";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#8a6c45";
    g.font = "700 24px Helvetica, Arial, sans-serif";
    g.fillText("Nutrition information", 24, 52);
    g.fillStyle = "rgba(138,108,69,0.3)";
    for (let i = 0; i < 9; i++) g.fillRect(24, 76 + i * 26, w - 48 - (i % 3) * 46, 11);
    g.fillStyle = "rgba(138,108,69,0.55)";
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

// pale floorboards
function floorTexture() {
  const t = canvasTexture(512, 512, (g) => {
    g.fillStyle = "#e3d5c3";
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 64) {
      const off = (y / 64) % 2 ? 150 : 0;
      for (let x = -off; x < 512; x += 310) {
        const tone = 240 + ((x * 7 + y * 3) % 10);
        g.fillStyle = `rgb(${tone}, ${tone - 12}, ${tone - 26})`;
        g.fillRect(x, y, 308, 62);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 6);
  return t;
}

// pale sage terrazzo: chips of white, peach, sage and lilac in the stone
function terrazzoTexture() {
  const t = canvasTexture(1024, 1024, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = "#cfe2d5";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 50; i++) {
      const x = r() * w, y = r() * h, rad = 60 + r() * 140;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.06})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const chips = ["#ffffff", "#ffffff", "#f6dccb", "#c3d9cb", "#e8e1f4", "#f2e5c3", "#b9cfc1"];
    for (let i = 0; i < 1700; i++) {
      const x = r() * w, y = r() * h, rad = 1.5 + r() ** 2 * 7, sides = 3 + Math.floor(r() * 4), rot = r() * TAU;
      g.fillStyle = chips[Math.floor(r() * chips.length)];
      g.beginPath();
      for (let k = 0; k < sides; k++) {
        const a = rot + (k / sides) * TAU, rr = rad * (0.7 + r() * 0.5);
        k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 1.1);
  return t;
}

// peach subway tiles with white grout
function tileTexture() {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const r = rng(3);
    g.fillStyle = "#fcf9f5";
    g.fillRect(0, 0, w, h);
    const tw = 128, th = 64, gap = 5;
    for (let row = 0; row < h / th; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -off; x < w; x += tw) {
        const c = 238 + Math.floor(r() * 7);
        const grad = g.createLinearGradient(0, row * th, 0, row * th + th);
        grad.addColorStop(0, `rgb(${c + 9}, ${c - 8}, ${c - 20})`);
        grad.addColorStop(1, `rgb(${c + 2}, ${c - 16}, ${c - 28})`);
        g.fillStyle = grad;
        g.beginPath();
        g.roundRect(x + gap / 2, row * th + gap / 2, tw - gap, th - gap, 6);
        g.fill();
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6.2, 1.03);
  return t;
}
