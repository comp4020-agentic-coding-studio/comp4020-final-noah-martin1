// Pure geometry for the 3D fridge and larder: where an item may stand on a
// shelf, how much headroom it has, and which item a pointer means when
// several overlap. No three.js here, so spec/kitchen-layout.test.ts can test
// the rules directly; public/kitchen.mjs draws what these decide.

export const GAP = 0.06;
export const MARGIN = 0.012;
const STAGGER = 0.12;

// The footprint of a w x d box turned by `rot` radians: what it really
// occupies on a shelf, so a wide carton turned a little never leaves its edge.
export function rotatedExtent(w, d, rot) {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return { x: c * w + s * d, z: c * d + s * w };
}

// Uniform scale that lets an item of `height` stand under a ceiling `free`
// above its base. Never enlarges; never shrinks below 60%.
export function fitScale(height, free) {
  if (!(height > 0) || !Number.isFinite(free)) return 1;
  return Math.min(1, Math.max(0.6, (free - MARGIN) / height));
}

// How far a hovered item may grow and rise before it would meet the shelf
// above. `height` is its resting height.
export function liftFor(height, free, wantLift = 0.14, wantGrow = 0.06) {
  if (!(height > 0) || !Number.isFinite(free)) return { lift: wantLift, grow: wantGrow };
  const spare = Math.max(0, free - MARGIN - height);
  const grow = Math.min(wantGrow, spare / height);
  const lift = Math.min(wantLift, Math.max(0, spare - height * grow));
  return { lift, grow };
}

// A landing item starts above its shelf; never let that start poke through
// the shelf above.
export function dropFor(drop, height, free) {
  if (!Number.isFinite(free)) return drop;
  return Math.min(drop, Math.max(0, free - MARGIN - height));
}

// A lane is one shelf: items pack left to right, a front row and then a back
// row. The front row's front edge sits at zNear and the back row's back edge
// at zFar (both measured on the item's own rotated footprint), so nothing
// overhangs the shelf or pokes through the wall behind it.
export function newLane(o) {
  return { ...o, x: o.xMin, row: 0, n: 0 };
}

// Takes the next slot for an item with rotated footprint w x d, or null when
// the lane is full. The lane remembers where the next one goes.
export function takeSlot(lane, w, d, peek = false) {
  let row = lane.row;
  let at = lane.x;
  if (at + w > lane.xMax + 0.01) {
    if (row === 1) return null;
    row = 1;
    // staggered, so back-row items show between the front-row ones
    at = lane.xMin + STAGGER;
    if (at + w > lane.xMax + 0.01) return null;
  }
  const x = at + w / 2;
  const z = row === 0 ? lane.zNear - d / 2 : lane.zFar + d / 2;
  // the two rows must not overlap in depth, or items would pass through each other
  if (row === 1 && lane.zFar + d > lane.zNear - (lane.frontDepth ?? 0) + 0.0001 && lane.frontDepth !== undefined) return null;
  const slot = { x, z, row, index: lane.n };
  if (!peek) {
    lane.row = row;
    lane.x = at + w + GAP;
    lane.n++;
    if (row === 0) lane.frontDepth = Math.max(lane.frontDepth ?? 0, d);
  }
  return slot;
}

// Sets a whole shelf at once, so nothing hides: the front row takes the
// shortest items (in the order given) and spreads them evenly across the
// shelf, and each back-row item stands behind a gap between two front ones,
// where it shows. A back-row item only has to clear the depth of the front
// items it is actually behind, so a deep loaf at one end doesn't push the
// whole back row off the shelf. `sizes` are rotated footprints {w, d}.
// Returns one slot per size (null for any that don't fit), and leaves the
// lane's cursor past the last item so an item added later (takeSlot) still
// finds the free room.
export function planLane(lane, sizes) {
  const span = lane.xMax - lane.xMin;
  const depth = lane.zNear - lane.zFar;
  const slots = sizes.map(() => null);
  // the front row: as many as fit side by side with a gap between
  const front = [];
  let used = 0;
  for (const [i, s] of sizes.entries()) {
    const need = used + (front.length ? GAP : 0) + s.w;
    if (need > span + 0.01) break;
    front.push(i);
    used = need;
  }
  const spare = Math.max(0, span - used);
  // spread: the spare room shared between the gaps (and half a share at each
  // end). When the back row will be as long as the front, the two are laid
  // like bricks instead: the front row starts at the left edge with the room
  // between items, and the back row (below) starts half a step in.
  // (how many the back row will hold: as many as fit side by side)
  let behind = 0;
  let room = span + GAP;
  for (const s of sizes.filter((_, i) => !front.includes(i))) {
    if (room < s.w + GAP) break;
    room -= s.w + GAP;
    behind++;
  }
  const brick = front.length > 1 && behind >= front.length;
  const share = front.length ? spare / front.length : 0;
  let x = lane.xMin + (brick ? 0 : share / 2);
  const placedFront = [];
  for (const i of front) {
    const s = sizes[i];
    placedFront.push({ x0: x, x1: x + s.w, d: s.d, c: x + s.w / 2 });
    slots[i] = { x: x + s.w / 2, z: lane.zNear - s.d / 2, row: 0, index: slots.filter(Boolean).length };
    x += s.w + GAP + share;
  }
  // how deep the front row reaches over [a, b]
  const reach = (a, b) => Math.max(0, ...placedFront.filter((f) => f.x1 > a && f.x0 < b).map((f) => f.d));
  const fits = (cx, w, d) => d + reach(cx - w / 2, cx + w / 2) <= depth + 0.0001;
  // The back row aims for the gaps between front items: with no more items
  // than gaps, the gaps spread across it; with more, an even spread across
  // the shelf. Each item then goes as near its aim as the ones beside it
  // allow (left to right, never so far right that those still to come run
  // out of room), at the first spot clear of the front items it stands behind.
  const rest = sizes.map((_, i) => i).filter((i) => !front.includes(i) && sizes[i].d <= depth);
  const gaps = placedFront.slice(1).map((f, k) => (placedFront[k].c + f.c) / 2);
  const pitch = placedFront.length > 1 ? (placedFront[placedFront.length - 1].c - placedFront[0].c) / (placedFront.length - 1) : span;
  const aims = rest.length <= gaps.length
    ? rest.map((_, k) => gaps[Math.round(((k + 0.5) * gaps.length) / rest.length - 0.5)])
    : rest.map((_, k) => (placedFront[0]?.c ?? lane.xMin) + (k + 0.5) * pitch);
  let backX = lane.xMin;
  for (const [k, i] of rest.entries()) {
    const s = sizes[i];
    const after = rest.slice(k + 1).reduce((t, j) => t + sizes[j].w + GAP, 0);
    const lo = backX + s.w / 2;
    const hi = Math.min(lane.xMax - s.w / 2 + 0.01, Math.max(lo, lane.xMax - after - s.w / 2));
    if (lo > hi + 1e-9) continue;
    // nearest clear spot to its aim, within [lo, hi]
    const want = Math.min(hi, Math.max(lo, aims[k]));
    let cx = null;
    for (let step = 0; step <= (hi - lo) / 0.01 + 1 && cx === null; step++) {
      for (const c of [want + step * 0.01, want - step * 0.01]) if (cx === null && c >= lo - 1e-9 && c <= hi + 1e-9 && fits(c, s.w, s.d)) cx = c;
    }
    if (cx === null) continue;
    slots[i] = { x: cx, z: lane.zFar + s.d / 2, row: 1, index: slots.filter(Boolean).length };
    backX = cx + s.w / 2 + GAP;
  }
  // later additions go after whatever was placed, in the back row if the
  // front is full
  lane.n = slots.filter(Boolean).length;
  lane.frontDepth = front.length ? Math.max(...placedFront.map((f) => f.d)) : undefined;
  if (rest.length || x - share > lane.xMax - 0.05) {
    lane.row = 1;
    lane.x = backX;
  } else {
    lane.row = 0;
    lane.x = x - share;
  }
  return slots;
}

// Whether a planned shelf would hold every one of these (planned on a copy,
// so the lane itself is untouched).
export function fitsPlan(lane, sizes) {
  return planLane({ ...lane }, sizes).every(Boolean);
}

// Which fridge shelf an item belongs on, the way a fridge is stocked: raw
// meat and fish on the bottom shelf (nothing drips onto them, they drip onto
// nothing), dairy and eggs in the middle, tall cartons and everything else up
// top. 0 is the bottom shelf.
const SHELF_OF = { tray: 0, eggs: 1, cheese: 1, tub: 1, butter: 1, cream: 1, milk: 2, juice: 2 };
export function shelfFor(model) {
  return SHELF_OF[model] ?? 2;
}

// Which level of the larder an item belongs on, the way a larder is kept:
// the heavy sacks, potatoes and onions on the floor (0); tins, cartons,
// bread, garlic and ginger on the cold slate shelf (1); packets on the shelf
// above (2); jars of preserves above that (3); bottles up top (4).
const LEVEL_OF = { sack: 0, potato: 0, onion: 0, pumpkin: 0, pineapple: 0, can: 1, carton: 1, loaf: 1, garlic: 1, ginger: 1, banana: 1, butter: 1, box: 2, pouch: 2, jar: 3, bar: 3, bottle: 4, spice: 4 };
export function larderLevelFor(model) {
  return LEVEL_OF[model] ?? 3;
}

// Spices and little bottles (vanilla, sesame oil) stand in the racks on the
// backs of the larder doors; anything taller wouldn't fit under the next rack.
export function inLarderDoor(model, height) {
  return model === "spice" || (model === "bottle" && height <= 0.32);
}

// The order to set a shelf's items down in: shortest first, so they take the
// front row and the taller ones stand behind them and still show over the
// top. Ties keep their given order, so the scene is the same every visit.
export function frontToBack(list, heightOf) {
  return list
    .map((item, i) => ({ item, i, h: heightOf(item) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((x) => x.item);
}

// The items under the pointer, frontmost first. `hits` are { id, exact,
// proxy }: `exact` is the distance to the item's real geometry (null when
// the ray only touched its padded box), `proxy` the distance to that box.
// What you can see wins; items the ray only grazes come after, so one that is
// partly or wholly behind another is still reachable (from the list in the
// panel, or the keyboard).
export function orderStack(hits) {
  const exact = hits.filter((h) => h.exact !== null).sort((a, b) => a.exact - b.exact);
  const rest = hits.filter((h) => h.exact === null).sort((a, b) => a.proxy - b.proxy);
  return [...exact, ...rest].map((h) => h.id);
}
