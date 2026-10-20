import type { IncomingMessage } from "node:http";
import { one, run } from "./db.ts";
import { HttpError } from "./http.ts";

// Recipe photos people upload. Stored in the database on the volume, so
// they live in $DATA_DIR like everything else. The type is read from the
// file's own bytes, never from its name or the browser's claim, and only
// JPEG, PNG and WebP of a sensible size are accepted.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export function sniff(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Width and height from the header, so a 1×1 tracking pixel or a corrupt
// file is refused. null when the header can't be read.
export function dimensions(bytes: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === "image/webp") {
      const chunk = bytes.toString("ascii", 12, 16);
      if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = bytes.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1, height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1 };
      return null;
    }
    // JPEG: walk the segments to a start-of-frame marker
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

export type ImageCheck = { ok: true; mime: ImageMime; width: number; height: number } | { ok: false; problem: string };

export function checkImage(bytes: Buffer): ImageCheck {
  if (!bytes.length) return { ok: false, problem: "Choose a photo of the dish." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, problem: "That photo is over 5 MB. Try a smaller one." };
  const mime = sniff(bytes);
  if (!mime) return { ok: false, problem: "That file isn't a JPEG, PNG or WebP photo." };
  const d = dimensions(bytes, mime);
  if (!d || d.width < 200 || d.height < 150) return { ok: false, problem: "That photo is too small or couldn't be read. Use one at least 200 × 150 pixels." };
  if (d.width > 12000 || d.height > 12000) return { ok: false, problem: "That photo is too large in pixels." };
  return { ok: true, mime, ...d };
}

export function saveImage(ownerId: number, bytes: Buffer, check: Extract<ImageCheck, { ok: true }>): string {
  const { id } = run(
    "INSERT INTO recipe_images (owner_id, mime, bytes, width, height) VALUES (?, ?, ?, ?, ?)",
    ownerId,
    check.mime,
    bytes,
    check.width,
    check.height,
  );
  return `/images/${id}`;
}

export function loadImage(id: number): { mime: string; bytes: Uint8Array } | undefined {
  return one<{ mime: string; bytes: Uint8Array }>("SELECT mime, bytes FROM recipe_images WHERE id = ?", id);
}

// An image reference a form may carry: one of this person's own uploads, or
// the photo the recipe already has (an edit that doesn't change it).
export function ownedImage(ownerId: number, ref: string): boolean {
  const m = /^\/images\/(\d{1,12})$/.exec(ref);
  return !!m && !!one("SELECT 1 FROM recipe_images WHERE id = ? AND owner_id = ?", Number(m[1]), ownerId);
}

/* ---------------- multipart, for the no-JavaScript form ---------------- */

const MAX_MULTIPART = MAX_IMAGE_BYTES + 256 * 1024;

export interface Multipart {
  fields: URLSearchParams;
  files: Map<string, { filename: string; bytes: Buffer }>;
}

export async function readMultipart(req: IncomingMessage): Promise<Multipart> {
  const type = req.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!boundary) throw new HttpError(400, "That form couldn't be read.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_MULTIPART) throw new HttpError(413, "That photo is over 5 MB. Try a smaller one.");
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const delim = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields = new URLSearchParams();
  const files = new Map<string, { filename: string; bytes: Buffer }>();
  let start = body.indexOf(delim);
  while (start >= 0) {
    const next = body.indexOf(delim, start + delim.length);
    if (next < 0) break;
    // part = CRLF headers CRLF CRLF content CRLF
    const part = body.subarray(start + delim.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split > 0) {
      const head = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      if (name !== undefined) {
        if (filename !== undefined) {
          if (content.length) files.set(name, { filename, bytes: Buffer.from(content) });
        } else fields.append(name, content.toString("utf8"));
      }
    }
    start = next;
  }
  return { fields, files };
}
