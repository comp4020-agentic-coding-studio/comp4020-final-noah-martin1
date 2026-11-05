export interface Rgba { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface TextBox { text: string; score: number; box: number[][] }
export const DET_MAX: number;
export function resize(img: Rgba, W: number, H: number): Rgba;
export function regions(mask: Uint8Array, w: number, h: number): { xs: number[]; ys: number[] }[];
export function minAreaRect(poly: number[][]): { cx: number; cy: number; halfW: number; halfH: number; ux: number; uy: number } | null;
export function decode(probs: Float32Array, steps: number, classes: number, dict: string[]): { text: string; score: number };
export function toLines(boxes: TextBox[]): string[];
export function createReader(
  ort: unknown,
  files: { det: Uint8Array; rec: Uint8Array; dict: string },
): Promise<{ read(photo: Rgba, onLine?: (done: number, total: number) => void): Promise<{ lines: string[]; boxes: TextBox[] }> }>;
