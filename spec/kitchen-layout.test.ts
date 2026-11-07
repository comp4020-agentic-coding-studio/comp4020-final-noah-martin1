import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser module, no type declarations
import { dropFor, fitScale, fitsPlan, frontToBack, inLarderDoor, larderLevelFor, liftFor, newLane, orderStack, planLane, rotatedExtent, shelfFor, takeSlot } from "../public/kitchen-layout.mjs";

// The geometry behind the 3D fridge and larder: where items may stand, and
// which one a pointer means. Pure functions, so these run without a browser.

describe("kitchen layout: items stay on their shelf", () => {
  const shelf = () => newLane({ xMin: -0.9, xMax: 0.9, zNear: -0.17, zFar: -0.84, free: 0.6 });

  it("a rotated item takes the room its turned footprint needs", () => {
    const e = rotatedExtent(0.4, 0.2, Math.PI / 2);
    expect(e.x).toBeCloseTo(0.2, 5);
    expect(e.z).toBeCloseTo(0.4, 5);
    expect(rotatedExtent(0.4, 0.2, 0).x).toBeCloseTo(0.4, 5);
  });

  it("no slot pokes past the front edge, the back wall or either side", () => {
    const ln = shelf();
    for (let i = 0; i < 40; i++) {
      const w = 0.2 + (i % 4) * 0.08;
      const d = 0.15 + (i % 3) * 0.06;
      const s = takeSlot(ln, w, d);
      if (!s) continue;
      expect(s.x - w / 2).toBeGreaterThanOrEqual(ln.xMin - 1e-9);
      expect(s.x + w / 2).toBeLessThanOrEqual(ln.xMax + 0.011);
      expect(s.z + d / 2).toBeLessThanOrEqual(ln.zNear + 1e-9);
      expect(s.z - d / 2).toBeGreaterThanOrEqual(ln.zFar - 1e-9);
    }
  });

  it("items in one row never overlap, and the back row stays behind the front row", () => {
    const ln = shelf();
    const placed: { x: number; z: number; w: number; d: number; row: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const w = 0.25;
      const d = 0.2;
      const s = takeSlot(ln, w, d);
      if (s) placed.push({ x: s.x, z: s.z, w, d, row: s.row });
    }
    expect(placed.some((p) => p.row === 1)).toBe(true);
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9;
        const overlapZ = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-9;
        expect(overlapX && overlapZ).toBe(false);
      }
    }
  });

  it("a full shelf says so rather than overflowing", () => {
    const ln = shelf();
    let last: unknown = {};
    for (let i = 0; i < 100 && last; i++) last = takeSlot(ln, 0.3, 0.2);
    expect(last).toBeNull();
  });

  it("peeking at a slot does not use it", () => {
    const ln = shelf();
    const a = takeSlot(ln, 0.3, 0.2, true);
    const b = takeSlot(ln, 0.3, 0.2);
    expect(a).toEqual(b);
  });

  it("a front row deeper than the shelf leaves no room for a back row", () => {
    const ln = newLane({ xMin: 0, xMax: 0.5, zNear: -0.1, zFar: -0.5, free: 1 });
    expect(takeSlot(ln, 0.45, 0.39)).not.toBeNull();
    expect(takeSlot(ln, 0.45, 0.1)).toBeNull();
  });
});

describe("kitchen layout: headroom", () => {
  it("an item that fits is left alone; a tall one is shrunk to fit, within limits", () => {
    expect(fitScale(0.4, 0.6)).toBe(1);
    expect(fitScale(0.62, 0.5)).toBeLessThan(1);
    expect(fitScale(0.62, 0.5) * 0.62).toBeLessThanOrEqual(0.5);
    expect(fitScale(2, 0.5)).toBe(0.6);
  });

  it("hovering never lifts or grows an item into the shelf above", () => {
    for (const [h, free] of [[0.3, 0.32], [0.3, 0.5], [0.5, 0.52], [0.2, 0.9]] as const) {
      const { lift, grow } = liftFor(h, free);
      expect(h * (1 + grow) + lift).toBeLessThanOrEqual(free + 1e-9);
      expect(lift).toBeGreaterThanOrEqual(0);
    }
  });

  it("a landing item starts no higher than the shelf above allows", () => {
    expect(dropFor(0.35, 0.3, 0.4)).toBeLessThanOrEqual(0.4 - 0.3);
    expect(dropFor(0.35, 0.3, Infinity)).toBe(0.35);
  });
});

describe("kitchen layout: picking overlapping items", () => {
  it("what the ray really hits beats a padded box, and the rest follow nearest first", () => {
    const order = orderStack([
      { id: 1, exact: null, proxy: 1.0 },
      { id: 2, exact: 2.2, proxy: 2.0 },
      { id: 3, exact: 3.1, proxy: 3.0 },
      { id: 4, exact: null, proxy: 0.5 },
    ]);
    expect(order).toEqual([2, 3, 4, 1]);
  });

  it("an item hidden behind another is still in the stack, so it can be reached", () => {
    const order = orderStack([
      { id: 10, exact: 1.0, proxy: 0.9 },
      { id: 11, exact: 1.4, proxy: 1.3 },
    ]);
    expect(order).toContain(11);
    expect(order).toHaveLength(2);
  });

  it("no hits, no stack", () => {
    expect(orderStack([])).toEqual([]);
  });
});

type Slot = { x: number; z: number; row: number; index: number } | null;

describe("kitchen layout: setting out a whole shelf so nothing hides", () => {
  const shelf = () => newLane({ xMin: -0.8, xMax: 0.8, zNear: -0.16, zFar: -0.82, free: 0.6 });
  const sizes = [0.3, 0.32, 0.28, 0.35, 0.3, 0.33, 0.29, 0.3].map((w, i) => ({ w, d: 0.2 + (i % 3) * 0.05 }));

  it("every slot is on the shelf, and no two items overlap", () => {
    const ln = shelf();
    const slots: Slot[] = planLane(ln, sizes);
    expect(slots.every(Boolean)).toBe(true);
    const placed = slots.map((s, i) => ({ ...s!, ...sizes[i] }));
    for (const p of placed) {
      expect(p.x - p.w / 2).toBeGreaterThanOrEqual(ln.xMin - 0.011);
      expect(p.x + p.w / 2).toBeLessThanOrEqual(ln.xMax + 0.011);
      expect(p.z + p.d / 2).toBeLessThanOrEqual(ln.zNear + 1e-9);
      expect(p.z - p.d / 2).toBeGreaterThanOrEqual(ln.zFar - 1e-9);
    }
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9;
        const overlapZ = Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-9;
        expect(overlapX && overlapZ).toBe(false);
      }
    }
  });

  it("the front row is spread across the shelf, and the back row stands in the gaps between front items", () => {
    const slots: Slot[] = planLane(shelf(), sizes);
    const front = slots.filter((s) => s!.row === 0).map((s) => s!.x).sort((a, b) => a - b);
    const back = slots.filter((s) => s!.row === 1).map((s) => s!.x).sort((a, b) => a - b);
    expect(front.length).toBeGreaterThan(2);
    expect(front[0]).toBeLessThan(-0.4);
    expect(front[front.length - 1]).toBeGreaterThan(0.4);
    // as many back items as there are gaps each stand in one, well clear of the front centres
    const inGap = back.filter((x) => Math.min(...front.map((f) => Math.abs(f - x))) > 0.1);
    expect(inGap.length).toBeGreaterThanOrEqual(Math.min(back.length, front.length - 1));
  });

  it("a deep item in front blocks only what stands right behind it", () => {
    const ln = newLane({ xMin: 0, xMax: 1, zNear: 0, zFar: -0.5, free: 1 });
    // a deep loaf on the left, shallow tins on the right, then a deep basket that must go behind the tins
    const slots: Slot[] = planLane(ln, [{ w: 0.4, d: 0.35 }, { w: 0.15, d: 0.1 }, { w: 0.15, d: 0.1 }, { w: 0.3, d: 0.3 }]);
    expect(slots[3]).not.toBeNull();
    expect(slots[3]!.x - 0.15).toBeGreaterThanOrEqual(0.4);
  });

  it("fitsPlan says whether a shelf holds the lot, without changing the shelf", () => {
    const ln = shelf();
    expect(fitsPlan(ln, sizes)).toBe(true);
    expect(fitsPlan(ln, [...sizes, ...sizes, ...sizes])).toBe(false);
    expect(ln.n).toBe(0);
  });

  it("an item added afterwards still finds free room, and never on top of a planned one", () => {
    const ln = shelf();
    const slots: Slot[] = planLane(ln, sizes.slice(0, 3));
    const extra: Slot = takeSlot(ln, 0.2, 0.15);
    expect(extra).not.toBeNull();
    for (const [i, s] of slots.entries()) {
      const overlapX = Math.abs(s!.x - extra!.x) < (sizes[i].w + 0.2) / 2 - 1e-9;
      const overlapZ = Math.abs(s!.z - extra!.z) < (sizes[i].d + 0.15) / 2 - 1e-9;
      expect(overlapX && overlapZ).toBe(false);
    }
  });

  it("shortest first: the front row takes the short things, so the tall ones behind still show", () => {
    const items = [{ n: "milk", h: 0.6 }, { n: "butter", h: 0.09 }, { n: "yoghurt", h: 0.17 }, { n: "cheese", h: 0.09 }];
    const sorted: typeof items = frontToBack(items, (i: (typeof items)[number]) => i.h);
    expect(sorted.map((i) => i.n)).toEqual(["butter", "cheese", "yoghurt", "milk"]);
  });

  it("a fridge is stocked the usual way: meat at the bottom, dairy in the middle, the rest up top", () => {
    expect(shelfFor("tray")).toBe(0);
    for (const m of ["eggs", "cheese", "tub", "butter"]) expect(shelfFor(m)).toBe(1);
    for (const m of ["milk", "jar", "bottle"]) expect(shelfFor(m)).toBe(2);
  });
});

describe("the larder is kept the way a larder is", () => {
  it("heavy things low, tins and bread on the cold slate, packets, then jars, bottles up top", () => {
    for (const m of ["sack", "potato", "onion", "pumpkin"]) expect(larderLevelFor(m)).toBe(0);
    for (const m of ["can", "carton", "loaf", "garlic"]) expect(larderLevelFor(m)).toBe(1);
    for (const m of ["box", "pouch"]) expect(larderLevelFor(m)).toBe(2);
    expect(larderLevelFor("jar")).toBe(3);
    expect(larderLevelFor("bottle")).toBe(4);
    // anything unexpected sits at eye level, where it's seen
    expect(larderLevelFor("something new")).toBe(3);
  });

  it("only spices and little bottles go in the door racks; a tall bottle wouldn't fit under the next rack", () => {
    expect(inLarderDoor("spice", 0.22)).toBe(true);
    expect(inLarderDoor("bottle", 0.3)).toBe(true);
    expect(inLarderDoor("bottle", 0.47)).toBe(false);
    for (const m of ["jar", "can", "pouch", "box"]) expect(inLarderDoor(m, 0.2)).toBe(false);
  });

  it("each larder shelf holds a full row of its usual things without hiding any", () => {
    // the slate shelf: 2.0 m inside less its margins, 0.58 m deep, with tins
    // in front and cartons behind
    const slate = newLane({ xMin: -0.94, xMax: 0.94, zNear: 0.115, zFar: -0.505, free: 0.45 });
    const sizes = [...Array(6)].map(() => ({ w: 0.15, d: 0.15 })).concat([...Array(4)].map(() => ({ w: 0.17, d: 0.1 })));
    const slots = planLane(slate, sizes);
    expect(slots.every(Boolean)).toBe(true);
    // a back-row carton stands in a gap between the tins, where it shows
    const front = slots.filter((s: Slot) => s!.row === 0);
    for (const b of slots.filter((s: Slot) => s!.row === 1)) {
      const covered = front.some((f: Slot) => Math.abs(f!.x - b!.x) < (0.15 + 0.17) / 2 - 0.08);
      expect(covered).toBe(false);
    }
  });
});
