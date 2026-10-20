// The live globe: the real Earth from NASA imagery, lit by the sun as it is
// right now (day, night and city lights), with a little steaming pan
// wherever someone is cooking. Drag to spin, scroll or pinch to zoom, click a
// pan to open its card. Progressive: the page lists every session without
// this script.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { localAt } from "./localclock.mjs";

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

  // The sun is where it really is: the point on Earth it's overhead right
  // now (worked out from the clock below), in the globe's own frame, so day,
  // night and the dusk line between them turn with the world as you spin it.
  // The pans are lit by a key light that follows the same sun, plus a soft
  // fill so the ones on the night side still read as little objects.
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0xdfe8f5, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3e2, 1.5);
  scene.add(sun);
  const sunLocal = new THREE.Vector3(1, 0, 0); // in the globe's frame
  const sunWorld = new THREE.Vector3(1, 0, 0);

  const world = new THREE.Group();
  scene.add(world);

  /* ---------- earth: NASA imagery, lit by the real sun ---------- */
  // Blue Marble by day, Black Marble's city lights by night, a normal map from
  // GEBCO elevation for relief (water in its blue), and the cloud cover. See
  // scripts/build-earth.py and README Sources.
  const loader = new THREE.TextureLoader();
  const base = root.dataset.textures ?? "/assets/textures/";
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let pending = 4;
  const loaded = () => {
    if (--pending === 0) root.classList.add("ready");
  };
  function tex(name, color) {
    const t = loader.load(base + name, loaded, undefined, loaded);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }
  const dayTex = tex("earth-day.webp", true);
  const nightTex = tex("earth-night.webp", true);
  const reliefTex = tex("earth-relief.webp", false);
  const cloudTex = tex("earth-clouds.webp", false);

  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: dayTex },
      uNight: { value: nightTex },
      uRelief: { value: reliefTex },
      uClouds: { value: cloudTex },
      uSun: { value: sunWorld },
      uCloudShift: { value: 0 },
      uDark: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vEast;
      varying vec3 vNorth;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        // east and north on the sphere, for reading the relief map
        vec3 eastL = normalize(vec3(-position.z, 0.0, position.x) + vec3(1e-5, 0.0, 0.0));
        vEast = normalize(mat3(modelMatrix) * -eastL);
        vNorth = normalize(cross(vNormalW, vEast));
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform sampler2D uRelief;
      uniform sampler2D uClouds;
      uniform vec3 uSun;
      uniform float uCloudShift;
      uniform float uDark;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vEast;
      varying vec3 vNorth;

      vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

      void main() {
        vec3 day = texture2D(uDay, vUv).rgb;
        // relief map: the elevation normal's x/y in red/green, water in blue
        vec3 relief = texture2D(uRelief, vUv).rgb;
        float water = relief.b;
        vec3 lights = texture2D(uNight, vUv).rgb;

        // relief: the elevation normal map tilts the surface for the light
        vec3 Ng = normalize(vNormalW);
        vec2 tn = relief.rg * 2.0 - 1.0;
        vec3 N = normalize(Ng + (vEast * tn.x + vNorth * tn.y) * 0.9 * (1.0 - water));

        // a gentle grade toward the site's palette: seas a clearer blue,
        // land a touch warmer and lighter, so it sits beside the pastel UI
        // without turning into a cartoon
        vec3 sea = mix(day, day * vec3(0.78, 1.0, 1.12) + srgb(vec3(0.05, 0.13, 0.22)), 0.6);
        vec3 land = pow(day, vec3(0.92)) * vec3(1.04, 1.02, 0.96);
        vec3 albedo = mix(land, sea, water);

        // where the sun is. Day fades into night over a wide, soft band, as
        // it does seen from orbit: the ground dims gradually from late
        // afternoon through dusk, rather than switching off at a line
        float sunDot = dot(Ng, uSun);
        float dayAmt = smoothstep(-0.2, 0.45, sunDot);
        // sunlight on the day side, the relief shading it; a little warmer
        // only very near the edge, with no coloured band
        float diffuse = max(dot(N, uSun), 0.0);
        vec3 sunCol = mix(srgb(vec3(1.0, 0.94, 0.88)), vec3(1.0), smoothstep(0.0, 0.3, sunDot));
        vec3 lit = albedo * sunCol * (0.22 + 1.05 * diffuse);

        // cloud shadows on the ground beneath them
        float cs = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
        lit *= 1.0 - cs * 0.35 * dayAmt;

        // sunlight glinting off the oceans: a soft sheen with a brighter core
        vec3 H = normalize(uSun + vViewDir);
        float nh = max(dot(Ng, H), 0.0);
        float spec = pow(nh, 220.0) * 0.55 + pow(nh, 28.0) * 0.07;
        lit += srgb(vec3(1.0, 0.95, 0.88)) * spec * water * smoothstep(0.0, 0.3, sunDot);

        // the night side is the same Earth in shadow: darker, cooler and
        // less saturated, oceans a deep blue and land a dim blue-grey that
        // still shows its shape
        float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
        vec3 shade = mix(vec3(lum), albedo, 0.4) * vec3(0.55, 0.7, 1.2);
        // (linear values: deep sea ≈ #0a1448 on screen, land ≈ #1e2638)
        vec3 night = shade * 0.07 + mix(vec3(0.002, 0.006, 0.062), vec3(0.008, 0.012, 0.032), 1.0 - water);
        night *= mix(1.0, 0.8, uDark);
        // city lights come on as the evening deepens: small, soft and a warm
        // white (the texture is amber; this pulls it back toward white)
        float cityOn = 1.0 - smoothstep(-0.18, 0.04, sunDot);
        night += lights * vec3(1.0, 1.02, 1.2) * (0.9 + lights.r * 1.6) * cityOn;

        vec3 col = mix(night, lit, dayAmt);

        // the atmosphere's blue rim, all the way round: brighter by day,
        // still a fine blue line on the night side
        float fres = 1.0 - max(dot(Ng, vViewDir), 0.0);
        col += srgb(vec3(0.45, 0.68, 1.0)) * pow(fres, 3.0) * (0.32 + 0.5 * dayAmt);

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 192, 128), earthMat);
  world.add(earth);

  /* ---------- clouds: the real cloud cover, drifting slowly east ---------- */
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uClouds: { value: cloudTex }, uSun: { value: sunWorld }, uCloudShift: earthMat.uniforms.uCloudShift },
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
      uniform sampler2D uClouds;
      uniform vec3 uSun;
      uniform float uCloudShift;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
      void main() {
        float c = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
        vec3 N = normalize(vNormalW);
        float sunDot = dot(N, uSun);
        float day = smoothstep(-0.2, 0.45, sunDot);
        // white by day, fading with the ground into a soft blue-grey at
        // night, where they still show
        vec3 col = mix(srgb(vec3(0.2, 0.24, 0.38)), vec3(1.0), day);
        float a = c * mix(0.55, 0.9, day);
        // thinner toward the limb, so the edge of the globe stays crisp
        a *= smoothstep(0.0, 0.3, max(dot(N, vViewDir), 0.0));
        gl_FragColor = vec4(col * (0.82 + 0.18 * max(sunDot, 0.0)), a);
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.006, 128, 96), cloudMat);
  world.add(clouds);

  /* ---------- atmosphere: a blue halo, brightest in daylight ---------- */
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sunWorld }, uDark: earthMat.uniforms.uDark },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vNormalW;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uDark;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vNormalW;
      void main() {
        // a narrow blue halo just outside the limb, fading fast into the
        // page; brightest over the day side, fainter but still there at night
        float d = dot(vNormal, vView);
        float glow = pow(clamp(1.0 + d * 1.6, 0.0, 1.0), 5.0);
        float sunDot = dot(normalize(vNormalW), uSun);
        float lit = smoothstep(-0.4, 0.4, sunDot);
        vec3 col = vec3(0.5, 0.72, 1.0);
        float k = glow * (0.45 + 0.55 * lit) * mix(1.0, 0.8, uDark);
        gl_FragColor = vec4(col * k * 0.8, k * 0.55);
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.16, 96, 72), atmoMat);
  atmo.scale.setScalar(0.94);
  world.add(atmo);

  /* ---------- the sun's position, from the clock ---------- */
  // The subsolar point (where the sun is straight overhead) for a moment,
  // from the standard low-precision solar formulas: good to a fraction of a
  // degree, far finer than the terminator's soft edge.
  function subsolar(date) {
    const n = date.getTime() / 86400000 - 10957.5; // days since J2000
    const rad = Math.PI / 180;
    const L = 280.46 + 0.9856474 * n;
    const g = (357.528 + 0.9856003 * n) * rad;
    const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const eps = (23.439 - 0.0000004 * n) * rad;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const gmst = (280.46061837 + 360.98564736629 * n) % 360;
    const lng = ((((ra / rad - gmst) % 360) + 540) % 360) - 180;
    return { lat: dec / rad, lng };
  }
  // ?sun=2026-06-21T12:00Z (or data-sun-at) shows another moment, for
  // checking the lighting; otherwise it's now, kept up to date each minute
  const sunAt = new URLSearchParams(location.search).get("sun") ?? root.dataset.sunAt;
  const fixedAt = sunAt && !Number.isNaN(new Date(sunAt).getTime()) ? new Date(sunAt) : null;
  const now = () => fixedAt ?? new Date();
  function placeSun() {
    const { lat, lng } = subsolar(now());
    sunLocal.copy(latLngToVec(lat, lng)).normalize();
    root.dispatchEvent(new CustomEvent("globe:sun", { detail: { lat, lng, at: now() }, bubbles: true }));
  }
  placeSun();
  setInterval(placeSun, 60000);

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
  // a wisp of steam: a few soft lobes clumped together, so a puff reads as
  // vapour rather than a ball (each puff also turns slowly as it rises).
  // Each lobe has a faint blue-grey underside, like an illustrated cloud, so
  // white steam still reads against the pale pastel land.
  function steamTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const lobes = [[64, 70, 30], [44, 58, 22], [84, 54, 24], [62, 40, 20], [76, 82, 18]];
    const blob = (x, y, r, inner, outer) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.65, outer);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const [x, y, r] of lobes) blob(x + 3, y + 4, r + 2, "rgba(140,160,188,0.42)", "rgba(140,160,188,0.18)");
    for (const [x, y, r] of lobes) blob(x - 1, y - 1, r, "rgba(255,255,255,0.95)", "rgba(255,255,255,0.4)");
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // the warm halo behind a cook who's asked for help
  function glowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,150,96,1)");
    grad.addColorStop(0.4, "rgba(255,128,92,0.78)");
    grad.addColorStop(0.7, "rgba(250,112,92,0.3)");
    grad.addColorStop(1, "rgba(250,112,92,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const flameTex = flameTexture();
  const steamTex = steamTexture();
  const glowTex = glowTexture();
  const STEAM_PUFFS = 5;

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
  const glowGeo = new THREE.PlaneGeometry(S, S);
  const stemGeo = new THREE.CylinderGeometry(S * 0.035, S * 0.035, 1, 8);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const LIFT = S * 1.15; // how far the icon floats above the surface


  /* ---------- clustering ----------
     Pans keep the same size on screen at every zoom, so how far apart two
     cooks must be (as an angle on the globe) to get their own pans grows with
     the camera's height. Closer than that, they share ONE pan with a count,
     placed at their middle; clicking it flies down until they separate. At
     the closest zoom, cooks who still overlap (two people who both picked
     London) fan out around the spot, each pinned back to it by a stem. */
  const HOME_DIST = 5.2;
  const MIN_DIST = 2.05;
  const MAX_DIST = 7;
  const page = root.closest("[data-gl]");
  let lastZoomed = null;
  const CLUSTER_K = 0.031; // radians of separation per unit of camera height
  const GROUP_RANK = { mine: 0, friends: 1, live: 2, demo: 3 };
  // ground ring colours: you, friends, real live cooks, demo cooks
  const RING = { mine: 0x5b8f72, friends: 0x9a8be0, live: 0xef6b5b, demo: 0xffffff };

  const markers = [];
  const byId = new Map();
  const panGroup = new THREE.Group();
  world.add(panGroup);
  let shellIndex = 0;
  let clusters = [];
  let clusterDirty = true;
  let clusterAt = 0;

  const pins = root.querySelector("[data-pins]");
  const tip = document.createElement("div");
  tip.className = "gl-tip";
  tip.hidden = true;
  pins?.append(tip);

  function heightFactor(d) {
    return (d - RADIUS) / (HOME_DIST - RADIUS);
  }
  function separation(d) {
    return CLUSTER_K * (d - RADIUS);
  }

  function makePan(session) {
    const i = shellIndex++;
    const home = latLngToVec(session.lat, session.lng).normalize();

    // ground anchor: lies on the surface, holds the beacon and footprint
    const ground = new THREE.Group();
    panGroup.add(ground);
    const foot = new THREE.Mesh(footGeo, new THREE.MeshBasicMaterial({ map: footTex, transparent: true, depthWrite: false }));
    foot.rotation.x = -Math.PI / 2;
    ground.add(foot);
    const stem = new THREE.Mesh(stemGeo, stemMat.clone());
    panGroup.add(stem);

    // the icon itself: floats above the point, turned upright to the viewer
    const g = new THREE.Group();
    g.scale.setScalar(0.001);
    const inner = new THREE.Group();
    g.add(inner);
    inner.position.y = S * 0.42;

    // enamel outside, cream enamel inside — the pastel reads from afar
    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshPhysicalMaterial({ color: SHELLS[i % SHELLS.length], roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: 0xffffff, side: THREE.FrontSide }),
    );
    inner.add(shell);
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
    const stove = new THREE.Group();
    stove.position.y = -S * 0.36;
    const burner = new THREE.Mesh(burnerGeo, burnerMat);
    burner.rotation.x = Math.PI / 2;
    stove.add(burner);
    for (let k = 0; k < 2; k++) {
      const tb = new THREE.Mesh(trivetGeo, burnerMat);
      tb.rotation.y = k * (Math.PI / 2) + Math.PI / 4;
      tb.position.y = S * 0.05;
      stove.add(tb);
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
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, depthWrite: false, transparent: true, opacity: 0.6 }));
    flame.scale.set(S * 1.4, S * 0.9, 1);
    flame.position.y = -S * 0.22;
    flame.renderOrder = -1;
    g.add(flame);

    // wisps of steam that curl up, swell, turn and thin out on a loop
    const puffs = [];
    for (let k = 0; k < STEAM_PUFFS; k++) {
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, depthWrite: false, transparent: true, opacity: 0 }));
      p.userData.offset = k / STEAM_PUFFS + (i % 5) * 0.07;
      p.userData.spin = (k % 2 ? 1 : -1) * (0.6 + (k % 3) * 0.25);
      g.add(p);
      puffs.push(p);
    }

    // a warm pool of light that breathes on the ground under the pan while
    // the cook is asking for help (it lies on the surface like the beacon
    // ring, so the globe never clips it)
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTex, depthWrite: false, transparent: true, opacity: 0 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = S * 0.008;
    glow.visible = false;

    // a soft ring on the ground, pulsing like a beacon; its colour says who
    const ring = new THREE.Mesh(halo, ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = S * 0.01;
    ground.add(ring);
    // friends and you get a second, steady ring so they read at a glance
    ground.add(glow);
    const band = new THREE.Mesh(halo, ringMat.clone());
    band.rotation.x = -Math.PI / 2;
    band.position.y = S * 0.012;
    band.scale.setScalar(0.92);
    ground.add(band);

    // an invisible, generous hit target so pans are easy to tap
    const hit = new THREE.Mesh(new THREE.SphereGeometry(S * 1.6, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = S * 0.5;
    g.add(hit);

    const label = document.createElement("span");
    label.className = "gl-pin";
    label.hidden = true;
    pins?.append(label);

    g.userData = {
      session, inner, flame, tongues, puffs, glow, ring, band, hit, ground, foot, stem, label, home,
      cur: home.clone(), gcur: home.clone(), tgt: home.clone(), gtgt: home.clone(),
      show: 0, showTarget: 1, hover: 0, active: 0, phase: i * 0.9, dim: 1, vis: 0, grow: 0, help: 0,
      cluster: null, removing: false, labelKey: "",
    };
    hit.userData.marker = g;
    panGroup.add(g);
    markers.push(g);
    byId.set(session.id, g);
    styleMarker(g);
    return g;
  }

  // colours and tags that follow the session's group (you, friend, live, demo)
  function styleMarker(m) {
    const u = m.userData;
    u.ring.material.color.set(RING[u.session.group] ?? 0xffffff);
    u.band.visible = u.session.group === "mine" || u.session.group === "friends";
    u.band.material.color.set(RING[u.session.group] ?? 0xffffff);
    u.stem.material.color.set(u.band.visible ? RING[u.session.group] : 0xffffff);
  }

  function disposeMarker(m) {
    const u = m.userData;
    panGroup.remove(m, u.ground, u.stem);
    u.label.remove();
    m.traverse((o) => {
      if (o.material && o.material !== creamMat && o.material !== ironMat && o.material !== handleMat && o.material !== woodMat && o.material !== burnerMat && o.material !== flameMat) o.material.dispose?.();
    });
    u.foot.material.dispose();
    u.glow.material.dispose();
    u.ring.material.dispose();
    u.band.material.dispose();
    u.stem.material.dispose();
    u.hit.geometry.dispose();
    markers.splice(markers.indexOf(m), 1);
    if (byId.get(u.session.id) === m) byId.delete(u.session.id);
  }

  data.filter((s) => s.lat !== null && s.lng !== null).forEach(makePan);

  // Leader clustering over the pans that are shown: highest-priority cook
  // first (you, friends, live, demo), gathering everyone within the current
  // separation; then clusters whose centres still overlap are merged.
  function recluster() {
    const sep = separation(dist);
    const spread = dist <= MIN_DIST * 1.08;
    const pool = markers
      .filter((m) => !m.userData.removing && (!shownIds || shownIds.has(m.userData.session.id)))
      .sort((a, b) => GROUP_RANK[a.userData.session.group] - GROUP_RANK[b.userData.session.group] || String(a.userData.session.id).localeCompare(String(b.userData.session.id)));
    const taken = new Set();
    let list = [];
    for (const m of pool) {
      if (taken.has(m)) continue;
      const members = [m];
      taken.add(m);
      for (const o of pool) {
        if (taken.has(o)) continue;
        if (m.userData.home.angleTo(o.userData.home) < sep) {
          members.push(o);
          taken.add(o);
        }
      }
      list.push({ members, center: centre(members) });
    }
    for (let merged = true; merged; ) {
      merged = false;
      outer: for (let a = 0; a < list.length; a++)
        for (let b = a + 1; b < list.length; b++) {
          if (list[a].center.angleTo(list[b].center) < sep * 0.92) {
            list[a].members.push(...list[b].members);
            list[a].center = centre(list[a].members);
            list.splice(b, 1);
            merged = true;
            break outer;
          }
        }
    }
    list = list.filter((c) => c.members.length > 1);
    for (const c of list) {
      c.members.sort((a, b) => GROUP_RANK[a.userData.session.group] - GROUP_RANK[b.userData.session.group]);
      c.rep = c.members[0];
      c.spread = spread;
      c.id = c.members.map((m) => m.userData.session.id).sort().join("|");
    }
    clusters = list;
    const inCluster = new Map();
    for (const c of list) for (const m of c.members) inCluster.set(m, c);
    for (const m of markers) {
      const u = m.userData;
      const c = inCluster.get(m) ?? null;
      u.cluster = c;
      const filteredOut = !!shownIds && !shownIds.has(u.session.id);
      if (u.removing) {
        u.showTarget = 0;
      } else if (!c) {
        u.tgt.copy(u.home);
        u.gtgt.copy(u.home);
        u.showTarget = filteredOut ? 0 : 1;
      } else if (c.spread) {
        const k = c.members.indexOf(m);
        u.tgt.copy(fanOut(c.center, k, c.members.length, sep));
        u.gtgt.copy(u.home);
        u.showTarget = 1;
      } else {
        u.tgt.copy(c.center);
        u.gtgt.copy(c.center);
        u.showTarget = m === c.rep ? 1 : 0;
      }
    }
    clusterDirty = false;
    clusterAt = dist;
    needsRender = true;
    // a cluster that just split (or formed) under the mouse: retell the tip
    if (hovered) setHover(hovered.userData.showTarget ? hovered : null, true);
  }

  function centre(members) {
    const v = new THREE.Vector3();
    for (const m of members) v.add(m.userData.home);
    return v.normalize();
  }

  // a sunflower spiral around a spot: even spacing for any number of cooks
  function fanOut(center, k, n, sep) {
    const e1 = new THREE.Vector3().crossVectors(Math.abs(center.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), center).normalize();
    const e2 = new THREE.Vector3().crossVectors(center, e1);
    const r = sep * 0.62 * Math.sqrt(k + (n <= 1 ? 0 : 0.6));
    const a = k * 2.39996 + 0.5;
    return center.clone().addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).normalize();
  }

  // how close the camera must come for a cluster's cooks to separate
  function distToSeparate(members) {
    let min = Infinity;
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) min = Math.min(min, members[a].userData.home.angleTo(members[b].userData.home));
    const d = RADIUS + (min * 0.86) / CLUSTER_K;
    return THREE.MathUtils.clamp(d, MIN_DIST, Math.max(MIN_DIST, dist * 0.8));
  }

  /* ---------- interaction: drag with inertia, zoom, click ---------- */
  let rotX = 0.42;
  let rotY = Math.PI * 1.36;
  let velX = 0;
  let velY = 0.0;
  let targetRot = null;
  let dist = HOME_DIST;
  let targetDist = dist;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInteraction = -Infinity;
  let hovered = null;
  let selected = null;
  let needsRender = true;
  let shownIds = null;
  const pointers = new Map();
  let pinchStart = 0;

  // open facing your own pan or a friend's, if they're on the map; otherwise
  // facing a line between day and night, so both show: the evening side
  // (the dinner rush, lights coming on) unless more cooks are where dawn is
  // breaking. Centred a few hours inside daylight, the terminator lands just
  // off-centre.
  const first = markers.find((m) => m.userData.session.group === "mine" || m.userData.session.group === "friends");
  function twilightFacing() {
    const noon = subsolar(now()).lng;
    const sides = [noon + 75, noon - 75].map((lng) => latLngToVec(20, lng).normalize());
    const near = (v) => markers.filter((m) => m.userData.home.dot(v) > Math.cos(THREE.MathUtils.degToRad(70))).length;
    return near(sides[1]) > near(sides[0]) ? sides[1] : sides[0];
  }
  {
    const r = rotationFor(first ? first.userData.home : twilightFacing(), HOME_DIST);
    rotX = THREE.MathUtils.clamp(r.x, -0.9, 0.9);
    rotY = r.y;
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // three.js raycasts invisible objects too, so only offer pans on show
    const targets = markers.filter((m) => m.visible && m.userData.vis > 0.4 && m.userData.show > 0.5).map((m) => m.userData.hit);
    const hits = raycaster.intersectObjects([earth, ...targets], false);
    const firstHit = hits[0];
    return firstHit && firstHit.object.userData.marker ? firstHit.object.userData.marker : null;
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
      if (pinchStart) targetDist = THREE.MathUtils.clamp(targetDist * (pinchStart / d), MIN_DIST, MAX_DIST);
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
      // the closer the camera, the slower the spin, so a drag follows the hand
      const k = 0.0048 * ((dist - 0.9) / (HOME_DIST - 0.9));
      velY = dx * k;
      velX = dy * k;
      rotY += velY;
      rotX = THREE.MathUtils.clamp(rotX + velX, -1.2, 1.2);
      lastInteraction = performance.now();
      needsRender = true;
    } else {
      setHover(pick(e.clientX, e.clientY));
    }
  });
  canvas.addEventListener("pointerleave", () => setHover(null));
  function endDrag(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (!dragging) return;
    dragging = false;
    root.classList.remove("grabbing");
    if (moved < 6) activate(pick(e.clientX, e.clientY));
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      targetDist = THREE.MathUtils.clamp(targetDist * (1 + e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
      lastInteraction = performance.now();
      needsRender = true;
    },
    { passive: false },
  );

  // a clustered pan zooms in; a single pan opens its card
  function activate(m) {
    if (!m) return select(null, true);
    const c = m.userData.cluster;
    if (c && !c.spread) return zoomInto(c);
    select(m.userData.session.id, true);
  }

  function zoomInto(c) {
    const d = distToSeparate(c.members);
    focusOn(c.center, d);
    selected = null;
    lastInteraction = performance.now();
    root.dispatchEvent(new CustomEvent("globe:cluster", { detail: { ids: c.members.map((m) => m.userData.session.id) }, bubbles: true }));
  }

  function setHover(m, force = false) {
    if (m === hovered && !force) return;
    hovered = m;
    canvas.style.cursor = m ? "pointer" : "";
    if (!m) {
      tip.hidden = true;
      return;
    }
    const u = m.userData;
    const c = u.cluster && !u.cluster.spread ? u.cluster : null;
    tip.replaceChildren();
    const strong = document.createElement("strong");
    const small = document.createElement("small");
    if (c) {
      const places = [...new Set(c.members.map((x) => x.userData.session.city).filter(Boolean))];
      strong.textContent = `${c.members.length} people cooking`;
      small.textContent = `${places.slice(0, 3).join(" · ")}${places.length > 3 ? ` +${places.length - 3}` : ""} — click to zoom in`;
    } else {
      strong.textContent = u.session.recipe;
      const local = typeof u.session.offset === "number" ? localAt(u.session.offset) : null;
      small.textContent = `${u.session.cook}${u.session.city ? ` · ${u.session.city}` : ""}${local ? ` · ${local.label}, ${local.time}` : ""} · step ${u.session.step}/${u.session.steps}`;
    }
    tip.append(strong, small);
    tip.hidden = false;
    needsRender = true;
  }

  // the rotation that puts a point on the globe front and centre
  function rotationFor(v, d) {
    const lng = Math.atan2(v.z, -v.x);
    const ty = -lng - Math.PI / 2 + Math.PI;
    // from afar, sit a touch below centre so the north reads; up close, dead centre
    const tx = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * (d < 3 ? 1 : 0.92);
    return { x: tx, y: ty };
  }

  function focusOn(v, d) {
    targetDist = d;
    const r = rotationFor(v, d);
    // shortest way round
    const dy = ((r.y - rotY) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    targetRot = { x: THREE.MathUtils.clamp(r.x, -1.2, 1.2), y: rotY + dy };
    needsRender = true;
  }

  function select(id, fromGlobe) {
    const m = id === null ? null : byId.get(id) ?? null;
    selected = m;
    if (m) {
      // a cook hidden in a cluster: come close enough to pick them out
      const c = m.userData.cluster;
      focusOn(m.userData.home, c && !c.spread ? distToSeparate(c.members) : Math.min(targetDist, 4.2));
    }
    lastInteraction = performance.now();
    needsRender = true;
    if (fromGlobe) root.dispatchEvent(new CustomEvent("globe:select", { detail: { id }, bubbles: true }));
  }

  root.addEventListener("globe:focus", (e) => select(e.detail.id, false));
  root.addEventListener("globe:filter", (e) => {
    shownIds = e.detail.ids ? new Set(e.detail.ids) : null;
    clusterDirty = true;
  });

  // live updates from globe-ui.mjs: a cook goes live, moves on a step, ends
  root.addEventListener("globe:upsert", (e) => {
    const s = e.detail.marker;
    const m = byId.get(s.id);
    if (s.lat === null || s.lng === null) {
      if (m) m.userData.removing = true;
      clusterDirty = true;
      return;
    }
    if (m && !m.userData.removing) {
      const moved = m.userData.session.lat !== s.lat || m.userData.session.lng !== s.lng;
      m.userData.session = s;
      if (moved) m.userData.home.copy(latLngToVec(s.lat, s.lng).normalize());
      styleMarker(m);
      if (moved) clusterDirty = true;
      if (hovered === m) {
        hovered = null;
        setHover(m);
      }
    } else {
      if (m) disposeMarker(m);
      makePan(s);
      clusterDirty = true;
    }
  });
  root.addEventListener("globe:remove", (e) => {
    const m = byId.get(e.detail.id);
    if (!m) return;
    m.userData.removing = true;
    if (selected === m) selected = null;
    if (hovered === m) setHover(null);
    clusterDirty = true;
  });

  // + / − / whole-globe buttons, for anyone without a wheel or a pinch
  root.querySelectorAll("[data-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      const how = b.dataset.zoom;
      if (how === "in") targetDist = Math.max(MIN_DIST, RADIUS + (targetDist - RADIUS) * 0.55);
      if (how === "out") targetDist = Math.min(MAX_DIST, RADIUS + (targetDist - RADIUS) * 1.8);
      if (how === "reset") {
        targetDist = HOME_DIST;
        targetRot = { x: 0.42, y: rotY };
      }
      lastInteraction = performance.now();
      needsRender = true;
    }),
  );

  /* ---------- resize ---------- */
  let viewW = 1;
  let viewH = 1;
  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    viewW = w;
    viewH = h;
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
  // steam and the help glow sit a little softer against the dark theme
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => {
    const th = document.documentElement.dataset.theme;
    return th === "dark" || (th !== "light" && darkQuery.matches);
  };
  const tmp = new THREE.Vector3();
  const iconPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const leanQ = new THREE.Quaternion();
  const invWorld = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const screen = new THREE.Vector3();
  // world-space: pan up = screen up, tipped toward the viewer by 30°
  const screenUpright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.52, 0, 0));

  function project(v) {
    screen.copy(v).project(camera);
    return [(screen.x * 0.5 + 0.5) * viewW, (-screen.y * 0.5 + 0.5) * viewH];
  }

  function labelFor(m) {
    const u = m.userData;
    const c = u.cluster;
    if (c && !c.spread && m === c.rep) {
      const friends = c.members.filter((x) => x.userData.session.group === "friends" || x.userData.session.group === "mine");
      const who = friends.length ? `${friends[0].userData.session.cook}${c.members.length > 1 ? ` +${c.members.length - 1}` : ""}` : `${c.members.length} cooking`;
      return { key: `c:${c.id}:${who}`, text: who, cls: `gl-pin gl-pin-cluster${friends.length ? " gl-pin-friendly" : ""}` };
    }
    if (u.session.group === "mine") return { key: "mine", text: "You", cls: "gl-pin gl-pin-mine" };
    if (u.session.group === "friends") return { key: `f:${u.session.cook}`, text: u.session.cook, cls: "gl-pin gl-pin-friend" };
    if (u.session.kind === "live" && !(c && !c.spread)) return { key: "live", text: "Live", cls: "gl-pin gl-pin-live" };
    return null;
  }

  // Tags that would sit on top of each other: the more important one stays
  // (you, then friends, then bigger clusters, then whoever's nearer), the
  // other fades out until the globe turns or zooms them apart, like the
  // labels on a map.
  const tagged = [];
  const placed = [];
  const RANK = { mine: 3, friends: 2 };
  function placeLabels(dt) {
    const rank = (m) => {
      const u = m.userData;
      const c = u.cluster && !u.cluster.spread && u.cluster.rep === m ? u.cluster.members.length : 1;
      return (RANK[u.session.group] ?? 0) * 100 + c + u.labZ;
    };
    tagged.sort((a, b) => rank(b) - rank(a));
    placed.length = 0;
    const k = reduce ? 1 : Math.min(1, dt * 9);
    for (const m of tagged) {
      const u = m.userData;
      const l = u.labX - u.labW / 2 - 3;
      const r = u.labX + u.labW / 2 + 3;
      const top = u.labY - u.labH - 3;
      const bottom = u.labY + 3;
      const clear = !placed.some((p) => l < p[2] && r > p[0] && top < p[3] && bottom > p[1]);
      if (clear) placed.push([l, top, r, bottom]);
      u.labFade = (u.labFade ?? 0) + ((clear ? 1 : 0) - (u.labFade ?? 0)) * k;
      u.label.style.transform = `translate(${u.labX.toFixed(1)}px, ${u.labY.toFixed(1)}px) translate(-50%, -100%)`;
      u.label.style.opacity = String(Math.min(1, (u.vis - 0.25) * 2.5) * u.labFade);
    }
    tagged.length = 0;
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const idle = performance.now() - lastInteraction > 3200;
    const ease = reduce ? 1 : Math.min(1, dt * 4.2);
    const dark = isDark();

    if (targetRot) {
      rotX += (targetRot.x - rotX) * ease;
      rotY += (targetRot.y - rotY) * ease;
      if (Math.abs(targetRot.x - rotX) + Math.abs(targetRot.y - rotY) < 0.0005) targetRot = null;
    } else if (!dragging) {
      // inertia, then a slow drift once idle (only from afar: up close it
      // would carry the cooks you zoomed in on out of view)
      rotY += velY;
      rotX = THREE.MathUtils.clamp(rotX + velX, -1.2, 1.2);
      velX *= 0.93;
      velY *= 0.93;
      if (idle && !selected && !reduce && dist > 3.6) {
        rotY += dt * 0.045;
        rotX += (0.32 - rotX) * dt * 0.25;
      }
    }
    dist += (targetDist - dist) * (reduce ? 1 : Math.min(1, dt * 5));
    camera.position.set(0, 0, dist);
    // zoomed in past the whole-globe view: the headline steps back so the
    // map has the screen
    const zoomed = dist < HOME_DIST - 0.6;
    if (zoomed !== lastZoomed) {
      lastZoomed = zoomed;
      page?.classList.toggle("gl-zoomed", zoomed);
    }
    if (clusterDirty || Math.abs(Math.log(dist / clusterAt)) > 0.035) recluster();

    world.rotation.set(rotX, rotY, 0, "XYZ");
    world.updateMatrixWorld();
    // the sun is fixed to the Earth's surface (it's overhead at one point),
    // so it turns with the globe; the pans' key light comes from it too, with
    // a floor so the ones in the night still catch some light
    sunWorld.copy(sunLocal).applyQuaternion(world.quaternion);
    sun.position.copy(sunWorld).multiplyScalar(6);
    sun.intensity = 0.7 + Math.max(0, sunWorld.dot(camera.position) / dist) * 0.9;
    earthMat.uniforms.uDark.value = dark ? 1 : 0;
    // the weather drifts east, slowly enough to feel alive, not busy
    if (!reduce) earthMat.uniforms.uCloudShift.value = (t * 0.0016) % 1;

    camDir.copy(camera.position).normalize();
    invWorld.copy(world.quaternion).invert();
    leanQ.copy(invWorld).multiply(screenUpright);
    const hf = heightFactor(dist);
    const horizon = RADIUS / dist;
    const zSil = (RADIUS * RADIUS) / dist;
    const rSil = RADIUS * Math.sqrt(Math.max(0, 1 - horizon * horizon));
    const follow = reduce ? 1 : Math.min(1, dt * 6);

    for (let n = markers.length - 1; n >= 0; n--) {
      const m = markers[n];
      const u = m.userData;
      u.cur.lerp(u.tgt, follow).normalize();
      u.gcur.lerp(u.gtgt, follow).normalize();
      u.show += (u.showTarget - u.show) * Math.min(1, dt * (u.showTarget > u.show ? 7 : 9));
      if (u.removing && u.show < 0.02) {
        disposeMarker(m);
        continue;
      }
      const isHover = m === hovered;
      const isSel = m === selected;
      const isRep = !!u.cluster && !u.cluster.spread && u.cluster.rep === m;
      u.hover += ((isHover ? 1 : 0) - u.hover) * Math.min(1, dt * 10);
      u.active += ((isSel ? 1 : 0) - u.active) * Math.min(1, dt * 8);

      // each pan stands like an icon: upright on screen, seen from 30° above
      m.quaternion.slerp(leanQ, Math.min(1, dt * 10));
      const lift = RADIUS * 1.003 + LIFT * hf;
      m.position.copy(u.cur).multiplyScalar(lift);

      // fade on the far side of the horizon, and before an icon would hang
      // out past the globe's silhouette into empty space
      tmp.copy(u.cur).applyQuaternion(world.quaternion);
      const facing = tmp.dot(camDir);
      m.getWorldPosition(iconPos);
      const off = (Math.hypot(iconPos.x, iconPos.y + S * 0.6 * hf) * (dist - zSil)) / (Math.max(0.01, dist - iconPos.z) * rSil);
      u.vis = THREE.MathUtils.smoothstep(facing, horizon + 0.05, horizon + 0.2) * (1 - THREE.MathUtils.smoothstep(off, 0.8, 0.95)) * u.show;

      // pans pop in with a little spring the first time they're seen
      u.grow = Math.min(1, u.grow + dt * 1.6);
      const pop = reduce || u.grow >= 1 ? 1 : 1 - Math.pow(1 - u.grow, 3) * Math.cos(u.grow * 9);
      const scale = hf * (isRep ? 1.22 : 1) * (1 + u.hover * 0.22 + u.active * 0.35) * (0.55 + u.vis * 0.45) * pop * u.show;
      m.scale.setScalar(Math.max(0.0001, scale));
      const on = u.vis > 0.01;
      m.visible = on;

      // ground ring and footprint at the true spot (or the cluster's middle)
      u.ground.position.copy(u.gcur).multiplyScalar(RADIUS * 1.003);
      u.ground.quaternion.setFromUnitVectors(Y_AXIS, u.gcur);
      u.ground.scale.setScalar(hf * (isRep ? 1.25 : 1));
      u.ground.visible = on;
      u.foot.material.opacity = u.vis;

      // the stem runs from the ground spot up to wherever the icon floats
      from.copy(u.gcur).multiplyScalar(RADIUS * 1.003);
      to.copy(u.cur).multiplyScalar(RADIUS * 1.003 + LIFT * hf * 0.8);
      const len = from.distanceTo(to);
      u.stem.visible = on && len > 1e-5;
      if (u.stem.visible) {
        u.stem.position.copy(from).add(to).multiplyScalar(0.5);
        u.stem.scale.set(hf, len, hf);
        u.stem.quaternion.setFromUnitVectors(Y_AXIS, tmp.copy(to).sub(from).normalize());
        u.stem.material.opacity = u.vis * 0.85;
      }

      const bob = reduce ? 0 : Math.sin(t * 2.2 + u.phase) * S * 0.06;
      u.inner.position.y = S * 0.42 + bob + u.hover * S * 0.12;
      u.inner.rotation.x = reduce ? 0 : Math.sin(t * 1.3 + u.phase) * 0.05;
      u.inner.rotation.z = reduce ? 0 : Math.sin(t * 1.6 + u.phase) * 0.05;
      u.flame.material.opacity = u.vis * (0.5 + Math.sin(t * 13 + u.phase) * 0.12);
      u.tongues.forEach((tg, k) => {
        const f = reduce ? 1 : 0.8 + Math.sin(t * (11 + k) + u.phase + k * 1.7) * 0.22;
        tg.scale.set(1, f, 1);
      });
      // steam: each wisp rises from the pan, curling out and swelling as it
      // goes, fading in quickly and thinning away slowly. A busy cluster, or
      // a cook asking for help, steams a little faster. Reduced motion keeps
      // two still wisps so the pan still reads as hot.
      const steamRate = isRep ? 0.42 : 0.3;
      u.puffs.forEach((p, k) => {
        const life = reduce ? [0.25, 0.55][k] ?? -1 : (t * steamRate * (1 + u.help * 0.4) + p.userData.offset) % 1;
        if (life < 0) {
          p.visible = false;
          return;
        }
        p.visible = true;
        const curl = life * 5.5 + u.phase + k;
        const drift = S * (0.12 + life * 0.42);
        p.position.set(Math.sin(curl) * drift, S * (0.8 + life * 2.9), Math.cos(curl * 0.8) * drift * 0.6);
        const s = S * (0.85 + life * 2.4);
        p.scale.set(s, s * 1.1, 1);
        p.material.rotation = reduce ? k : p.userData.spin * life * 1.6 + k;
        const fade = Math.min(1, life / 0.18) * Math.pow(1 - life, 1.4);
        p.material.opacity = Math.min(1, u.vis * fade * (dark ? 0.85 : 1.15));
      });
      // help glow: on the cook's own pan, or a cluster's pan if anyone in it
      // has asked; eases in and out, then breathes slowly while it's on
      const asking = isRep ? u.cluster.members.some((x) => x.userData.session.help) : !!u.session.help;
      u.help += ((asking ? 1 : 0) - u.help) * Math.min(1, dt * (reduce ? 60 : 3));
      u.glow.visible = on && u.help > 0.01;
      if (u.glow.visible) {
        const breath = reduce ? 0.5 : 0.5 + Math.sin(t * 2.1 + u.phase) * 0.5;
        const gs = (4.2 + breath * 1.1) * (0.6 + u.help * 0.4);
        u.glow.scale.set(gs, gs, 1);
        u.glow.material.opacity = u.vis * u.help * (0.7 + breath * 0.3) * (dark ? 0.85 : 1);
      }
      const pulse = reduce ? 0.4 : (t * 0.7 + u.phase * 0.2) % 1;
      u.ring.scale.setScalar(1 + pulse * 1.4 + u.active * 0.6);
      u.ring.material.opacity = u.vis * (1 - pulse) * (0.55 + u.active * 0.45);
      u.band.material.opacity = u.vis * 0.9;
      if (isSel) u.ring.material.color.set(0xef6b5b);
      else u.ring.material.color.set(RING[u.session.group] ?? 0xffffff);

      // the name tag or count badge, drawn in HTML above the pan
      const lab = u.vis > 0.25 ? labelFor(m) : null;
      if (!lab) {
        if (!u.label.hidden) u.label.hidden = true;
        u.labFade = 0;
      } else {
        u.label.hidden = false;
        if (u.labelKey !== lab.key) {
          u.labelKey = lab.key;
          u.label.className = lab.cls;
          u.label.textContent = lab.text;
          u.labW = u.label.offsetWidth || 60;
          u.labH = u.label.offsetHeight || 22;
        }
        tmp.copy(iconPos);
        tmp.y += S * 1.55 * scale + 0.002;
        const [x, y] = project(tmp);
        u.labX = x;
        u.labY = y;
        u.labZ = iconPos.z;
        tagged.push(m);
      }
    }
    placeLabels(dt);

    if (hovered && !tip.hidden) {
      if (!markers.includes(hovered) || hovered.userData.vis < 0.2) setHover(null);
      else {
        hovered.getWorldPosition(iconPos);
        const [x, y] = project(iconPos);
        tip.style.transform = `translate(${x.toFixed(1)}px, ${(y + 18).toFixed(1)}px) translate(-50%, 0)`;
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
