/** Client-side image preparation: decode, rotate, crop, compress, and a blur estimate. */

export const LIMITS = {
  inputBytes: 15 * 1024 * 1024, // what we accept from the picker before compressing
  uploadMaxSide: 2000, // longest side sent to the server
  minSide: 200,
  quality: 0.88,
  types: ['image/jpeg', 'image/png', 'image/webp'],
};

export async function decodeFile(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // JPEG/PNG/WebP are supported. Phone cameras may hand us HEIC; if the browser can decode it we re-encode to JPEG.
  if (!LIMITS.types.includes(file.type) && !/^image\//.test(file.type)) throw new Error('Please choose a JPEG, PNG or WebP image.');
  if (file.size > LIMITS.inputBytes) throw new Error('That file is larger than 15 MB. Please choose a smaller photo.');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This image could not be opened. It may be damaged.')); img.src = url; });
      return img;
    } catch { throw new Error('This image could not be opened. Please use a JPEG, PNG or WebP file.'); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

export interface Crop { x: number; y: number; w: number; h: number } // normalised 0..1 in the rotated image

/** Draw the source rotated by quarter turns onto a canvas (full resolution). */
export function rotated(src: CanvasImageSource & { width: number; height: number }, quarter: number): HTMLCanvasElement {
  const q = ((quarter % 4) + 4) % 4;
  const c = document.createElement('canvas');
  const sw = src.width, sh = src.height;
  c.width = q % 2 ? sh : sw; c.height = q % 2 ? sw : sh;
  const x = c.getContext('2d')!;
  x.translate(c.width / 2, c.height / 2);
  x.rotate((q * Math.PI) / 2);
  x.drawImage(src, -sw / 2, -sh / 2);
  return c;
}

/** Crop + downscale + encode for upload. Keeps text legible (max 2000 px, JPEG q 0.88). */
export async function exportForUpload(rot: HTMLCanvasElement, crop: Crop): Promise<{ blob: Blob; width: number; height: number; dataUrl: string }> {
  const cx = Math.round(crop.x * rot.width), cy = Math.round(crop.y * rot.height);
  const cw = Math.max(1, Math.round(crop.w * rot.width)), ch = Math.max(1, Math.round(crop.h * rot.height));
  const s = Math.min(1, LIMITS.uploadMaxSide / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.round(cw * s); out.height = Math.round(ch * s);
  const x = out.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, out.width, out.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(rot, cx, cy, cw, ch, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/jpeg', LIMITS.quality));
  // smaller copy kept locally for the review screen / saving
  const t = document.createElement('canvas'); const ts = Math.min(1, 1100 / Math.max(out.width, out.height));
  t.width = Math.round(out.width * ts); t.height = Math.round(out.height * ts);
  t.getContext('2d')!.drawImage(out, 0, 0, t.width, t.height);
  return { blob, width: out.width, height: out.height, dataUrl: t.toDataURL('image/jpeg', 0.82) };
}

/**
 * Heuristic sharpness score: variance of a Laplacian on a 512 px grayscale copy.
 * Only used to WARN; it is not a reliable judgement and never blocks upload.
 */
export function sharpness(rot: HTMLCanvasElement, crop: Crop): number {
  const W = 512, cw = crop.w * rot.width, ch = crop.h * rot.height;
  const s = W / Math.max(cw, ch);
  const w = Math.max(8, Math.round(cw * s)), h = Math.max(8, Math.round(ch * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(rot, crop.x * rot.width, crop.y * rot.height, cw, ch, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    const l = 4 * g[i]! - g[i - 1]! - g[i + 1]! - g[i - w]! - g[i + w]!;
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
