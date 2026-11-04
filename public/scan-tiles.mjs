// Where a busy photo is cut into overlapping bands along its long side. One
// file for both the server's scan and the in-browser scan, so the two cut a
// photo the same way.

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [bands]
 * @param {number} [overlap]
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function tilesFor(width, height, bands = 3, overlap = 0.12) {
  if (bands <= 1) return [{ x: 0, y: 0, w: width, h: height }];
  const wide = width >= height;
  const long = wide ? width : height;
  const size = Math.round(long / bands + long * overlap);
  const step = (long - size) / (bands - 1);
  return Array.from({ length: bands }, (_, i) => {
    const at = Math.round(i * step);
    return wide ? { x: at, y: 0, w: size, h: height } : { x: 0, y: at, w: width, h: size };
  });
}
