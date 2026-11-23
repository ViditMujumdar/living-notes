/**
 * Experiment documents: the current session (sessionStorage, survives reloads)
 * and saved experiments (localStorage, no signup). Everything is re-validated on load.
 */
import { z } from 'zod';
import { ExperimentConfig } from '../../shared/schema';

export const LabDoc = z.object({
  localId: z.string(),
  title: z.string().max(120),
  config: ExperimentConfig,
  source: z.enum(['example', 'upload', 'manual', 'shared']),
  exampleId: z.string().optional(),
  interpretation: z.object({
    summary: z.string(),
    assumptions: z.array(z.string()),
    warnings: z.array(z.string()),
    confirmed: z.array(z.object({ label: z.string(), value: z.string(), origin: z.string() })),
    model: z.string().optional(),
    analyzedAt: z.string().optional(),
  }).optional(),
  image: z.string().optional(), // data URL, kept on this device only
  share: z.object({ id: z.string(), url: z.string(), includesImage: z.boolean() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LabDoc = z.infer<typeof LabDoc>;

const CURRENT = 'ln-current';
const SAVED = 'ln-saved-v1';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function loadCurrent(): LabDoc | null {
  try { const r = LabDoc.safeParse(JSON.parse(sessionStorage.getItem(CURRENT) || 'null')); return r.success ? r.data : null; } catch { return null; }
}
export function saveCurrent(d: LabDoc | null) {
  try {
    if (!d) sessionStorage.removeItem(CURRENT);
    else sessionStorage.setItem(CURRENT, JSON.stringify(d));
  } catch {
    try { if (d) sessionStorage.setItem(CURRENT, JSON.stringify({ ...d, image: undefined })); } catch { /* storage unavailable */ }
  }
}

export function listSaved(): LabDoc[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => LabDoc.safeParse(x)).filter((r) => r.success).map((r) => r.data!).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}

/** Saves locally. Returns whether the image had to be dropped to fit storage. */
export function saveDoc(d: LabDoc): { ok: boolean; droppedImage: boolean } {
  const all = listSaved().filter((x) => x.localId !== d.localId);
  const put = (doc: LabDoc) => localStorage.setItem(SAVED, JSON.stringify([doc, ...all]));
  try { put(d); return { ok: true, droppedImage: false }; } catch {
    try { put({ ...d, image: undefined }); return { ok: true, droppedImage: Boolean(d.image) }; } catch { return { ok: false, droppedImage: false }; }
  }
}
export function deleteSaved(localId: string) {
  try { localStorage.setItem(SAVED, JSON.stringify(listSaved().filter((x) => x.localId !== localId))); } catch { /* ignore */ }
}
export function getSaved(localId: string) { return listSaved().find((d) => d.localId === localId) ?? null; }
