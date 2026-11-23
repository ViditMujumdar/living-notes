/** Hand-off between Upload → Review → Lab (kept in sessionStorage so a reload doesn't lose work). */
import { z } from 'zod';
import { Interpretation } from '../../shared/schema';

const Pending = z.object({
  image: z.string(), // data URL (local preview copy)
  interpretation: Interpretation.nullable(),
  model: z.string().optional(),
  analyzedAt: z.string().optional(),
  /** When analysis was not possible (setup missing / failed) the user can still review manually. */
  manualReason: z.string().optional(),
});
export type Pending = z.infer<typeof Pending>;

const KEY = 'ln-pending';
export function setPending(p: Pending | null) {
  try { p ? sessionStorage.setItem(KEY, JSON.stringify(p)) : sessionStorage.removeItem(KEY); } catch { memory = p; }
  memory = p;
}
let memory: Pending | null = null;
export function getPending(): Pending | null {
  if (memory) return memory;
  try { const r = Pending.safeParse(JSON.parse(sessionStorage.getItem(KEY) || 'null')); return r.success ? (memory = r.data) : null; } catch { return null; }
}
