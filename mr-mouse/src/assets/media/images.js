import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../components/Db";

/* ---------------------------------------------------------------
   Images: logos, product photos, receipts.

   One path for every picture the app keeps:
     1. processImage()  — check, decode (camera rotation honoured),
                          shrink to fit 512px, encode WebP (PNG where
                          the browser can't write WebP), and refuse
                          anything still too big to sync.
     2. saveImage()     — lives in useCompanySync (it needs the
                          socket): stores the Blob in Dexie and sends it
                          to other devices as one "image" message.
     3. useImageUrl()   — turns a stored image id into a URL for <img>.

   Limits are deliberately small. Every image travels to every device
   of the business and is kept on the sync server, so a 4MB phone
   photo must never leave the phone as-is.
--------------------------------------------------------------- */

export const IMAGE_LIMITS = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024, // what we accept from the picker/camera
  maxDimension: 512, // longest side after resizing
  maxStoredBytes: 150 * 1024, // what we keep and sync, after encoding
  minDimension: 96, // never shrink below this to make a file fit
});

export const IMAGE_KINDS = Object.freeze(["logo", "product", "receipt"]);

// What we send over the wire. The server refuses anything else.
export const STORED_MIME = Object.freeze(["image/webp", "image/png"]);

export class ImageError extends Error {}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function decode(file) {
  // createImageBitmap applies the EXIF rotation from phone cameras, so
  // a portrait receipt doesn't come out sideways.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fit(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function draw(source, width, height) {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function encode(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError("Couldn't process that image."))), type, quality)
  );
}

/**
 * Check, shrink and re-encode an image from a file input or the camera.
 * Resolves to { blob, mime, width, height, bytes }; rejects with an
 * ImageError whose message can be shown to the person as-is.
 */
export async function processImage(file, limits = IMAGE_LIMITS) {
  if (!(file instanceof Blob)) throw new ImageError("Choose an image first.");
  if (file.type === "image/svg+xml") throw new ImageError("SVG files can't be used. Choose a PNG, JPG or WebP image.");
  if (file.type && !file.type.startsWith("image/")) throw new ImageError("That file isn't an image.");
  if (file.size > limits.maxInputBytes) {
    throw new ImageError(`That image is ${mb(file.size)}. Choose one under ${mb(limits.maxInputBytes)}.`);
  }

  let source;
  try {
    source = await decode(file);
  } catch {
    throw new ImageError(
      /hei[cf]/i.test(file.type || file.name || "")
        ? "This phone saved the photo as HEIC, which can't be read here. Set the camera to “Most compatible”, or send a screenshot of it."
        : "That image couldn't be opened. Try a JPG or PNG."
    );
  }

  const naturalWidth = source.width || source.naturalWidth;
  const naturalHeight = source.height || source.naturalHeight;
  let { width, height } = fit(naturalWidth, naturalHeight, limits.maxDimension);

  try {
    // Smaller each round only if a file is still too big at the lowest
    // quality — e.g. a photo where the browser can only write PNG.
    while (true) {
      const canvas = draw(source, width, height);
      for (const quality of [0.85, 0.75, 0.62, 0.5]) {
        const blob = await encode(canvas, "image/webp", quality);
        // Browsers that can't write WebP hand back PNG; quality has no
        // effect on PNG, so one try is enough.
        const mime = STORED_MIME.includes(blob.type) ? blob.type : null;
        if (!mime) break;
        if (blob.size <= limits.maxStoredBytes) return { blob, mime, width, height, bytes: blob.size };
        if (mime === "image/png") break;
      }
      const next = { width: Math.round(width * 0.75), height: Math.round(height * 0.75) };
      if (Math.max(next.width, next.height) < limits.minDimension) {
        throw new ImageError(`That image is too detailed to keep under ${kb(limits.maxStoredBytes)}. Try a simpler or smaller picture.`);
      }
      ({ width, height } = next);
    }
  } finally {
    source.close?.();
  }
}

/* ---- Wire format ------------------------------------------------
   Images travel as base64 inside the normal JSON sync message: the
   outbox, the server's event log and the replay path all handle JSON
   already. Base64 is a third bigger than the bytes, which the size
   limit above accounts for. */

export async function blobToBase64(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode.apply(null, buffer.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* A record as stored locally (Blob) -> as sent (base64), and back. */
export async function toWireImage(record) {
  const { blob, ...rest } = record;
  return { ...rest, data: await blobToBase64(blob) };
}

export function fromWireImage(payload) {
  const { data, ...rest } = payload;
  if (typeof data !== "string" || !STORED_MIME.includes(rest.mime)) return null;
  return { ...rest, blob: base64ToBlob(data, rest.mime) };
}

/**
 * A stored image as a small JPEG on white, base64, for documents built
 * elsewhere (the WhatsApp invoice PDF: its PDF library reads JPEG and
 * PNG, not WebP). Null when the image isn't on this device.
 */
export async function imageForDocument(imageId, max = 256) {
  const record = imageId ? await db.images.get(imageId) : null;
  if (!record?.blob || record.deleted) return null;
  const source = await decode(record.blob);
  try {
    const { width, height } = fit(source.width || source.naturalWidth, source.height || source.naturalHeight, max);
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency: paper white behind it
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await encode(canvas, "image/jpeg", 0.88);
    return { mime: "image/jpeg", data: await blobToBase64(blob) };
  } finally {
    source.close?.();
  }
}

/**
 * A URL for a stored image, for <img src>. Null while loading, when the
 * id is empty, or when the image hasn't arrived on this device yet.
 * The URL is released when the image changes or the component goes.
 */
export function useImageUrl(imageId) {
  const record = useLiveQuery(() => (imageId ? db.images.get(imageId) : undefined), [imageId]);
  const blob = record && !record.deleted ? record.blob : null;
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
