import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser module, no type declarations
import { dropFor, fitScale, liftFor, newLane, orderStack, rotatedExtent, takeSlot } from "../public/kitchen-layout.mjs";

// The geometry behind the 3D fridge and pantry: where items may stand, and
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
