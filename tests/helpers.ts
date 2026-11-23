import zlib from 'node:zlib';

/** Build a real, valid PNG of the given size (solid colour). */
export function makePng(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xee)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const Q = (value: number | null, unit: string | null = null) => ({ value, unit, sourceText: value == null ? null : `${value} ${unit ?? ''}`.trim(), inferred: false });

export const circuitInterpretation = {
  experimentType: 'circuit',
  summary: 'A 12 V battery connected to three resistors: R1 in series with R2 and R3 in parallel.',
  unsupportedReason: null,
  imageQuality: 'clear',
  components: [
    { kind: 'battery', label: 'E', valueText: '12 V', box: [400, 40, 600, 120] },
    { kind: 'resistor', label: 'R1', valueText: '4 Ω', box: [100, 300, 180, 520] },
    { kind: 'resistor', label: 'R2', valueText: null, box: [300, 620, 380, 840] },
    { kind: 'resistor', label: 'R3', valueText: '12 Ω', box: [600, 620, 680, 840] },
  ],
  circuit: { topology: 'mixed', voltage: Q(12, 'V'), resistors: [{ label: 'R1', value: Q(4, 'Ω') }, { label: 'R2', value: Q(null) }, { label: 'R3', value: Q(12, 'Ω') }] },
  lens: null,
  projectile: null,
  missing: ['Value of R2 is smudged and unreadable.'],
  assumptions: [],
  warnings: ['R2 label is partly obscured.'],
  needsReview: ['R2 value'],
};
