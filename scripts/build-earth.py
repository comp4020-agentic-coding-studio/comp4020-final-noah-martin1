# Build the globe's textures from NASA's public-domain imagery.
# Usage: python3 -I build-earth.py <dl-dir> <out-dir>
#   <dl-dir>/bm-oct/topo.jpg        Blue Marble Next Generation, Oct 2004, topo+bathy (5400x2700)
#   <dl-dir>/black-marble/night.jpg Black Marble 2016 (13500x6750)
#   <dl-dir>/clouds/clouds.jpg      Blue Marble cloud composite (2048x1024)
#   <dl-dir>/gebco/elev.png         GEBCO_08 land elevation, 8-bit (21600x10800)
# Writes WebP: 4096x2048 day, 4096x2048 night (lights only), 2048x1024 relief
# (normal map from elevation, water mask in blue) and 2048x1024 clouds.
# Download the four files from eoimages.gsfc.nasa.gov (see README Sources).
import sys
import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
W, H = 4096, 2048


def load(path, size, mode="RGB"):
    return Image.open(path).convert(mode).resize(size, Image.LANCZOS)


# ---- day: Blue Marble, as it is (the shader does the grading) ----
day = load(f"{src}/bm-oct/topo.jpg", (W, H))
day.save(f"{out}/earth-day.webp", quality=84, method=6)

# ---- night: Black Marble with the moonlit ground removed, leaving lights ----
night = np.asarray(load(f"{src}/black-marble/night.jpg", (W, H))).astype(np.float32) / 255
lum = night.max(axis=2)
# the base (moonlit land, ice) sits under ~0.33; city light is far brighter.
# Keep only what rises above it, with a soft knee so small towns survive.
lights = np.clip((lum - 0.36) / 0.64, 0, 1) ** 1.05
warm = np.stack([lights, lights * 0.82, lights * 0.56], axis=2)  # sodium-lamp amber
Image.fromarray((np.clip(warm, 0, 1) * 255).astype(np.uint8)).save(f"{out}/earth-night.webp", quality=85, method=6)

# ---- relief: a tangent-space normal map from elevation, water in blue ----
RW, RH = 2048, 1024
# resampled and smoothed as floats: an 8-bit step between two flat plains
# would otherwise light up as a hard terrace when the sun is low
elev = np.asarray(Image.open(f"{src}/gebco/elev.png").convert("F").resize((RW, RH), Image.BOX), dtype=np.float32) / 255


def blur(a, sigma):
    # separable Gaussian; longitude wraps, latitude clamps at the poles
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = sum(w * np.roll(a, i - r, axis=1) for i, w in enumerate(k))
    pad = np.pad(a, ((r, r), (0, 0)), mode="edge")
    return sum(w * pad[i : i + a.shape[0]] for i, w in enumerate(k))


sea_level = elev <= 0.0  # before smoothing, which would creep inland
elev = blur(elev, 1.4)
# derivatives in texture space; longitude wraps, latitude doesn't. Scale by
# cos(lat) so the poles aren't exaggerated where pixels bunch up.
lat = (0.5 - (np.arange(RH) + 0.5) / RH) * np.pi
coslat = np.maximum(np.cos(lat), 0.08)[:, None]
dx = (np.roll(elev, -1, axis=1) - np.roll(elev, 1, axis=1)) / coslat
dy = np.vstack([elev[1:2] - elev[0:1], elev[2:] - elev[:-2], elev[-1:] - elev[-2:-1]])
strength = 7.0
nx, ny = -dx * strength, dy * strength
nz = np.ones_like(nx)
n = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / n, ny / n, nz / n], axis=2) * 0.5 + 0.5
# water: zero elevation in GEBCO's land layer, but that includes low-lying
# land (the Netherlands, coastal plains), so read colour from Blue Marble too
dayS = np.asarray(day.resize((RW, RH), Image.LANCZOS)).astype(np.float32) / 255
r, g, b = dayS[..., 0], dayS[..., 1], dayS[..., 2]
bluish = (b > r * 1.25) & (b > g * 1.05) & (dayS.max(axis=2) < 0.55)
water = (sea_level & bluish).astype(np.float32)
water = np.asarray(Image.fromarray((water * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
# normal x/y in red/green (the shader rebuilds z), water in blue. No alpha:
# encoders and browsers are free to throw away colour under alpha 0, which
# wrecked the land normals in blocks. Lossless, because lossy compression
# smears a normal map into bands that light up when the sun is low.
rgb = np.dstack([normal[..., 0], normal[..., 1], water])
Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").save(f"{out}/earth-relief.webp", lossless=True, quality=100, method=6, exact=True)

# ---- clouds: brightness as coverage, gently lifted ----
c = np.asarray(load(f"{src}/clouds/clouds.jpg", (RW, RH), "L")).astype(np.float32) / 255
c = np.clip((c - 0.06) / 0.94, 0, 1) ** 1.15
Image.fromarray((c * 255).astype(np.uint8), "L").save(f"{out}/earth-clouds.webp", quality=82, method=6)

print("water fraction", round(float(water.mean()), 3))
