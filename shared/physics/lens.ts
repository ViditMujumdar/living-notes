/**
 * Ideal thin convex (converging) lens.
 *
 * Convention used throughout the app:
 *  - Lens at x = 0, principal axis is the x-axis.
 *  - A real object sits at x = -u with u > 0 (object distance is positive).
 *  - Focal length f > 0 for a convex lens.
 *  - Lens equation: 1/f = 1/u + 1/v  →  v = u·f / (u − f).
 *  - v > 0: real image on the far side (x = +v). v < 0: virtual image on the object side (x = v).
 *  - Magnification m = −v/u; image height h' = m·h. m < 0 means inverted.
 */

export interface LensInput {
  focalLength: number; // f, cm, > 0
  objectDistance: number; // u, cm, > 0
  objectHeight: number; // h, cm, != 0 (positive = above the axis)
}

export type LensCase = 'beyond-2f' | 'at-2f' | 'between-f-2f' | 'at-f' | 'inside-f';

export interface LensImage {
  /** Signed image distance v (cm). */
  distance: number;
  /** Image x-position on the axis (cm). Equals v for both real and virtual images in this convention. */
  x: number;
  height: number;
  magnification: number;
  nature: 'real' | 'virtual';
  orientation: 'inverted' | 'upright';
  size: 'diminished' | 'same size' | 'magnified';
}

export interface LensResult {
  ok: true;
  input: LensInput;
  case: LensCase;
  /** Null when the object is at (or numerically indistinguishable from) the focal point: image at infinity. */
  image: LensImage | null;
  atInfinity: boolean;
  description: string;
}

export interface LensError {
  ok: false;
  errors: string[];
}

/** Relative tolerance used to decide "at f" and "at 2f". */
export const LENS_TOLERANCE = 0.005;

export function validateLens(input: LensInput): string[] {
  const e: string[] = [];
  if (!Number.isFinite(input.focalLength) || input.focalLength <= 0) e.push('Focal length must be a positive number (convex lens).');
  if (!Number.isFinite(input.objectDistance) || input.objectDistance <= 0) e.push('Object distance must be a positive number.');
  if (!Number.isFinite(input.objectHeight) || input.objectHeight === 0) e.push('Object height must be a non-zero number.');
  return e;
}

export function classifyLens(u: number, f: number): LensCase {
  const tol = LENS_TOLERANCE * f;
  if (Math.abs(u - f) <= tol) return 'at-f';
  if (Math.abs(u - 2 * f) <= tol) return 'at-2f';
  if (u > 2 * f) return 'beyond-2f';
  if (u > f) return 'between-f-2f';
  return 'inside-f';
}

const DESCRIPTIONS: Record<LensCase, string> = {
  'beyond-2f': 'Object beyond 2F: the image is real, inverted and diminished, formed between F and 2F on the other side.',
  'at-2f': 'Object at 2F: the image is real, inverted and the same size, formed at 2F on the other side.',
  'between-f-2f': 'Object between F and 2F: the image is real, inverted and magnified, formed beyond 2F on the other side.',
  'at-f': 'Object at F: refracted rays leave parallel, so the image forms at infinity.',
  'inside-f': 'Object inside F: the rays diverge after the lens, so the image is virtual, upright and magnified, on the same side as the object.',
};

export function solveLens(input: LensInput): LensResult | LensError {
  const errors = validateLens(input);
  if (errors.length) return { ok: false, errors };
  const { focalLength: f, objectDistance: u, objectHeight: h } = input;
  const c = classifyLens(u, f);
  if (c === 'at-f') {
    return { ok: true, input, case: c, image: null, atInfinity: true, description: DESCRIPTIONS[c] };
  }
  const v = (u * f) / (u - f);
  const m = -v / u;
  const absM = Math.abs(m);
  const image: LensImage = {
    distance: v,
    x: v,
    height: m * h,
    magnification: m,
    nature: v > 0 ? 'real' : 'virtual',
    orientation: m < 0 ? 'inverted' : 'upright',
    size: c === 'at-2f' ? 'same size' : absM < 1 ? 'diminished' : 'magnified',
  };
  return { ok: true, input, case: c, image, atInfinity: false, description: DESCRIPTIONS[c] };
}
