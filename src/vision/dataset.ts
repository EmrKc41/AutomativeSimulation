import type { DefectType } from "../domain.ts";
import { Rng } from "../rng.ts";
import { Canvas, encodePng } from "./png.ts";

/**
 * Synthetic defect imagery.
 *
 * There are no photographs of real defective parts for this plant, so the only
 * honest way to get a training set is to draw one. These are procedural
 * renderings of a painted panel, not photographs, and nothing here should be
 * mistaken for validation data — a model trained on this alone would learn to
 * find *these drawings*. It exists so the whole pipeline (generate → export →
 * validate → train → serve → inspect) can be built and tested end to end before
 * a camera is ever pointed at a real body.
 *
 * Every image is a deterministic function of the seed and its index, so a
 * dataset can be regenerated exactly rather than stored.
 */

export const DEFECT_CLASSES: readonly DefectType[] = [
  "SCRATCH",
  "DENT",
  "PAINT_DEFECT",
  "MISSING_PART",
  "WRONG_PART",
  "SURFACE_DEFORMATION",
  "MISALIGNMENT",
  "WELD_DEFECT",
];

/** The label a clean panel carries; TAO needs a name, not an absence. */
export const OK_CLASS = "OK";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Sample {
  readonly index: number;
  readonly fileName: string;
  /** `OK` or one of `DEFECT_CLASSES`. */
  readonly label: string;
  readonly boxes: readonly BoundingBox[];
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface DatasetSpec {
  readonly size: number;
  readonly seed: number;
  readonly imageSize: number;
  /** Share of images with no defect. The rest are split across the classes. */
  readonly okShare: number;
  readonly classes: readonly DefectType[];
}

export const DEFAULT_SPEC: DatasetSpec = {
  size: 800,
  seed: 42,
  imageSize: 256,
  okShare: 0.5,
  classes: DEFECT_CLASSES,
};

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

const PANEL_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [178, 182, 188], // silver
  [42, 48, 58], // graphite
  [156, 32, 38], // red
  [28, 62, 118], // blue
  [232, 232, 228], // white
];

/**
 * A painted panel: base colour, a diagonal specular sweep, a faint orange-peel
 * texture and a vignette. The lighting matters — a dent is only visible because
 * it disturbs a highlight, so a flat base would make several defect classes
 * invisible and the dataset a lie.
 */
function drawPanel(canvas: Canvas, rng: Rng): void {
  const base = rng.pick(PANEL_COLOURS);
  const sweep = rng.next() * Math.PI;
  const dx = Math.cos(sweep);
  const dy = Math.sin(sweep);
  const size = canvas.width;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;

      const specular = 0.82 + 0.32 * Math.exp(-((u * dx + v * dy) ** 2) / 0.02);
      const peel = 1 + 0.035 * Math.sin(x * 0.7 + y * 0.31) * Math.cos(y * 0.53 - x * 0.19);
      const vignette = 1 - 0.28 * (u * u + v * v);
      const grain = 1 + (rng.next() - 0.5) * 0.035;
      const light = specular * peel * vignette * grain;

      canvas.set(x, y, base[0] * light, base[1] * light, base[2] * light);
    }
  }
}

function box(x: number, y: number, width: number, height: number, limit: number): BoundingBox {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  return {
    x: left,
    y: top,
    width: Math.min(limit - left, Math.round(width)),
    height: Math.min(limit - top, Math.round(height)),
  };
}

/** Draw one defect and return the box a detector should predict for it. */
function drawDefect(canvas: Canvas, rng: Rng, kind: DefectType): BoundingBox {
  const size = canvas.width;
  const cx = size * (0.25 + rng.next() * 0.5);
  const cy = size * (0.25 + rng.next() * 0.5);

  switch (kind) {
    case "SCRATCH": {
      const length = size * (0.15 + rng.next() * 0.35);
      const angle = rng.next() * Math.PI * 2;
      const curve = (rng.next() - 0.5) * 0.6;
      const bright = rng.chance(0.5);
      let minX = size;
      let minY = size;
      let maxX = 0;
      let maxY = 0;
      for (let t = 0; t < length; t += 0.5) {
        const a = angle + curve * (t / length);
        const x = cx + Math.cos(a) * t;
        const y = cy + Math.sin(a) * t;
        for (let w = -1; w <= 1; w += 1) {
          const px = x + Math.cos(a + Math.PI / 2) * w;
          const py = y + Math.sin(a + Math.PI / 2) * w;
          const alpha = w === 0 ? 0.85 : 0.35;
          if (bright) canvas.blend(px, py, 245, 245, 250, alpha);
          else canvas.shade(px, py, 1 - 0.45 * alpha);
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return box(minX - 3, minY - 3, maxX - minX + 6, maxY - minY + 6, size);
    }

    case "DENT": {
      const radius = size * (0.05 + rng.next() * 0.09);
      for (let y = cy - radius; y <= cy + radius; y += 1) {
        for (let x = cx - radius; x <= cx + radius; x += 1) {
          const d = Math.hypot(x - cx, y - cy) / radius;
          if (d > 1) continue;
          // Darker in the middle, bright rim: a dent bends the highlight.
          const shade = 1 - 0.45 * Math.cos((d * Math.PI) / 2) ** 2 + 0.3 * d ** 6;
          canvas.shade(x, y, shade);
        }
      }
      return box(cx - radius, cy - radius, radius * 2, radius * 2, size);
    }

    case "PAINT_DEFECT": {
      const radius = size * (0.04 + rng.next() * 0.07);
      const tint = rng.pick([
        [220, 210, 160],
        [110, 110, 130],
        [190, 150, 140],
      ] as const);
      const lobes = 3 + Math.floor(rng.next() * 3);
      const phase = rng.next() * Math.PI;
      for (let y = cy - radius * 1.5; y <= cy + radius * 1.5; y += 1) {
        for (let x = cx - radius * 1.5; x <= cx + radius * 1.5; x += 1) {
          const angle = Math.atan2(y - cy, x - cx);
          const edge = radius * (0.72 + 0.28 * Math.sin(angle * lobes + phase));
          const d = Math.hypot(x - cx, y - cy);
          if (d > edge) continue;
          canvas.blend(x, y, tint[0], tint[1], tint[2], 0.55 * (1 - d / edge) + 0.25);
        }
      }
      return box(cx - radius * 1.5, cy - radius * 1.5, radius * 3, radius * 3, size);
    }

    case "MISSING_PART": {
      const w = size * (0.12 + rng.next() * 0.14);
      const h = size * (0.1 + rng.next() * 0.12);
      for (let y = cy; y <= cy + h; y += 1) {
        for (let x = cx; x <= cx + w; x += 1) {
          const edge = x - cx < 2 || y - cy < 2 || cx + w - x < 2 || cy + h - y < 2;
          // A hole shows the dark underbody, with a lit lip around the opening.
          if (edge) canvas.blend(x, y, 210, 210, 215, 0.6);
          else canvas.blend(x, y, 18, 20, 24, 0.92);
        }
      }
      return box(cx, cy, w, h, size);
    }

    case "WRONG_PART": {
      const w = size * (0.14 + rng.next() * 0.16);
      const h = size * (0.12 + rng.next() * 0.14);
      const wrong = rng.pick(PANEL_COLOURS);
      for (let y = cy; y <= cy + h; y += 1) {
        for (let x = cx; x <= cx + w; x += 1) {
          canvas.blend(x, y, wrong[0] * 1.05, wrong[1] * 1.05, wrong[2] * 1.05, 0.9);
        }
      }
      return box(cx, cy, w, h, size);
    }

    case "SURFACE_DEFORMATION": {
      const w = size * (0.25 + rng.next() * 0.3);
      const h = size * (0.12 + rng.next() * 0.12);
      const waves = 2 + rng.next() * 3;
      for (let y = cy; y <= cy + h; y += 1) {
        for (let x = cx; x <= cx + w; x += 1) {
          const ripple = Math.sin(((x - cx) / w) * Math.PI * waves);
          canvas.shade(x, y, 1 + ripple * 0.22);
        }
      }
      return box(cx, cy, w, h, size);
    }

    case "MISALIGNMENT": {
      // Two panels meeting at a gap that steps, instead of running straight.
      const gapX = cx;
      const step = size * (0.03 + rng.next() * 0.05);
      const breakY = cy;
      for (let y = 0; y < size; y += 1) {
        const offset = y < breakY ? 0 : step;
        for (let w = 0; w < 3; w += 1) canvas.shade(gapX + offset + w, y, 0.35);
        canvas.blend(gapX + offset - 1, y, 235, 235, 240, 0.4);
      }
      return box(gapX - 6, breakY - size * 0.12, step + 14, size * 0.24, size);
    }

    case "WELD_DEFECT": {
      const length = size * (0.18 + rng.next() * 0.22);
      const angle = rng.next() * Math.PI * 2;
      const beads = Math.floor(length / 5);
      for (let i = 0; i < beads; i += 1) {
        const t = (i / beads) * length;
        const bx = cx + Math.cos(angle) * t;
        const by = cy + Math.sin(angle) * t;
        // A porous, uneven bead: some spots burnt, some missing.
        const radius = 2 + rng.next() * 2.5;
        const burnt = rng.chance(0.35);
        for (let y = by - radius; y <= by + radius; y += 1) {
          for (let x = bx - radius; x <= bx + radius; x += 1) {
            if (Math.hypot(x - bx, y - by) > radius) continue;
            if (burnt) canvas.blend(x, y, 60, 45, 38, 0.8);
            else canvas.blend(x, y, 205, 200, 190, 0.55);
          }
        }
      }
      const ex = cx + Math.cos(angle) * length;
      const ey = cy + Math.sin(angle) * length;
      return box(
        Math.min(cx, ex) - 6,
        Math.min(cy, ey) - 6,
        Math.abs(ex - cx) + 12,
        Math.abs(ey - cy) + 12,
        size,
      );
    }

    default:
      return box(cx, cy, 10, 10, size);
  }
}

/**
 * Render one sample.
 *
 * The index is folded into the seed, so sample 400 of a 10 000-image set is the
 * same picture whether or not the other 9 999 were generated.
 */
export function renderSample(index: number, spec: DatasetSpec): Sample {
  const rng = new Rng(spec.seed).fork(index + 1);
  const canvas = new Canvas(spec.imageSize, spec.imageSize);
  drawPanel(canvas, rng);

  const isOk = rng.next() < spec.okShare;
  const label = isOk ? OK_CLASS : (spec.classes[index % spec.classes.length] ?? "SCRATCH");
  const boxes = isOk ? [] : [drawDefect(canvas, rng, label as DefectType)];

  return {
    index,
    fileName: `${String(index).padStart(6, "0")}_${label.toLowerCase()}.png`,
    label,
    boxes,
    png: encodePng(canvas),
    width: spec.imageSize,
    height: spec.imageSize,
  };
}

export function* generate(spec: DatasetSpec): Generator<Sample> {
  for (let index = 0; index < spec.size; index += 1) yield renderSample(index, spec);
}

/** Class counts, for the dataset card and for spotting an imbalanced split. */
export function classDistribution(spec: DatasetSpec): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sample of generate(spec)) {
    counts.set(sample.label, (counts.get(sample.label) ?? 0) + 1);
  }
  return counts;
}
