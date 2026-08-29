# TAO — Model Eğitimi ve Servise Alma

Bu klasör, sentetik kusur veri setinden bir model eğitip komuta merkezine
bağlamak için gereken her şeyi içerir.

---

## 1. Bu makinede doğrulanmış olanlar

Aşağıdakiler tahmin değil; bu makinede çalıştırılıp görüldü.

| Ne                           | Durum                                            |
| ---------------------------- | ------------------------------------------------ |
| GPU                          | NVIDIA GeForce RTX 4060, 8188 MiB, sürücü 610.88 |
| WSL2                         | Kurulu, sürüm 2                                  |
| Docker                       | 29.7.2, Linux motoru çalışıyor                   |
| **Konteynerden GPU erişimi** | **Çalışıyor**                                    |
| Disk                         | ~598 GB boş                                      |

GPU geçişi şu komutla doğrulandı:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Çıktı 4060'ı gösterdi. Bu, TAO kurulumlarında en sık tıkanan adımdır ve sizde
sorunsuz çalışıyor.

---

## 2. Sizin yapmanız gereken tek şey: NGC anahtarı

TAO konteynerleri `nvcr.io` üzerinde ve kimlik doğrulama ister. **API
anahtarınızı ben giremem** — kimlik bilgisi girmek benim yapmayacağım
işlerden biri. Bu adımı kendiniz yapmanız gerekiyor.

1. <https://ngc.nvidia.com> adresinde oturum açın (ücretsiz hesap yeterli).
2. Sağ üstten **Setup → Generate API Key**.
3. Anahtarı bir yere kaydedin; NGC bir daha göstermez.
4. Terminalde:

```bash
docker login nvcr.io
# Username: $oauthtoken       (birebir bu, dolar işareti dahil)
# Password: <API anahtarınız>
```

Doğrulama:

```bash
docker pull nvcr.io/nvidia/tao/tao-toolkit:5.5.0-pyt
```

İmaj **20 GB'ın üzerinde**. Diskinizde yer var ama indirme uzun sürecek.

---

## 3. Veri setini hazırlama

Sınıflandırma için klasör düzeni, tespit için KITTI düzeni gerekiyor.

```bash
# Sınıflandırma (önerilen ilk adım)
npm run dataset -- --size=6000 --res=224 --layout=classification --out=datasets/siniflandirma

# Tespit (kutulu)
npm run dataset -- --size=6000 --res=256 --layout=kitti --out=datasets/tespit
```

Üretici, yazmadan **önce** doğrulama yapar ve bozuk bir set yazmayı reddeder.
Her setin yanına bir `dataset-card.md` bırakır.

> **Kartta yazan şeyi tekrar edeyim:** bu görüntüler çizimdir, fotoğraf
> değildir. Üzerinde ölçülen başarı oranı, modelin **bu çizimleri** tanıdığını
> gösterir; kusurları tanıdığını değil. Doğrulama verisi olarak kullanılamaz ve
> hiçbir model bunun üzerinden "hatta hazır" diye raporlanamaz.

Eğitim/doğrulama/test ayrımını **tohumla** değil, klasörle yapın: aynı tohumdan
üretilmiş görüntüler birbirinin çok yakını olabilir ve rastgele bölme sızıntı
yaratır. Ayrı tohumlarla üç ayrı set üretin:

```bash
npm run dataset -- --size=6000 --seed=42  --layout=classification --out=datasets/train
npm run dataset -- --size=1200 --seed=907 --layout=classification --out=datasets/val
npm run dataset -- --size=1200 --seed=5150 --layout=classification --out=datasets/test
```

---

## 4. 8 GB VRAM ile gerçekçi beklentiler

| Model                                       | 8 GB'de eğitilir mi | Not                                              |
| ------------------------------------------- | ------------------- | ------------------------------------------------ |
| Sınıflandırma (ResNet-18 / EfficientNet-B0) | **Evet, rahat**     | 224px, batch 32-64. İlk adım bu olmalı.          |
| RT-DETR (küçük omurga)                      | Zorlanarak          | 256px, batch 2-4, gradient checkpointing. Yavaş. |
| YOLOv4-tiny                                 | Evet                | Hafif, hızlı; hassasiyeti düşük.                 |
| DINO / Deformable-DETR                      | **Hayır**           | ≥16 GB ister. Bu kartta pratik değil.            |
| Mask2Former                                 | **Hayır**           | Aynı sebep.                                      |

Sınıflandırmayla başlayın. "Bu panelde kusur var mı, hangi tip?" sorusu hattın
%80'ini çözer; kutu ancak operatöre _nerede_ olduğunu göstermek gerektiğinde
gerekir.

---

## 5. Eğitim

Spec dosyaları bu klasörde:

- `classification.yaml` — sınıflandırma
- `detection.yaml` — tespit

```bash
docker run --rm --gpus all -it \
  -v "$(pwd)/datasets:/workspace/datasets" \
  -v "$(pwd)/tao:/workspace/specs" \
  -v "$(pwd)/tao/results:/workspace/results" \
  nvcr.io/nvidia/tao/tao-toolkit:5.5.0-pyt \
  classification_pyt train -e /workspace/specs/classification.yaml
```

> **Spec şeması hakkında dürüst uyarı:** TAO'nun YAML anahtarları minör
> sürümler arasında değişiyor. Buradaki dosyalar yapı olarak doğrudur ama
> kurduğunuz sürümle birebir uyuşmayabilir. İlk çalıştırmadan önce şunu yapın:
>
> ```bash
> docker run --rm nvcr.io/nvidia/tao/tao-toolkit:5.5.0-pyt classification_pyt train --help
> ```
>
> ve anahtarları o sürümün beklediğiyle karşılaştırın. Bunu tahminle geçmek,
> saatlerce anlamsız hata mesajı okumak demek.

---

## 6. Servise alma ve komuta merkezine bağlama

Eğitim bittikten sonra model dışa aktarılır (`.onnx` → TensorRT motoru) ve bir
çıkarım servisi arkasında yayınlanır. Komuta merkezi tarafında yapılacak iş
**tek satır**: motoru başlatırken muayene adaptörünü değiştirmek.

```ts
import { ServiceInspector } from "./vision/index.ts";

const state = createSimulation({
  seed: 42,
  scenario: scenarios.normal,
  inspector: () =>
    new ServiceInspector({
      endpoint: "http://localhost:8000",
      // Doğrulanmış bir PR eğrisinden gelmeli; tahminle konmamalı.
      threshold: 0.62,
      timeoutMs: 750,
    }),
});
```

Fabrikanın hiçbir kuralı değişmez. Muayene kaydı, tamir kararı, izlenebilirlik
ve göstergeler aynı kalır; yalnızca tespitin **kaynağı** bu makineden çıkar.

### Servisin uyması gereken sözleşme

`POST /v1/inspect`

```json
{
  "productId": "CAR-2026-000042",
  "stationId": "PAINT-01",
  "camera": "CAM-PAINT-01",
  "method": "VISION",
  "simulatedTime": 128
}
```

Yanıt:

```json
{
  "productId": "CAR-2026-000042",
  "stationId": "PAINT-01",
  "model": "kusur-siniflandirma-v1",
  "detections": [{ "label": "PAINT_DEFECT", "score": 0.91, "box": [12, 40, 68, 96] }]
}
```

`label` değerleri motorun kusur tipleriyle aynı olmalı: `SCRATCH`, `DENT`,
`WELD_DEFECT`, `PAINT_DEFECT`, `MISSING_PART`, `WRONG_PART`,
`SURFACE_DEFORMATION`, `MISALIGNMENT`, `DIMENSIONAL` ve hatasız için `OK`.

### Adaptörün davranışı — bilerek böyle

- **Hattı bekletmez.** Çağrı asenkron; muayene elindeki en yeni cevaptan
  yanıtlar. Bir tick ağ beklemez.
- **Sessizliği geçiş saymaz.** Zaman aşımı, 500, bozuk gövde — hepsi _kaçırma_
  olarak sayılır ve görünür olur. Açık devre kalan bir görü sistemi, hiç
  olmamasından kötüdür: fabrika izlemeyi bırakır ama izlediğini sanır.
- **Açıklayamadığı tespiti yutmaz.** Model emin ama ikizde karşılığı olan bir
  kusur yoksa, bu bir **yanlış red** olarak kaydedilir — sahada da öyledir.
- **Bir cevabı bir kez kullanır.** Eski bir tespit sonraki araca uygulanmaz.

---

## 7. Eşik seçimi

`threshold` değerini tahminle koymayın. Ayrı bir test setinde precision-recall
eğrisi çıkarın ve fabrikanın hangi hatayı daha pahalı bulduğuna göre seçin:

- **Kaçan hata pahalıysa** (müşteriye gider) → eşiği düşür, yanlış red artar,
  tamir hücresi yüklenir.
- **Yanlış red pahalıysa** (sağlam araç tamire gider) → eşiği yükselt, kaçan
  hata artar.

Bu bir mühendislik kararıdır, varsayılan bir sayı değildir. İkiz her iki
maliyeti de ölçer: `Kaçan hata` göstergesi ve `Tamir oranı`.

---

## 8. Sıra

1. NGC anahtarı + `docker login nvcr.io` ← **sizde**
2. TAO imajını çek (~20 GB)
3. Üç ayrı tohumla veri seti üret
4. Sınıflandırma eğit
5. ONNX'e aktar, TensorRT motoru üret
6. Triton veya küçük bir FastAPI servisi arkasında yayınla
7. `ServiceInspector`'ı bağla, eşiği test setinden seç
8. Aynı tohumla `SimulatedInspector` ve `ServiceInspector` koşularını
   karşılaştır — fark, modelin simüle edilen kameraya göre nerede durduğudur
