// The live globe: a pastel Earth built from Natural Earth coastlines, with a
// little steaming pan wherever someone is cooking right now. Drag to spin,
// scroll or pinch to zoom, click a pan to open its card. Progressive: the
// page lists every session without this script.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RADIUS = 1;
const root = document.querySelector("[data-globe]");
const data = JSON.parse(document.getElementById("globe-data")?.textContent ?? "[]");

if (root && hasWebGL()) start();

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function latLngToVec(lat, lng, r = RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function start() {
  const canvas = root.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 5.2);

  // lights: a warm key from the upper left, a cool fill, soft ambient
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0xdfe8f5, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e2, 1.6);
  sun.position.set(-3, 2.2, 3.5);
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);

  /* ---------- earth ---------- */
  const mask = new THREE.TextureLoader().load(root.dataset.mask, () => (needsRender = true));
  mask.colorSpace = THREE.NoColorSpace;
  mask.anisotropy = renderer.capabilities.getMaxAnisotropy();
  mask.wrapS = THREE.RepeatWrapping;

  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uSun: { value: sun.position.clone().normalize() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform vec3 uSun;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      // colours are authored in sRGB (what a designer would pick) and
      // converted to linear for lighting
      vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

      vec3 ramp(float lat, float n, float inland) {
        // pastel biomes by latitude: mint tropics, sage temperate, peachy
        // deserts, lilac-grey tundra, soft snow caps
        vec3 snow   = srgb(vec3(0.97, 0.97, 0.99));
        vec3 tundra = srgb(vec3(0.82, 0.84, 0.90));
        vec3 sage   = srgb(vec3(0.58, 0.78, 0.62));
        vec3 mint   = srgb(vec3(0.48, 0.80, 0.64));
        vec3 forest = srgb(vec3(0.42, 0.70, 0.55));
        vec3 sand   = srgb(vec3(0.98, 0.84, 0.62));
        vec3 peach  = srgb(vec3(0.99, 0.74, 0.62));
        float a = abs(lat);
        vec3 c = mix(mint, forest, n * 0.6);
        c = mix(c, sage, smoothstep(0.18, 0.45, a));
        // drier interiors around the subtropics turn sandy and peachy
        float dry = smoothstep(0.12, 0.24, a) * (1.0 - smoothstep(0.38, 0.50, a));
        c = mix(c, mix(sand, peach, smoothstep(0.35, 0.75, n)), dry * smoothstep(0.08, 0.55, inland) * 0.95);
        c = mix(c, tundra, smoothstep(0.62, 0.72, a));
        c = mix(c, snow, smoothstep(0.75, 0.84, a));
        return c * (0.92 + n * 0.14);
      }

      void main() {
        vec4 m = texture2D(uMask, vUv);
        float land = smoothstep(0.38, 0.62, m.r);
        float dist = (m.g - 0.5) * 2.0;        // -1 deep sea .. 0 coast .. 1 inland
        float n = m.b;
        float lat = (vUv.y - 0.5) * 2.0;        // -1 south pole .. 1 north pole

        vec3 deep = srgb(vec3(0.47, 0.68, 0.88));
        vec3 mid = srgb(vec3(0.60, 0.79, 0.93));
        vec3 shallow = srgb(vec3(0.74, 0.90, 0.95));
        // the distance field only reaches a little way out to sea, so the
        // deep-to-mid blend uses latitude-smoothed values instead of noise
        vec3 ocean = mix(deep, mid, 0.35 + 0.25 * (1.0 - abs(lat)));
        ocean = mix(ocean, shallow, smoothstep(-0.42, -0.02, dist) * 0.85);
        // a pale line of surf right at the shore
        ocean = mix(ocean, srgb(vec3(0.94, 0.98, 0.99)), smoothstep(-0.07, -0.005, dist) * 0.8);
        // icy seas near the poles
        ocean = mix(ocean, srgb(vec3(0.86, 0.92, 0.97)), smoothstep(0.82, 0.94, abs(lat)));

        vec3 ground = ramp(lat, n, smoothstep(0.0, 0.9, dist));
        // a soft beach where land meets water
        ground = mix(srgb(vec3(0.99, 0.92, 0.80)), ground, smoothstep(0.0, 0.06, dist));
        // inland terrain gets a touch of relief from the noise channel
        ground *= 0.94 + smoothstep(0.1, 1.0, dist) * (n - 0.5) * 0.16;
        vec3 col = mix(ocean, ground, land);

        vec3 N = normalize(vNormalW);
        float diff = dot(N, uSun);
        // soft, studio-like shading: a broad key light that never goes dark
        float key = smoothstep(-0.55, 0.95, diff);
        vec3 lit = col * mix(vec3(0.62, 0.66, 0.80), vec3(1.10, 1.06, 1.0), key);
        // a soft sheen on the water, none on land
        vec3 H = normalize(uSun + vViewDir);
        float spec = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * 0.28;
        // a thin, bright limb that melts into the halo
        float fres = 1.0 - max(dot(N, vViewDir), 0.0);
        vec3 outCol = lit + spec + srgb(vec3(0.84, 0.92, 1.0)) * pow(fres, 3.4) * 0.65;
        gl_FragColor = vec4(outCol, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 160, 120), earthMat);
  world.add(earth);

  /* ---------- clouds: soft wisps drifting just above the surface ---------- */
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSun: earthMat.uniforms.uSun },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun;
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        // stretched along the latitude lines, so clouds read as soft streaks
        vec3 q = normalize(vPos);
        vec3 p = vec3(q.x * 2.2, q.y * 6.5, q.z * 2.2) + vec3(uTime * 0.012, 0.0, uTime * 0.006);
        float c = fbm(p + fbm(p * 1.4) * 0.8);
        float a = smoothstep(0.58, 0.82, c) * 0.32;
        vec3 N = normalize(vNormalW);
        float facing = max(dot(N, vViewDir), 0.0);
        a *= smoothstep(0.0, 0.35, facing);
        float light = clamp(dot(N, uSun) * 0.5 + 0.6, 0.55, 1.0);
        gl_FragColor = vec4(vec3(1.0) * light, a);
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.018, 96, 72), cloudMat);
  world.add(clouds);

  /* ---------- atmosphere: a soft halo hugging the limb ---------- */
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.16, 96, 72),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          // a narrow halo just outside the limb, fading fast into the page
          float d = dot(vNormal, vView);
          float glow = pow(clamp(1.0 + d * 1.6, 0.0, 1.0), 5.0);
          gl_FragColor = vec4(vec3(0.55, 0.74, 0.96) * glow * 0.75, glow * 0.55);
        }`,
    }),
  );
  atmo.scale.setScalar(0.94);
  scene.add(atmo);

  // a soft contact shadow under the globe, so it floats above the page
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = 256;
  shadowCanvas.height = 64;
  const sg = shadowCanvas.getContext("2d");
  const sgrad = sg.createRadialGradient(128, 32, 0, 128, 32, 128);
  sgrad.addColorStop(0, "rgba(61, 90, 120, 0.32)");
  sgrad.addColorStop(0.45, "rgba(61, 90, 120, 0.12)");
  sgrad.addColorStop(1, "rgba(61, 90, 120, 0)");
  sg.fillStyle = sgrad;
  sg.fillRect(0, 0, 256, 64);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTex, depthWrite: false, transparent: true, opacity: 0.55 }));
  shadow.scale.set(2.2, 0.26, 1);
  shadow.position.set(0, -1.3, -0.8);
  scene.add(shadow);

  /* ---------- markers: a chunky little skillet over a flame, steaming ---------- */
  const markers = [];
  const panGroup = new THREE.Group();
  world.add(panGroup);

  // pastel enamel shells, one per pan so the map reads as a sprinkle of colour
  // (picked a step richer than the UI pastels: the lighting softens them)
  const SHELLS = [0xf09a82, 0x7fc7a6, 0xa99ae6, 0xf2c55e, 0x78b3e2, 0xec8fa9];
  // what's in the pan: sauce colour + topping colour, read from the cuisine
  const DISHES = [
    { sauce: 0xf2994a, top: 0xffd66b }, // golden curry, egg
    { sauce: 0xe85d4a, top: 0xfff1d6 }, // tomato, feta
    { sauce: 0xf4c27a, top: 0x7fbf8e }, // noodles, herbs
    { sauce: 0xd98a5b, top: 0xffe28a }, // stew, potato
    { sauce: 0xf7d070, top: 0xe8604c }, // rice, chilli
    { sauce: 0xc8e27a, top: 0xfff4e0 }, // green curry, coconut
  ];
  const ironMat = new THREE.MeshPhysicalMaterial({ color: 0x2f3437, metalness: 0.55, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const handleMat = new THREE.MeshPhysicalMaterial({ color: 0x3a3f42, metalness: 0.5, roughness: 0.4, clearcoat: 0.5 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xc89466, roughness: 0.6 });
  const burnerMat = new THREE.MeshPhysicalMaterial({ color: 0x3b4044, metalness: 0.6, roughness: 0.35, clearcoat: 0.5 });
  const creamMat = new THREE.MeshPhysicalMaterial({ color: 0xf5eee4, roughness: 0.4, clearcoat: 0.6, side: THREE.BackSide });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });

  function flameTexture() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 96;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 70, 2, 32, 62, 40);
    grad.addColorStop(0, "rgba(255,248,214,1)");
    grad.addColorStop(0.35, "rgba(255,196,92,0.95)");
    grad.addColorStop(0.7, "rgba(255,120,72,0.55)");
    grad.addColorStop(1, "rgba(255,120,72,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(32, 4);
    g.bezierCurveTo(54, 36, 60, 64, 32, 92);
    g.bezierCurveTo(4, 64, 10, 36, 32, 4);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function steamTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const flameTex = flameTexture();
  const steamTex = steamTexture();

  // shared geometry for every marker
  const S = 0.062; // overall marker scale relative to the globe
  // the skillet is lathe-turned: flat base, curved wall, rolled lip
  const profile = [];
  const steps = 18;
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    profile.push(new THREE.Vector2(S * (0.62 + Math.sin(a) * 0.36), S * (0.02 + (1 - Math.cos(a)) * 0.36)));
  }
  profile.unshift(new THREE.Vector2(0, S * 0.02));
  profile.push(new THREE.Vector2(S * 1.02, S * 0.42), new THREE.Vector2(S * 0.95, S * 0.44));
  const shellGeo = new THREE.LatheGeometry(profile, 56);
  const lipGeo = new THREE.TorusGeometry(S * 0.985, S * 0.045, 12, 56);
  const foodGeo = new THREE.CylinderGeometry(S * 0.86, S * 0.7, S * 0.12, 48);
  const yolkGeo = new THREE.SphereGeometry(S * 0.2, 24, 16);
  const handleGeo = new THREE.CapsuleGeometry(S * 0.1, S * 0.62, 6, 14);
  const gripGeo = new THREE.CapsuleGeometry(S * 0.14, S * 0.5, 6, 14);
  const burnerGeo = new THREE.TorusGeometry(S * 0.46, S * 0.06, 10, 40);
  const trivetGeo = new THREE.BoxGeometry(S * 1.05, S * 0.07, S * 0.09);
  // a flame tongue: a cone pinched at the top, built from a lathe profile
  const tongueProfile = [];
  for (let k = 0; k <= 12; k++) {
    const v = k / 12;
    tongueProfile.push(new THREE.Vector2(Math.sin(v * Math.PI) * (1 - v * 0.55) * S * 0.16, v * S * 0.62));
  }
  const tongueGeo = new THREE.LatheGeometry(tongueProfile, 16);
  {
    // butter-yellow at the root, warming to coral at the tip
    const pos = tongueGeo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const lo = new THREE.Color(0xffe58a), mid = new THREE.Color(0xffa04e), hi = new THREE.Color(0xff6a4d), c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const v = pos.getY(k) / (S * 0.62);
      if (v < 0.45) c.lerpColors(lo, mid, v / 0.45);
      else c.lerpColors(mid, hi, (v - 0.45) / 0.55);
      c.toArray(cols, k * 3);
    }
    tongueGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  }
  const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const halo = new THREE.RingGeometry(S * 1.25, S * 1.42, 56);

  // a soft round footprint under each pan, lying on the land
  const footTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(40, 60, 80, 0.2)");
    gr.addColorStop(1, "rgba(40, 60, 80, 0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const footGeo = new THREE.PlaneGeometry(S * 1.6, S * 1.6);
  const stemGeo = new THREE.CylinderGeometry(S * 0.035, S * 0.035, 1, 8);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const LIFT = S * 1.15; // how far the icon floats above the surface

  // Cooks in neighbouring cities (Tel Aviv and Amman, London and Dublin)
  // would stack their pans on one another. Nudge the floating icons apart
  // until none overlap, pulling each gently back toward home; its stem
  // still lands on the true spot, like a pin in a crowded map.
  const homes = data.map((s) => latLngToVec(s.lat, s.lng).normalize());
  const spots = homes.map((v) => v.clone());
  {
    const MIN = S * 2.9;
    const push = new THREE.Vector3();
    for (let it = 0; it < 160; it++) {
      for (let a = 0; a < spots.length; a++)
        for (let b = a + 1; b < spots.length; b++) {
          const d = spots[a].distanceTo(spots[b]);
          if (d >= MIN) continue;
          push.subVectors(spots[a], spots[b]);
          // two cooks at the very same spot: split them along a fixed bearing
          if (push.lengthSq() < 1e-10) push.set(Math.cos(a + b), 0, Math.sin(a + b));
          push.normalize().multiplyScalar((MIN - d) * 0.5);
          spots[a].add(push).normalize();
          spots[b].sub(push).normalize();
        }
      spots.forEach((v, i) => v.lerp(homes[i], 0.015).normalize());
    }
  }

  function makePan(session, i) {
    const up = homes[i];
    const spot = spots[i];

    // ground anchor: lies on the surface, holds the beacon and footprint
    const ground = new THREE.Group();
    ground.position.copy(up.clone().multiplyScalar(RADIUS * 1.003));
    ground.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    panGroup.add(ground);
    const foot = new THREE.Mesh(footGeo, new THREE.MeshBasicMaterial({ map: footTex, transparent: true, depthWrite: false }));
    foot.rotation.x = -Math.PI / 2;
    ground.add(foot);
    // the stem runs from the true spot up to wherever the icon floats
    const from = up.clone().multiplyScalar(RADIUS * 1.003);
    const to = spot.clone().multiplyScalar(RADIUS * 1.003 + LIFT * 0.8);
    const stem = new THREE.Mesh(stemGeo, stemMat.clone());
    stem.position.copy(from).add(to).multiplyScalar(0.5);
    stem.scale.y = from.distanceTo(to);
    stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    panGroup.add(stem);

    // the icon itself: floats above the point, turned upright to the viewer
    const g = new THREE.Group();
    g.position.copy(spot.clone().multiplyScalar(RADIUS * 1.003 + LIFT));
    g.scale.setScalar(0.001);

    const inner = new THREE.Group();
    g.add(inner);
    inner.position.y = S * 0.42;

    // enamel outside, dark seasoned iron inside — the pastel reads from afar
    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshPhysicalMaterial({ color: SHELLS[i % SHELLS.length], roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: 0xffffff, side: THREE.FrontSide }),
    );
    inner.add(shell);
    // cream enamel inside, like a good French casserole
    const innerWall = new THREE.Mesh(shellGeo, creamMat);
    innerWall.scale.setScalar(0.985);
    inner.add(innerWall);
    const lip = new THREE.Mesh(lipGeo, ironMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = S * 0.43;
    inner.add(lip);

    // what's cooking: a glossy sauce, a scatter of pieces, herbs on top
    const dish = DISHES[i % DISHES.length];
    const food = new THREE.Mesh(foodGeo, new THREE.MeshPhysicalMaterial({ color: dish.sauce, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 }));
    food.position.y = S * 0.2;
    inner.add(food);
    const pieceMat = new THREE.MeshPhysicalMaterial({ color: dish.top, roughness: 0.4, clearcoat: 0.8 });
    const herbMat = new THREE.MeshStandardMaterial({ color: 0x5fae73, roughness: 0.6 });
    for (let k = 0; k < 7; k++) {
      const a = k * 2.39 + i;
      const r = S * (0.18 + (k % 3) * 0.2);
      const piece = new THREE.Mesh(yolkGeo, k % 3 === 2 ? herbMat : pieceMat);
      const s = k % 3 === 2 ? 0.32 : 0.55 + (k % 2) * 0.25;
      piece.scale.set(s, s * 0.55, s);
      piece.position.set(Math.cos(a) * r, S * 0.27, Math.sin(a) * r);
      inner.add(piece);
    }

    // a long iron handle with a wooden grip, tilted up a touch
    const handle = new THREE.Group();
    const bar = new THREE.Mesh(handleGeo, handleMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = S * 0.45;
    handle.add(bar);
    const grip = new THREE.Mesh(gripGeo, woodMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = S * 1.05;
    handle.add(grip);
    handle.position.set(S * 0.98, S * 0.34, 0);
    handle.rotation.z = 0.22;
    inner.add(handle);
    inner.rotation.y = (i * 1.7) % (Math.PI * 2);

    // the stove: a dark iron trivet, with a ring of little flames licking up
    // at the pan's base
    const stove = new THREE.Group();
    stove.position.y = -S * 0.36;
    const burner = new THREE.Mesh(burnerGeo, burnerMat);
    burner.rotation.x = Math.PI / 2;
    stove.add(burner);
    for (let k = 0; k < 2; k++) {
      const bar = new THREE.Mesh(trivetGeo, burnerMat);
      bar.rotation.y = k * (Math.PI / 2) + Math.PI / 4;
      bar.position.y = S * 0.05;
      stove.add(bar);
    }
    const flames = new THREE.Group();
    const tongues = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tongue = new THREE.Mesh(tongueGeo, flameMat);
      tongue.position.set(Math.cos(a) * S * 0.32, S * 0.02, Math.sin(a) * S * 0.32);
      tongue.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      flames.add(tongue);
      tongues.push(tongue);
    }
    stove.add(flames);
    g.add(stove);
    // a warm glow under the pan, so the flames light the scene around them
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, depthWrite: false, transparent: true, opacity: 0.6 }));
    flame.scale.set(S * 1.4, S * 0.9, 1);
    flame.position.y = -S * 0.22;
    flame.renderOrder = -1;
    g.add(flame);

    // three puffs of steam that rise, drift and fade on a loop
    const puffs = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, depthWrite: false, transparent: true, opacity: 0 }));
      p.userData.offset = k / 3 + (i % 5) * 0.07;
      g.add(p);
      puffs.push(p);
    }

    // a soft white ring on the ground, pulsing like a beacon
    const ring = new THREE.Mesh(halo, ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = S * 0.01;
    ground.add(ring);

    // an invisible, generous hit target so pans are easy to tap
    const hit = new THREE.Mesh(new THREE.SphereGeometry(S * 1.6, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = S * 0.5;
    hit.userData.session = session;
    g.add(hit);

    g.userData = { session, inner, flame, tongues, puffs, ring, hit, up, ground, foot, stem, hover: 0, active: 0, phase: i * 0.9 };
    panGroup.add(g);
    markers.push(g);
  }
  data.forEach(makePan);

  /* ---------- interaction: drag with inertia, zoom, click ---------- */
  let rotX = 0.35;
  let rotY = -0.4;
  let velX = 0;
  let velY = 0.0;
  let targetRot = null;
  let dist = 5.2;
  let targetDist = dist;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInteraction = -Infinity;
  let hovered = null;
  let selected = null;
  let needsRender = true;
  const pointers = new Map();
  let pinchStart = 0;

  // open facing the busiest stretch of the map (Europe, Africa, the Middle
  // East), tilted so the northern hemisphere's cities sit nicely in view
  rotY = Math.PI * 1.36;
  rotX = 0.42;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([earth, ...markers.map((m) => m.userData.hit)], false);
    const first = hits[0];
    return first && first.object.userData.session ? first.object.parent : null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, e);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    velX = velY = 0;
    targetRot = null;
    lastInteraction = performance.now();
    root.classList.add("grabbing");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchStart) targetDist = THREE.MathUtils.clamp(targetDist * (pinchStart / d), 2.6, 7);
      pinchStart = d;
      needsRender = true;
      return;
    }
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0048 * (dist / 5.2);
      velY = dx * k;
      velX = dy * k;
      rotY += velY;
      rotX = THREE.MathUtils.clamp(rotX + velX, -1.2, 1.2);
      lastInteraction = performance.now();
      needsRender = true;
    } else {
      const m = pick(e.clientX, e.clientY);
      if (m !== hovered) {
        hovered = m;
        canvas.style.cursor = m ? "pointer" : "";
        needsRender = true;
      }
    }
  });
  function endDrag(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (!dragging) return;
    dragging = false;
    root.classList.remove("grabbing");
    if (moved < 6) {
      const m = pick(e.clientX, e.clientY);
      if (m) select(m.userData.session.id, true);
      else select(null, true);
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      targetDist = THREE.MathUtils.clamp(targetDist * (1 + e.deltaY * 0.0012), 2.6, 7);
      lastInteraction = performance.now();
      needsRender = true;
    },
    { passive: false },
  );

  // turn the globe so a session sits front and centre
  function focusOn(session) {
    const v = latLngToVec(session.lat, session.lng).normalize();
    const lng = Math.atan2(v.z, -v.x);
    const ty = -lng - Math.PI / 2 + Math.PI;
    const tx = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 0.92;
    // shortest way round
    let dy = ((ty - rotY) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    targetRot = { x: tx, y: rotY + dy };
    targetDist = Math.min(targetDist, 4.2);
  }

  function select(id, fromGlobe) {
    selected = markers.find((m) => m.userData.session.id === id) ?? null;
    if (selected) focusOn(selected.userData.session);
    lastInteraction = performance.now();
    needsRender = true;
    if (fromGlobe) root.dispatchEvent(new CustomEvent("globe:select", { detail: { id }, bubbles: true }));
  }
  root.addEventListener("globe:focus", (e) => select(e.detail.id, false));
  let shownIds = null;
  root.addEventListener("globe:filter", (e) => {
    shownIds = e.detail.ids ? new Set(e.detail.ids) : null;
    needsRender = true;
  });

  /* ---------- resize ---------- */
  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the globe a comfortable size on tall phones; on wider screens set
    // it down and to the right so the headline has its own space
    const phone = w / h < 0.8;
    camera.fov = phone ? 44 : 34;
    if (phone) camera.setViewOffset(w, h, 0, -h * 0.04, w, h);
    else camera.setViewOffset(w, h, -w * 0.13, -h * 0.07, w, h);
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  new ResizeObserver(resize).observe(root);
  resize();

  /* ---------- loop ---------- */
  const clock = new THREE.Clock();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tmp = new THREE.Vector3();
  const iconPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const camLocal = new THREE.Vector3();
  const leanUp = new THREE.Vector3();
  const leanQ = new THREE.Quaternion();
  const invWorld = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  // world-space: pan up = screen up, tipped toward the viewer by 30°
  const screenUpright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.52, 0, 0));

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const idle = performance.now() - lastInteraction > 3200;

    if (targetRot) {
      rotX += (targetRot.x - rotX) * Math.min(1, dt * 4.2);
      rotY += (targetRot.y - rotY) * Math.min(1, dt * 4.2);
      if (Math.abs(targetRot.x - rotX) + Math.abs(targetRot.y - rotY) < 0.0005) targetRot = null;
    } else if (!dragging) {
      // inertia, then a slow drift once idle
      rotY += velY;
      rotX = THREE.MathUtils.clamp(rotX + velX, -1.2, 1.2);
      velX *= 0.93;
      velY *= 0.93;
      if (idle && !selected && !reduce) rotY += dt * 0.045;
      rotX += (0.32 - rotX) * (idle ? dt * 0.25 : 0);
    }
    dist += (targetDist - dist) * Math.min(1, dt * 5);
    camera.position.set(0, 0, dist);

    world.rotation.set(rotX, rotY, 0, "XYZ");
    earthMat.uniforms.uTime.value = t;
    cloudMat.uniforms.uTime.value = reduce ? 0 : t;
    clouds.rotation.y = reduce ? 0 : t * 0.008;

    // markers: lean toward the viewer, bob, steam, pulse, scale on
    // hover/selection, fade on the far side
    camDir.copy(camera.position).normalize();
    world.updateMatrixWorld();
    invWorld.copy(world.quaternion).invert();
    camLocal.copy(camDir).applyQuaternion(invWorld);
    for (const m of markers) {
      const u = m.userData;
      // Each pan stands like an icon: upright on screen, seen from about 30°
      // above, wherever it sits on the globe. Build that orientation in
      // camera space, then express it in the globe's local space.
      leanQ.copy(invWorld).multiply(screenUpright);
      m.quaternion.slerp(leanQ, Math.min(1, dt * 10));
      const isHover = m === hovered;
      const isSel = m === selected;
      u.hover += ((isHover ? 1 : 0) - u.hover) * Math.min(1, dt * 10);
      u.active += ((isSel ? 1 : 0) - u.active) * Math.min(1, dt * 8);
      tmp.copy(u.up).applyQuaternion(world.quaternion);
      const facing = tmp.dot(camDir);
      u.dim = (u.dim ?? 1) + ((shownIds && !shownIds.has(u.session.id) ? 0 : 1) - (u.dim ?? 1)) * Math.min(1, dt * 6);
      // fade out on the far side, and before an icon would hang out past
      // the globe's silhouette into empty space (icons stand screen-up, so
      // measure from a little above their centre)
      m.getWorldPosition(iconPos);
      const off = Math.hypot(iconPos.x, iconPos.y + S * 0.6) / RADIUS;
      const vis = THREE.MathUtils.smoothstep(facing, 0.15, 0.35) * (1 - THREE.MathUtils.smoothstep(off, 0.74, 0.88)) * u.dim;
      // pans pop in with a little spring the first time they're seen
      u.grow = Math.min(1, (u.grow ?? 0) + dt * 1.6);
      const pop = u.grow >= 1 ? 1 : 1 - Math.pow(1 - u.grow, 3) * Math.cos(u.grow * 9);
      const scale = (1 + u.hover * 0.22 + u.active * 0.35) * (0.55 + vis * 0.45) * pop;
      m.scale.setScalar(Math.max(0.001, scale));
      m.visible = vis > 0.01;
      u.ground.visible = vis > 0.01;
      u.stem.visible = vis > 0.01;
      u.foot.material.opacity = vis;
      u.stem.material.opacity = vis * 0.85;
      u.hit.visible = vis > 0.4;
      const bob = reduce ? 0 : Math.sin(t * 2.2 + u.phase) * S * 0.06;
      u.inner.position.y = S * 0.42 + bob + u.hover * S * 0.12;
      u.inner.rotation.x = reduce ? 0 : Math.sin(t * 1.3 + u.phase) * 0.05;
      u.inner.rotation.z = reduce ? 0 : Math.sin(t * 1.6 + u.phase) * 0.05;
      u.flame.material.opacity = vis * (0.5 + Math.sin(t * 13 + u.phase) * 0.12);
      u.tongues.forEach((tg, k) => {
        const f = reduce ? 1 : 0.8 + Math.sin(t * (11 + k) + u.phase + k * 1.7) * 0.22;
        tg.scale.set(1, f, 1);
      });
      for (const p of u.puffs) {
        const k = reduce ? 0.5 : (t * 0.34 + p.userData.offset) % 1;
        p.position.set(Math.sin(k * 6 + u.phase) * S * 0.4, S * (0.85 + k * 2.6), Math.cos(k * 5 + u.phase) * S * 0.25);
        const s = S * (0.7 + k * 1.6);
        p.scale.set(s, s, 1);
        p.material.opacity = vis * Math.sin(k * Math.PI) * 0.9;
      }
      const pulse = reduce ? 0.4 : (t * 0.7 + u.phase * 0.2) % 1;
      u.ring.scale.setScalar(1 + pulse * 1.4 + u.active * 0.6);
      u.ring.material.opacity = vis * (1 - pulse) * (0.55 + u.active * 0.45);
      u.ring.material.color.set(isSel ? 0xef6b5b : 0xffffff);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  root.classList.add("ready");
  requestAnimationFrame(frame);
}
