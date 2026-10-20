// Pure geometry for the 3D fridge and pantry: where an item may stand on a
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
