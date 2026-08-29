import {
  DEFAULT_SPEC,
  exportDataset,
  validateDataset,
  type DatasetSpec,
  type Layout,
} from "./vision/index.ts";

/**
 * Generate, validate and export the synthetic defect dataset.
 *
 * Validation runs first and refuses to write a broken set: a dataset that
 * trains a model on wrong boxes fails silently, which is the expensive kind.
 */
const args = process.argv.slice(2);
const flags = new Map<string, string>();
for (const arg of args) {
  if (!arg.startsWith("--")) continue;
  const [key, value] = arg.slice(2).split("=");
  flags.set(key ?? "", value ?? "true");
}

const spec: DatasetSpec = {
  size: Number(flags.get("size") ?? DEFAULT_SPEC.size),
  seed: Number(flags.get("seed") ?? DEFAULT_SPEC.seed),
  imageSize: Number(flags.get("res") ?? DEFAULT_SPEC.imageSize),
  okShare: Number(flags.get("ok") ?? DEFAULT_SPEC.okShare),
  classes: DEFAULT_SPEC.classes,
};
const requested = flags.get("layout") ?? "kitti";
const layout: Layout = requested === "classification" || requested === "coco" ? requested : "kitti";
const root = flags.get("out") ?? "datasets/kusur-v1";

console.log(`Doğrulanıyor: ${spec.size} görüntü, ${spec.imageSize}px, tohum ${spec.seed}…`);
const report = validateDataset(spec);
for (const issue of report.issues.slice(0, 10)) {
  console.error(`  ! ${issue.sample}: ${issue.problem}`);
}
if (!report.ok) {
  console.error(`\nDoğrulama başarısız: ${report.issues.length} sorun. Hiçbir şey yazılmadı.`);
  process.exit(1);
}
console.log(`Doğrulama geçti: ${report.checked} görüntü, ${report.classCounts.size} sınıf.`);

const result = await exportDataset(spec, root, layout);
console.log(`\nYerleşim  : ${result.layout}`);
console.log(`Klasör    : ${result.root}`);
console.log(`Görüntü   : ${result.images} (${result.labelled} tanesi kusurlu)`);
console.log(`Boyut     : ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`Sınıflar  : ${result.classes.join(", ")}`);
console.log(`\nVeri seti kartı: ${result.root}/dataset-card.md`);
console.log("Bu görüntüler çizimdir, fotoğraf değildir. Doğrulama verisi olarak kullanılamaz.");
