import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFECT_CLASSES, OK_CLASS, generate, type DatasetSpec, type Sample } from "./dataset.ts";

/**
 * Dataset export and validation.
 *
 * Three layouts, because each trainer wants a different shape: a
 * folder-per-class tree for TAO's classification tasks, KITTI text labels for
 * its older detection tasks, and COCO JSON for the transformer detectors
 * (RT-DETR, DINO). All three are written from the same samples so they cannot
 * disagree about what is in an image.
 *
 * The validator is deliberately strict and runs on our own output. A dataset
 * that trains a model on silently-wrong boxes is worse than one that fails to
 * build.
 */

export type Layout = "kitti" | "classification" | "coco";

export interface ExportResult {
  readonly layout: Layout;
  readonly root: string;
  readonly images: number;
  readonly labelled: number;
  readonly bytes: number;
  readonly classes: readonly string[];
}

/**
 * KITTI label line. TAO reads exactly these 15 fields; the ones this dataset
 * cannot know (truncation, occlusion, 3D extent) are written as the zeros the
 * format expects rather than invented.
 */
function kittiLine(
  label: string,
  box: { x: number; y: number; width: number; height: number },
): string {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    label,
    "0.00", // truncated
    "0", // occluded
    "0.00", // alpha
    left.toFixed(2),
    top.toFixed(2),
    right.toFixed(2),
    bottom.toFixed(2),
    "0.00",
    "0.00",
    "0.00", // 3D dimensions
    "0.00",
    "0.00",
    "0.00", // 3D location
    "0.00", // rotation_y
  ].join(" ");
}

export async function exportDataset(
  spec: DatasetSpec,
  root: string,
  layout: Layout,
): Promise<ExportResult> {
  const samples: Sample[] = [];
  let bytes = 0;

  // One branch per layout. An `if`/`else` with the COCO case bolted on after it
  // wrote every image twice — caught because the run reported 400 images for a
  // 200-image request.
  if (layout === "kitti") {
    const imageDir = path.join(root, "images");
    const labelDir = path.join(root, "labels");
    await mkdir(imageDir, { recursive: true });
    await mkdir(labelDir, { recursive: true });

    for (const sample of generate(spec)) {
      const stem = sample.fileName.replace(/\.png$/, "");
      await writeFile(path.join(imageDir, sample.fileName), sample.png);
      const lines = sample.boxes.map((box) => kittiLine(sample.label, box));
      // A clean panel gets an empty label file, not a missing one: TAO treats a
      // missing file as a broken pair and an empty one as a negative example.
      await writeFile(
        path.join(labelDir, `${stem}.txt`),
        lines.join("\n") + (lines.length ? "\n" : ""),
      );
      bytes += sample.png.length;
      samples.push(sample);
    }
  } else if (layout === "coco") {
    const imageDir = path.join(root, "images");
    await mkdir(imageDir, { recursive: true });
    for (const sample of generate(spec)) {
      await writeFile(path.join(imageDir, sample.fileName), sample.png);
      bytes += sample.png.length;
      samples.push(sample);
    }
    await writeFile(path.join(root, "annotations.json"), cocoAnnotations(samples), "utf8");
  } else {
    for (const sample of generate(spec)) {
      const classDir = path.join(root, sample.label);
      await mkdir(classDir, { recursive: true });
      await writeFile(path.join(classDir, sample.fileName), sample.png);
      bytes += sample.png.length;
      samples.push(sample);
    }
  }

  const classes = [...new Set(samples.map((sample) => sample.label))].sort();
  await writeFile(
    path.join(root, "dataset-card.md"),
    datasetCard(spec, samples, layout, classes),
    "utf8",
  );

  return {
    layout,
    root,
    images: samples.length,
    labelled: samples.filter((sample) => sample.boxes.length > 0).length,
    bytes,
    classes,
  };
}

/**
 * COCO annotations.
 *
 * Category IDs start at 1 — zero is reserved for background in every detector
 * that reads this format, and an off-by-one here trains a model to find the
 * wrong class without ever erroring.
 */
function cocoAnnotations(samples: readonly Sample[]): string {
  const categories = DEFECT_CLASSES.map((name, index) => ({ id: index + 1, name }));
  const categoryId = new Map(categories.map((category) => [category.name, category.id]));

  const images = samples.map((sample, index) => ({
    id: index + 1,
    file_name: sample.fileName,
    width: sample.width,
    height: sample.height,
  }));

  let annotationId = 0;
  const annotations = samples.flatMap((sample, index) =>
    sample.boxes.map((box) => {
      annotationId += 1;
      return {
        id: annotationId,
        image_id: index + 1,
        category_id: categoryId.get(sample.label as (typeof DEFECT_CLASSES)[number]) ?? 1,
        // COCO stores [x, y, width, height], not corners.
        bbox: [box.x, box.y, box.width, box.height],
        area: box.width * box.height,
        iscrowd: 0,
      };
    }),
  );

  return JSON.stringify({ images, annotations, categories }, null, 1);
}

/**
 * The dataset card.
 *
 * Written next to the data because a set of synthetic images with no provenance
 * is the easiest way for a model to end up validated against its own training
 * distribution and reported as production-ready.
 */
function datasetCard(
  spec: DatasetSpec,
  samples: readonly Sample[],
  layout: Layout,
  classes: readonly string[],
): string {
  const counts = new Map<string, number>();
  for (const sample of samples) counts.set(sample.label, (counts.get(sample.label) ?? 0) + 1);

  return `# Veri Seti Kartı — Sentetik Kusur Görüntüleri

## Bu veri seti nedir

Prosedürel olarak **çizilmiş** boyalı panel görüntüleri. Fotoğraf değildir.
Gerçek bir hattan alınmış tek bir kare içermez.

## Bu veri seti ne için var

Görü hattının uçtan uca kurulabilmesi ve test edilebilmesi için:
üretim → dışa aktarma → doğrulama → eğitim → servis → muayene.
Gerçek bir gövdeye kamera tutulmadan önce boruların birbirine bağlandığını
görmek için.

## Bu veri seti ne için **kullanılamaz**

- Bir modelin gerçek hatta çalışacağının kanıtı olarak.
- Doğrulama (validation) verisi olarak. Yalnızca bunun üzerinde ölçülen bir
  başarı oranı, modelin **bu çizimleri** tanıdığını gösterir, kusurları değil.
- Bir eşik (operating threshold) belirlemek için.

Gerçek kusur fotoğrafları elde edilene kadar hiçbir model "hatta hazır" diye
raporlanmamalıdır.

## Üretim parametreleri

| Alan | Değer |
| --- | --- |
| Tohum | ${spec.seed} |
| Görüntü sayısı | ${spec.size} |
| Çözünürlük | ${spec.imageSize}×${spec.imageSize} |
| Hatasız (OK) payı | %${Math.round(spec.okShare * 100)} |
| Yerleşim | ${layout === "kitti" ? "KITTI (images/ + labels/)" : layout === "coco" ? "COCO (images/ + annotations.json)" : "Sınıf klasörleri"} |
| Sınıflar | ${classes.join(", ")} |

Her görüntü tohum ve indeksin deterministik fonksiyonudur; veri seti saklanmak
yerine birebir yeniden üretilebilir.

## Sınıf dağılımı

| Sınıf | Adet | Pay |
| --- | ---: | ---: |
${[...counts.entries()]
  .sort((left, right) => right[1] - left[1])
  .map(
    ([label, count]) =>
      `| ${label} | ${count} | %${((count / samples.length) * 100).toFixed(1).replace(".", ",")} |`,
  )
  .join("\n")}

## Kusur sınıflarının nasıl çizildiği

| Sınıf | Görsel işaret |
| --- | --- |
| SCRATCH | İnce, hafif kavisli parlak veya koyu çizgi |
| DENT | Ortası koyu, kenarı parlak dairesel bozulma — parlamayı büken çukur |
| PAINT_DEFECT | Düzensiz kenarlı, farklı tonda leke |
| MISSING_PART | Koyu alt gövdeyi gösteren, kenarı ışık alan dikdörtgen boşluk |
| WRONG_PART | Belirgin biçimde farklı renkte panel parçası |
| SURFACE_DEFORMATION | Dalgalı gölgelenme bandı |
| MISALIGNMENT | Düz gitmesi gereken panel boşluğunun kademelenmesi |
| WELD_DEFECT | Gözenekli, yer yer yanmış düzensiz kaynak dikişi |

Panel her zaman taban rengi + çapraz parlama + hafif portakal kabuğu dokusu +
vinyet ile çizilir. Işıklandırma zorunludur: bir ezik ancak parlamayı bozduğu
için görülür; düz bir taban birkaç kusur sınıfını görünmez kılar ve veri setini
yalan hale getirirdi.
`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly sample: string;
  readonly problem: string;
}

export interface ValidationReport {
  readonly checked: number;
  readonly issues: readonly ValidationIssue[];
  readonly classCounts: ReadonlyMap<string, number>;
  readonly ok: boolean;
}

/**
 * Check the generated set before anything trains on it.
 *
 * Every rule here is one that produces a silently wrong model rather than an
 * error: a box outside the image, a zero-area box, a labelled class that is
 * not in the class list, or a defect class with too few examples to learn.
 */
export function validateDataset(spec: DatasetSpec, minimumPerClass = 10): ValidationReport {
  const issues: ValidationIssue[] = [];
  const classCounts = new Map<string, number>();
  let checked = 0;

  for (const sample of generate(spec)) {
    checked += 1;
    classCounts.set(sample.label, (classCounts.get(sample.label) ?? 0) + 1);

    if (sample.label !== OK_CLASS && !DEFECT_CLASSES.includes(sample.label as never)) {
      issues.push({ sample: sample.fileName, problem: `bilinmeyen sınıf: ${sample.label}` });
    }
    if (sample.label === OK_CLASS && sample.boxes.length > 0) {
      issues.push({ sample: sample.fileName, problem: "OK etiketli görüntüde kutu var" });
    }
    if (sample.label !== OK_CLASS && sample.boxes.length === 0) {
      issues.push({ sample: sample.fileName, problem: "kusurlu görüntüde kutu yok" });
    }
    if (sample.png.length < 100) {
      issues.push({ sample: sample.fileName, problem: "görüntü boş" });
    }

    for (const box of sample.boxes) {
      if (box.width <= 1 || box.height <= 1) {
        issues.push({ sample: sample.fileName, problem: "kutu alanı sıfıra yakın" });
      }
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > sample.width ||
        box.y + box.height > sample.height
      ) {
        issues.push({ sample: sample.fileName, problem: "kutu görüntü dışına taşıyor" });
      }
    }
  }

  for (const label of [...DEFECT_CLASSES, OK_CLASS]) {
    const count = classCounts.get(label) ?? 0;
    if (count === 0) continue; // a class simply not requested is not an error
    if (count < minimumPerClass) {
      issues.push({
        sample: label,
        problem: `sınıf için yalnızca ${count} örnek var (en az ${minimumPerClass} gerekli)`,
      });
    }
  }

  return { checked, issues, classCounts, ok: issues.length === 0 };
}
