export const SIZE: number;
export const CROP: number;
export const SHARP_ENOUGH: number;
export const STILL_ENOUGH: number;
export function grey(rgba: Uint8ClampedArray | Uint8Array): Uint8Array;
export interface Layout {
  paperShare: number;
  inkGreyShare: number;
  inkDensity: number;
  lines: number;
  regular: number;
  ok: boolean;
}
export function receiptLayout(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Layout;
export function sharpness(g: Uint8Array, w: number, h: number): number;
export function motion(a: Uint8Array | null, b: Uint8Array | null): number;
export function watcher(hold?: number): {
  feed(f: { layout: { ok: boolean }; sharp: number; moved: number }): { capture: boolean; progress: number; hint: string };
  reset(): void;
};
