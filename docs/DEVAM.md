# Devam Notu — Kaldığımız Yer

Bu dosya, oturum kesildiğinde projeye sıfırdan bakan birinin (veya yeni bir
oturumun) hiçbir şey sormadan devam edebilmesi için var. Her fazın sonunda
güncellenir.

**Son güncelleme:** Faz 6B'nin bu makinede yapılabilen kısmı bitti — GPU geçişi
doğrulandı, çıkarım servisi adaptörü (`ServiceInspector`) yazıldı ve test edildi,
TAO spec dosyaları ile runbook hazırlandı. Kalan tek şey NGC anahtarı: onu
**kullanıcı** girmeli.

---

## 1. Projeyi ayağa kaldırma

İki süreç. İkisi de ayrı terminalde çalışır.

```bash
npm install
npm run server
```

```bash
cd web
npm install
npm run dev
```

Komuta merkezi: <http://localhost:3000> · Motor API: <http://localhost:4000>

Sunucu açıldığında simülasyon **duraklatılmış** ve 0. dakikada başlar. Bakmaya
değer bir duruma getirmek için:

```bash
curl -s -X POST http://localhost:4000/api/commands -H "content-type: application/json" -d '{"type":"STEP","ticks":200}'
curl -s -X POST http://localhost:4000/api/commands -H "content-type: application/json" -d '{"type":"SET_SPEED","speed":2}'
curl -s -X POST http://localhost:4000/api/commands -H "content-type: application/json" -d '{"type":"PLAY"}'
```

Ya da doğrudan arayüzden: senaryo seç, **Çalıştır**, hız 2×.

### Kapatma

Terminallerde Ctrl+C, ya da `npx kill-port 3000 4000`.

### Kalite kapıları (her değişiklikten sonra çalıştırılmalı)

```bash
npx tsc --noEmit && npx eslint . && npx prettier --check . && npm test
cd web && npx tsc --noEmit && npx eslint . && npm test && npm run build
```

Beklenen: motorda **171 test**, web tarafında **67 test**, hepsi geçer.

Tesiste artık **üç üretim hattı** var (LINE-01 Meltem, LINE-02 Poyraz,
LINE-03 Lodos); 18 istasyon, 9 doli.

---

## 2. Nerede ne var

| Yol                                     | Ne                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `src/domain.ts`                         | Tip sözleşmeleri, durum makineleri, olay sözlüğü                       |
| `src/labels.ts`                         | **Türkçe saha sözlüğü — tek kaynak.** Motor ve arayüz ortak kullanır   |
| `src/language.test.ts`                  | Dil muhafızı: motoru koşturup her alarm metnini Türkçe diye doğrular   |
| `src/factory.ts`                        | Ana veri: istasyonlar, malzemeler, iş emirleri, yerleşim               |
| `src/rng.ts`                            | Tohumlu rastgelelik (mulberry32)                                       |
| `src/state.ts`                          | Çalışma zamanı durumu, olay/alarm üretimi, parti muhasebesi            |
| `src/engine.ts`                         | Tick — 9 fazlı sabit sıra                                              |
| `src/metrics.ts`                        | KPI projeksiyonu ve kısıt tespiti                                      |
| `src/analytics.ts`                      | Kanıtlı deterministik analizler (8 adet)                               |
| `src/optimizer.ts`                      | **Planlama ayrımı** — iş emri sırası ve araç sevki                     |
| `src/optimizer-compare.ts`              | Politika karşılaştırma koşumu (aynı tohum, tek fark politika)          |
| `src/optimizer-service.ts`              | cuOpt/çözücü adaptörü — bağlanacağı yer                                |
| `src/optimizer-cli.ts`                  | `npm run optimize` — karşılaştırmayı yazdırır, "hayır" da der          |
| `src/hardening.test.ts`                 | Faz 8 arızalarının nöbetçisi — çökme, sınırsız büyüme, çiftleme        |
| `src/copilot.ts`                        | Soru → niyet → analiz yönlendirmesi (TR + EN)                          |
| `src/runtime.ts`                        | Canlı host: play/pause/hız/adım/sıfırla                                |
| `src/server.ts`                         | REST + WebSocket                                                       |
| `src/report/`                           | Excel çalışma kitabı + PDF vardiya raporu (ortak model)                |
| `src/cli.ts`                            | Terminal denetleyici (`npm run scenario`)                              |
| `src/report-cli.ts`                     | Rapor üretici (`npm run report`)                                       |
| `src/vision/`                           | Muayene adaptörü, sentetik veri seti, KITTI/COCO/sınıf dışa aktarım    |
| `src/vision/service.ts`                 | **Çıkarım servisi adaptörü** — eğitilmiş modelin bağlanacağı yer       |
| `tao/`                                  | TAO runbook'u + eğitim spec dosyaları (`README.md` önce okunmalı)      |
| `web/`                                  | Next.js komuta merkezi + 3D sahne                                      |
| `assets/brand/`                         | Marka görselleri (kaynak)                                              |
| `scripts/prepare-brand.mjs`             | Marka görsellerini boyutlandırır (`npm run brand`)                     |
| `assets/fonts/`                         | Fira Sans TTF (PDF için, SIL OFL)                                      |
| `docs/TERMINOLOGY.md`                   | Enum ↔ Türkçe saha terimi eşlemesi ve gerekçeleri                      |
| `docs/3D-DETAYLANDIRMA-PROMPT.md`       | 3D üretim detaylandırma şartnamesi — fazlar buradan yürüyor            |
| `tools/models/build_assets.py`          | **Varlık kaynağı.** Blender modelleri, ölçüleriyle birlikte kod olarak |
| `tools/models/build.mjs`                | `npm run models` — Blender'ı bulur, `.glb` üretir                      |
| `web/public/models/`                    | Derleme çıktısı `.glb` dosyaları (depoda; Blender gerekmez)            |
| `web/src/components/receiving-yard.tsx` | Mal kabul sahası: rampa, tırlar, boşaltma                              |
| `docs/IMPLEMENTATION_PLAN.md`           | Faz faz ne yapıldı, hangi karar niye verildi                           |
| `SKILL_USAGE_MATRIX.md`                 | Hangi NVIDIA skill'i neden kullanıldı/kullanılmadı                     |

---

## 3. Tamamlanan fazlar

| Faz | Ne                                                    | Durum |
| --- | ----------------------------------------------------- | ----- |
| 1   | Deterministik tek araç dikey dilimi                   | ✅    |
| 2   | Sürekli çok-araçlı fabrika motoru                     | ✅    |
| 3   | Canlı host + REST/WS + komuta merkezi                 | ✅    |
| 4   | 3D fabrika sahnesi (React Three Fiber)                | ✅    |
| 5   | Analitik + AI Factory Copilot                         | ✅    |
| 5B  | Türkçeleştirme + Excel/PDF raporlama                  | ✅    |
| 6   | Görü altyapısı: muayene adaptörü + sentetik veri seti | ✅    |
| 6B  | GPU tarafı: ortam + servis adaptörü + TAO spec'leri   | ✅\*  |
| 7   | Planlama politikası + ölçüm koşumu                    | ✅    |
| 8   | Sağlamlaştırma                                        | ✅    |

\* Faz 6B'nin yazılım tarafı bitti. Model **eğitimi** NGC anahtarı istiyor ve o
adım kullanıcıda — ayrıntısı aşağıdaki 7. bölümde.

Her fazın kararları ve bilinen sınırları `docs/IMPLEMENTATION_PLAN.md` içinde.

---

## 4. Kullanıcı hakkında bilinmesi gerekenler

- **Dil:** Ürün Türkçe. Kod, tip adları ve enum'lar İngilizce kalır.
- **Arayüz yığını:** Next.js + TypeScript + Tailwind + shadcn/ui zorunlu.
  Basit/vanilla arayüz kabul edilmiyor.
- **`ui-ux-pro-max` skill'i gerçekten çalıştırılmalı**, tahminle renk/tipografi
  seçilmemeli. Bu projenin tasarım sistemi
  `design-system/factory-command-center/MASTER.md` içinde kalıcılaştırıldı.
- **Donanım:** NVIDIA RTX 4060 (8 GB VRAM), Windows 11.
- **Veri:** Gerçek/etiketli kusur görüntüsü **yok**. Sentetik veri üretmek
  zorundayız.
- **Terminoloji:** "Darboğaz", "kısıt" gibi sahada kullanılmayan kelimeler
  ekranda ve raporda **geçmez** (asistan girdi olarak hâlâ anlar). Gerekçeleri
  `docs/TERMINOLOGY.md` sonundaki tabloda.
- **Andon kuralı:** Duruş olduğunda "Dur, Haber Ver, Bekle" ekranın en üstünü
  kaplar, kapatma düğmesi yoktur. Bu kullanıcının kendi fabrikasındaki gerçek
  bir eksiklikten geldi; kozmetik bir bildirim değildir.
- **Anlatım tercihi:** Her adımda "ne yaptık, neden yaptık, gerçek fabrikadaki
  karşılığı ne, teknik olarak nasıl uygulandı" açıklanmalı. Bu bir eğitim
  projesi.

---

## 5. Git durumu

Proje **kendi deposuna** sahip (`simuledeneme/.git`). Kullanıcının Masaüstü
klasörü de yanlışlıkla bir git deposu ve içinde kırık bir worktree işaretçisi
(`corepilot-source/.git` → var olmayan bir gitdir) var; `git add` bu yüzden
proje kendi deposunu alana kadar çalışmıyordu. Masaüstü deposuna **dokunulmadı**
— temizlenmesi kullanıcının kararı.

Henüz **hiç commit atılmadı**; her şey staged. Kullanıcı istediğinde:

```bash
git commit -m "Automotive smart factory digital twin: engine, command centre, 3D scene, copilot, reports"
```

---

## 6. Bilinen açık konular

- **`exceljs` → `uuid` uyarısı** (GHSA-w5hq-g745-h8pq, orta). İlgili kod yolu
  kullanılmıyor; `npm audit fix --force` exceljs'i kırıcı biçimde 3.4.0'a
  düşürüyor. Bilinçli bırakıldı.
- **Turbopack kökü depo kökü** olduğu için `next dev` çıktısını proje kökündeki
  `.next/` altına yazıyor. Gitignore'da; zararsız ama dizini kirletiyor. Sebep:
  arayüz motorun Türkçe sözlüğünü (`src/labels.ts`) içe aktarıyor ve bu dosya
  `web/` dışında.
- **~~3D sahnede ölçek uyuşmazlığı~~ — ÇÖZÜLDÜ (aşağıdaki bölüme bakın). Eski kayıt:** Konumlar `SCALE = 0.35`
  ile küçültülüyor, modeller `ASSET_SCALE = 1.05` ile çiziliyor. Sonuç: bir
  tır planda ~48 metre yer kaplıyor, oysa mal kabul ile giriş kalite arası
  18 metre. Ekranda tır iki bölgeyi birden aşıyor. `ASSET_SCALE`'i 0,35'e
  çekmek geometriyi düzeltiyor ama tesis boşalıyor, makineler okunmaz hâle
  geliyor (denendi, geri alındı). Gerçek çözüm ikisinden biri: plan
  konumlarını sıkıştırmak — ki `travelTicks` üzerinden **simülasyonu
  değiştirir** — ya da ölçek farkını bilinçli bir şematik abartı olarak kabul
  edip tır gibi büyük varlıkları ayrı ölçekte çizmek. Kullanıcı kararı
  gerektiriyor.
- **`docs/onizleme.png` güncel değil.** Blender önizlemesi (`npm run preview`)
  güvenlik kapısını ve yeni tır güzergâhını bilmiyor; `tools/models/preview.py`
  kendi yerleşim sabitlerini tutuyor ve bu turda güncellenmedi. Sahnenin
  doğrulanacağı yer artık tarayıcı.
- **Sahne artık gerçekten görüldü.** Tarayıcı paneli kare üretiyor; genel
  görünüm, mal kabul ve sevkiyat ekran görüntüleriyle doğrulandı. Sahne koyu;
  makineler zeminden zor ayrılıyor — aydınlatma hâlâ elden geçmedi.
- **Kalıcılık yok.** Host tek koşuyu bellekte tutar; sunucu yeniden başlarsa
  koşu sıfırlanır. Faz 8'de bilinçli olarak ele alınmadı: ölçülen arızalar
  çökme ve sınırsız büyümeydi, kalıcılık değil.
- **Rapor üretimi hattı ~250 ms bekletiyor.** Aynı iş parçacığında çalışıyor.
  Kuyruğa alındı (en kötü 1.555 ms → 335 ms) ama sıfırlanmadı; sıfırlamak için
  worker thread gerekir ve tek raporluk duraklama buna değmedi.
- **Eğitilmiş model yok.** `ServiceInspector` hazır ve test edilmiş ama
  arkasında henüz bir servis yok; varsayılan hâlâ `SimulatedInspector`.
  Bağlanana kadar ekranda görülen kusur tespiti **simülasyondur**, model
  çıktısı değildir.
- **Kimlik doğrulama yok.** Sunucu localhost'a bağlanır, geliştirme aracıdır.
- **Marka adı seçildi: KOÇ OTOMOTİV.** Tek kaynağı `src/brand.ts`; ekran,
  PDF, Excel ve sekme başlığı oradan okur. Kullanıcı slogan istemedi, o
  yüzden `BRAND` içinde slogan alanı yok — ileride istenirse tek yerden
  eklenir.
- **Marka renkleri palete uymuyor.** Logonun mavi/moru, panonun lojistik ve
  "önü tıkalı" renkleriyle aynı ailede. Şimdilik marka üst barda durum
  şeridinden uzağa konularak çözüldü; ileride logonun koyu slate + yeşil
  varyantı üretilirse daha temiz olur.

---

## 7. Faz 6B — nerede kaldı

### Bu makinede doğrulananlar (tahmin değil, çalıştırıldı)

| Ne                           | Durum                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GPU                          | NVIDIA GeForce RTX 4060, 8188 MiB, sürücü 610.88                                                            |
| WSL2                         | Kurulu, sürüm 2                                                                                             |
| Docker                       | 29.7.2, Linux motoru çalışıyor                                                                              |
| **Konteynerden GPU erişimi** | **Çalışıyor** — `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` 4060'ı gösterdi |
| Disk                         | ~598 GB boş (TAO imajı 20 GB'ın üzerinde)                                                                   |

Konteynerden GPU erişimi, TAO kurulumlarında en sık tıkanan adımdır. Sizde
sorunsuz çalışıyor; bu adımı tekrar denemeye gerek yok.

### Yazılım tarafında biten iş

- `src/vision/service.ts` — `ServiceInspector`. Eğitilmiş model bir HTTP servisi
  arkasında yayınlandığında motora bağlanacağı nokta. Sözleşmesi `Inspector`
  arayüzü; motorun hiçbir kuralı değişmiyor, yalnızca tespitin **kaynağı**
  bu makineden çıkıyor. 14 testle korunuyor (`src/vision-service.test.ts`).
  Davranışı bilerek şöyle:
  - **Hattı bekletmez.** Çağrı fire-and-forget; bir tick ağ beklemez.
  - **Sessizliği geçiş saymaz.** Zaman aşımı, 500, bozuk gövde → _kaçırma_,
    sayılır ve görünür olur. Açık devre kalan görü sistemi, hiç olmamasından
    kötüdür: fabrika izlemeyi bırakır ama izlediğini sanır.
  - **Açıklayamadığı tespiti yutmaz** → yanlış red olarak kaydedilir.
  - **Bir cevabı bir kez kullanır.** Eski tespit sonraki araca uygulanmaz.
- `src/vision/export.ts` — **COCO** düzeni eklendi. `detection.yaml` içindeki
  RT-DETR COCO JSON istiyor; eski KITTI yalnızca eski detektörler için geçerli.
  Kategori id'leri 1'den başlar (0 arka plana ayrılmıştır).
- `tao/README.md` — runbook. Doğrulanmış olanlar ile kullanıcının yapması
  gerekenler ayrı ayrı yazılı; 8 GB VRAM ile hangi modelin eğitilip
  eğitilemeyeceği tabloda.
- `tao/classification.yaml`, `tao/detection.yaml` — eğitim spec'leri.

### Kalan iş — sıra

1. **NGC anahtarı + `docker login nvcr.io`** ← **sizde.** API anahtarı girmek
   benim yapmayacağım işlerden biri; bu adımı kendiniz yapmalısınız.
   Adımlar `tao/README.md` §2'de.
2. TAO imajını çek (~20 GB).
3. **Üç ayrı tohumla** üç veri seti üret (aynı tohumdan rastgele bölme sızıntı
   yaratır):
   ```bash
   npm run dataset -- --size=6000 --seed=42   --layout=classification --out=datasets/train
   npm run dataset -- --size=1200 --seed=907  --layout=classification --out=datasets/val
   npm run dataset -- --size=1200 --seed=5150 --layout=classification --out=datasets/test
   ```
4. Sınıflandırma eğit (`tao/classification.yaml`). Detektör değil: "bu panelde
   kusur var mı, hangi tip" sorusu hattın %80'ini çözer, kutu ancak operatöre
   _nerede_ olduğunu göstermek gerektiğinde gerekir.
5. ONNX'e aktar → TensorRT motoru üret.
6. Triton veya küçük bir FastAPI servisi arkasında yayınla. Sözleşme
   `tao/README.md` §6'da: `POST /v1/inspect`.
7. `ServiceInspector`'ı bağla. Eşiği **ayrı test setindeki PR eğrisinden** seç,
   tahminle koyma. Kaçan hata mı pahalı, yanlış red mi — bu bir mühendislik
   kararı, varsayılan bir sayı değil.
8. Aynı tohumla `SimulatedInspector` ve `ServiceInspector` koşularını
   karşılaştır. Fark, modelin simüle edilen kameraya göre nerede durduğudur.

> **Tekrar edilmesi gereken uyarı:** üretilen görüntüler çizimdir, fotoğraf
> değildir. Üzerinde ölçülen başarı, modelin **bu çizimleri** tanıdığını
> gösterir; kusurları tanıdığını değil. Hiçbir model bunun üzerinden "hatta
> hazır" diye raporlanamaz. Bu, her veri seti kartına da yazılıyor.

---

## 8. Faz 7 — planlama politikası, tek cümlede

Motor artık iş emri sırasını ve araç sevkini bir **politika**ya soruyor
(`src/optimizer.ts`). Varsayılan `slack-aware`: başladığın partiyi bitir, ancak
bir iş emri terminini kaçıracaksa o araya girer.

```bash
npm run optimize
```

Bu komut altı senaryoyu dört tohumda koşturup politikayı taban ile
karşılaştırır. Gönderilen politika `demand_surge` gecikmesini **649 dakika
(%41)** düşürüyor, diğer beş senaryoda **tek bir sayıyı değiştirmiyor**.

Denenip **reddedilen** iki politika var ve gerekçeleri
`docs/IMPLEMENTATION_PLAN.md` Faz 7'de yazılı. Reddedilen politika hâlâ
çalıştırılabilir:

```bash
npm run optimize -- --aday=nearest-vehicle
```

**Bu fabrikada AGV rotası optimize edilecek bir şey değil** — çağrı ile atama
arasında sıfır dakika var, filo hattı bekletmiyor. cuOpt adaptörü
(`src/optimizer-service.ts`) yazıldı ve test edildi ama bağlanmasının ölçülebilir
bir faydası yok; yerleşim büyüdüğünde bağlanacak yer hazır.

---

## 9. Faz 8 — sağlamlaştırma, tek cümlede

Dört arıza **üretilip** düzeltildi (ayrıntı: `docs/IMPLEMENTATION_PLAN.md` Faz 8):

1. **Kopan tek istemci sunucuyu öldürüyordu.** Yakalanmamış hata → süreç ölümü.
   Artık o abone düşürülüyor, diğerleri karesini alıyor.
2. **İlk kare bütün geçmişi taşıyordu** — 3000. dakikada 589 KB ve büyüyor.
   Artık sabit ~153 KB; tam geçmiş `GET /api/events` adresinde.
3. **Yeni istemci açılış olaylarını iki kez alıyordu.** Zaman çizelgesinde her
   malzeme girişi çiftleniyordu.
4. **Rapor üretimi fabrika saatini 1,5 sn donduruyordu.** Kuyruğa alındı;
   en kötü duraklama 335 ms.

Sağlamlığı bozacak bir değişiklik yaparsanız `npm test` içindeki
`src/hardening.test.ts` yakalar.

---

## 10. Sıradaki iş — 3D üretim detaylandırma

Şartname: **`docs/3D-DETAYLANDIRMA-PROMPT.md`** (kullanıcı 2026-08-29 akşamı
verdi, ertesi gün buradan devam edilecek). Kendi 10 fazı var: tır/mal kabul →
giriş kalite → depo → hat → istasyon operasyonları → robotlar ve operatörler →
final montaj → final kalite/tamir → sevkiyat → dashboard entegrasyonu.

### İşe başlamadan önce bilinmesi gerekenler

**İyi haber — Faz 1-3 çoğunlukla var olan durumu görselleştirmek.** Motor zaten
şunları modelliyor ve olay üretiyor: `RECEIVING-DOCK`, `QUARANTINE`,
`RAW-STOCK-A` konumları, `MATERIAL_RECEIVED` / `MATERIAL_ACCEPTED` /
`MATERIAL_QUARANTINED` olayları, partiye göre girdi kalite reddi
(`incomingRejectRate`). Yani tır/IQC/depo sahnesi **yeni motor mantığı
istemiyor**, var olan olayları 3D'de göstermek yeterli. Burası hızlı ilerler.

**Zor haber — istasyon sayısı.** Şartname ~21 operasyon istiyor (Body Shop,
Press, Robotic Welding, Painting, Battery Installation, Glass, Wheel, Seat…).
Motorun rotası şu an **5 istasyon**:

```ts
route: ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC"];
```

Bu bir 3D işi değil, **motor ana verisi işi**. Şartname de bunu kabul ediyor:
"Hepsini tek seferde yapmak zorunlu değil; mimari yeni istasyonların kolayca
eklenmesine uygun olmalı."

> **İlk yapılacak şey bu yüzden şu:** `src/factory.ts` rotasına 2-3 istasyon
> ekleyip `npm test` çalıştır. Testler geçiyorsa mimari gerçekten esnek demektir
> ve 21 istasyona kadar gidilebilir. Geçmiyorsa, ne kırıldığı 3D'ye tek satır
> yazmadan önce bilinmeli. Ölçmeden genişletmek, Faz 7'de öğrendiğimiz hatanın
> aynısı olur.

**Omniverse yok.** Bu makinede `ov` klasörü, USD python paketi, `kit`/`usdcat`
CLI — hiçbiri kurulu değil (2026-08-29 kontrol edildi). Omniverse Launcher da
NVIDIA tarafından emekliye ayrıldı; bugünkü yol `kit-app-template`.

Ayrıca **Three.js USD okumaz, glTF okur**. Omniverse yolu şudur:
Omniverse → USD → dönüştür → glTF → sahne. Bizim ihtiyacımız 5-6 makine varlığı
olduğu için Blender → glTF çok daha kısa. Omniverse'ün kazandırdığı şeyler
(PhysX, RTX render, SimReady materyal metadata'sı) bu kullanımda ekranda
görünmüyor. Kullanıcıya bu söylendi; kararı onun.

**Kurulum gerektirmeyen ve görünür farkı en büyük iş:** sahnedeki kutuları
prosedürel olarak detaylandırmak — pres gövdesi + koç kafası, kaynak robotu
kolu, boya kabini, araç gövdesi silueti. `web/src/components/factory-scene.tsx`
içinde `StationMesh` ve birim çizimi; yerleşim matematiği `scene-layout.ts`'de
ayrı durduğu için sadece çizilen mesh değişir, konumlar değişmez.

**Saha görünümü hazır:** `/saha` rotası (`web/src/components/shop-floor.tsx`)
3D'yi tam ekran veriyor, andon bandı orada da var. Yeni 3D detaylar hem komuta
merkezindeki panele hem bu sayfaya birlikte yansır.

---

## 11. 3D detaylandırma — Faz 1 bitti (mal kabul)

### Varlık hattı kuruldu

Modeller **Blender ile, betikten** üretiliyor. Kaynak
`tools/models/build_assets.py`: her ölçü kodda yazılı, `npm run models` her
seferinde aynı sonucu veriyor. Elle modellenmiş bir `.blend` ikili bir kutudur;
bu dosyanın diff'i okunur.

```bash
npm run models
```

`.glb` dosyaları **depoda duruyor**, yani projeyi çalıştırmak için Blender
gerekmiyor — yalnızca modeli değiştirecekseniz gerekiyor. Betik Blender'ı
`BLENDER` değişkeninde, `PATH`'te ve Windows'un kurulum klasörlerinde arıyor.

Şu an üç varlık var: `tir` (530 poligon), `rampa` (156), `palet` (36). Bütçe
bilerek düşük — ayrıntı silüetten gelmeli, yoğunluktan değil.

**Omniverse kullanılmadı.** Three.js USD okumuyor, glTF okuyor; Omniverse yolu
USD → dönüştür → glTF olurdu ve araya bir dönüştürme adımı koymak bu ölçekte
kazanç değil maliyet. Omniverse'ün asıl kazandırdıkları (PhysX, RTX render,
SimReady materyal verisi) bu ekranda görünmüyor. Fizik veya foto-gerçekçi
render gerektiğinde karar yeniden verilir.

### Tır süs değil, teslimatı getiren şeyin kendisi

Motorda `InboundTruck` var: `ARRIVING → DOCKED → UNLOADING → COMPLETED`.
**Boşaltma bitene kadar depoya stok düşmüyor**, çünkü gerçekte de düşmüyor.

Zamanlama şöyle kuruldu: tır teslimat saatinden **önce** yola çıkıyor ve
boşaltmayı tam teslimat saatinde bitiriyor. Sonuç: **tedarik programı birebir
korundu.** Sekiz tohum × altı senaryo karşılaştırıldı, üretim sayıları tır
öncesiyle **aynı** çıktı.

> Tek bilinçli fark: `material_shortage` senaryosunda kesinti bir teslimat geç
> ısırıyor. 30. dakikada inen yük 22. dakikada yüklendi ve yola çıkmış bir tır,
> tedarikçi fikrini değiştirdi diye paletlerini kaybetmez. Bu daha doğru olan
> davranış; `src/receiving.test.ts` içinde adıyla korunuyor.

### Ölçmeden genişletme yapılmadı

3D'ye tek satır yazmadan önce rota genişletilebilirliği ölçüldü: 8 istasyonlu
bir rota kuruldu, koşturuldu, **zaman defteri her makinede sağlam** çıktı,
izlenebilirlik doğru büyüdü. Mimari 21 operasyona kadar taşır.

### Bu tur bulunan iki eski kırılganlık

Tır eklemesi iki testi düşürdü ve ikisi de **zaten kırılgandı**:

1. `simulation.test.ts` — "duruş üretime mal olmalı" tek tohumda ölçülüyordu ve
   taahhüt edilmiş kodda bile 8 tohumun 2'sinde ihlal ediliyordu. Ortalamaya
   çevrildi.
2. `optimizer.test.ts` — reddedilen politika bulgusu 2 tohumda kontrol
   ediliyordu, oysa bulgu 4 tohumdan geliyordu. Tohum seti hizalandı ve artık
   reddin üç gerekçesini birden koruyor.

Aynı ders üçüncü kez: **tek tohum hiçbir şey kanıtlamaz.**

### Üretim sahası modellendi (Faz 4-6'nın görsel tarafı)

14 varlık var. Her iş merkezi kendi makinesini alıyor ve seçim **`workCenter`
alanına göre** yapılıyor, id'ye göre değil — rotaya yeni bir kaynak istasyonu
eklendiğinde tek satır kod yazmadan doğru modeli alır.

| İş merkezi   | Sahnede ne var                                             |
| ------------ | ---------------------------------------------------------- |
| Pres         | C gövdeli pres; koç kafası istasyon çalışırken iniyor      |
| Gövde        | Konveyör + karşılıklı iki kaynak robotu + operatör         |
| Boya         | Kesitli boya kabini (ön duvar alçak) + içeride boya robotu |
| Montaj       | Konveyör + üstten köprü + robot + iki operatör             |
| Kalite       | Kalite kapısı + tarayıcı kafaları + kontrolör              |
| Tamir        | Açık tezgâh alanı + iki tamirci                            |
| _tanınmayan_ | Konveyör — yeni istasyon boş kalmıyor                      |

Renkler dekor değil: pres mavi, boyahane yeşil, kalite kapısı mor. Hepsi düşük
doygunlukta seçildi ki **durum renkleriyle** (yeşil/sarı/turuncu/kırmızı)
çakışmasın — sahnede parlayan tek şey makinenin durumu olmalı.

Araç artık kutu değil: kaporta, geri çekilmiş kabin, camlar, farlar, stoplar,
jantlı tekerlekler. Durum rengi kaportadan alınıp **altındaki zemin pedine**
taşındı, çünkü kırmızıya dönen bir araç "sorunlu" değil "kırmızıya boyanmış"
diye okunuyor.

### Kör çalışmayı bitiren şey: `npm run preview`

```bash
npm run preview
```

Aynı `.glb` dosyalarını fabrika yerleşimine dizip `docs/onizleme.png` yazıyor.

Buna ihtiyaç vardı çünkü geliştirme ortamındaki tarayıcı paneli kare üretmiyor:
`requestAnimationFrame` tetiklenmiyor, sahne hiç render edilmiyor, dolayısıyla
modeller **görülmeden** gönderiliyordu. İlk turda ölçek tamamen yanlış çıktı ve
bu ancak render alınınca fark edildi — `ASSET_SCALE` 0.42 iken makineler
istasyon aralığının altıda biri kadardı. Şu an 1.05.

> Önizleme tarayıcıdaki sahnenin yerini tutmaz; ışıklandırma, gölge ve
> etkileşim orada. Cevapladığı soru şu: "pres presse benziyor mu, araba arabaya
> benziyor mu." Ölçek sabitleri (`KONUM_OLCEK`, `VARLIK_OLCEK`)
> `scene-layout.ts` ve `factory-models.tsx` ile birebir aynı olmalı; ayrı
> düşerlerse önizleme başka bir fabrikayı gösterir.

### Görsel efektler

- **Gölge açıldı.** Tek gölge veren ışık; glTF mesh'leri `castShadow` /
  `receiveShadow` ile işaretleniyor (varsayılan olarak gölge vermiyorlar, bunu
  unutmak nesneleri zeminin üstünde yüzüyormuş gibi bırakır).
- Hattın üstünde tavan spotu: gerçek bir fabrika işi aydınlatır, koridorları
  loş bırakır.
- Konveyör tek uzun kutu değil, **tekrarlanan bölümler** — raylı ve rulolu.
- Seçim, makinenin rengini değiştirmek yerine zemine halka çiziyor; renk
  değiştirmek durum rengiyle çakışırdı.

### Yerleşim düzeltildi: karantina kapıdan kalkıp kalitenin yanına gitti

Akış artık dışarıdan içeri **mal kabul → giriş kalite → depo → hat**:

| Konum           | Plan                       |
| --------------- | -------------------------- |
| Mal Kabul       | 0                          |
| Giriş Kalite    | 11                         |
| Karantina       | 11, hattan 20 birim uzakta |
| Hammadde Deposu | 22                         |

Karantina en dışarıdaydı ve bu, **henüz kontrol edilmemiş malın oraya
gittiğini** ima ediyordu — sahada kimsenin yapmayacağı bir şey. Karantina
akışın durağı değil, giriş kalitenin _sonucu_; o yüzden kontrolün yanında.

Mal kabul de yeniden modellendi: havada duran bir sundurmaydı, otopark
girişine benziyordu. Şimdi **bir bina cephesi**: iki kapı, sarı şerit, yükleme
platformları ve yanaşma tamponları. Arkasında duvar olmadan tırın neye
yanaştığı belli olmuyordu.

Depo rafı da ince çubuklardan yatmış bir çite benziyordu; şimdi kalın dikmeli,
çaprazlı ve **gözleri dolu** gerçek palet rafı.

### Sevkiyat: araçları oto taşıyıcılar götürüyor

Taşıyıcı sahneye konmuş bir nesne değil, **sevkiyatın kendisi**. Motorda
sevkiyat zaten tam bir durum makinesine sahipti (`READY → LOADING →
DISPATCHED → IN_TRANSIT → DELIVERED`), yani yeni motor mantığı gerekmedi.

- Üstündeki araç sayısı `productIds` uzunluğu — iki araç yüklendiyse
  taşıyıcıda iki araba var, dört değil.
- Yükleme bitmeden yola çıkmıyor; yola çıkınca çıkışa doğru ilerliyor.
- Teslim edilince sahneden çıkıyor, çünkü teslim edilmiş bir sevkiyat artık
  fabrikada değildir.
- Kapalı dorse değil **açık kafes**: bitmiş araba kapalı kasada gitmez ve
  fabrikadan çıkanın ne olduğu uzaktan görünmeli. Alt kat iki, üst kat iki.

Yedi yeni web testi bunu koruyor — özellikle "teslim edilmiş sevkiyat
çizilmez" ve "taşıyıcı tam da yüklenen aracı taşır".

### Yerleşim revizyonu — altı madde

Kullanıcının saha talimatı, altı somut madde. Hepsi uygulandı ve teste bağlandı.

| #   | Talep                                   | Ne yapıldı                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Mal kabul sola, bağımsız alan           | `-20` plan birimine alındı; giriş kaliteyle arasında 18 birim boşluk — tırın manevra sahası |
| 2   | Mal kabul tırı düz dursun               | Kapı rampanın **tam önüne** alındı; tır düz gelip düz yanaşıyor, açı sabit `0`              |
| 3   | Giriş kalitenin arkasında üretime geçiş | `PRODUCTION-GATE` konumu + sarı çerçeveli açıklık modeli                                    |
| 4   | Sevkiyata aynı mantık                   | Kendi binası, kendi kapıları; bitmiş ürün deposundan 32 birim ötede                         |
| 5   | Sevkiyat tırı yüzü sağa, düz            | Çıkış rampanın tam sağında; taşıyıcı açısı sabit `0`, yanal kayma yok                       |
| 6   | Doli arabaları + tanımlı güzergâh       | `doli` modeli + zemine çizili yol çizgileri: koridor + her hücreye sapma                    |

**Tırın çapraz durması neden yanlıştı:** dorse kapıya dik girer. Çapraz duran
bir tır rampaya yanaşamaz, sadece yanaşmış gibi görünür. Kapı hem yanda hem
geride olduğu için açı hesaplanıyordu; artık güzergâh tek eksende ve açı sabit.

**Doli güzergâhı zaten motorda tanımlıydı** — her taşıma işi
`hammadde deposu → ilgili hücrenin hat kenarı` yönünde ve başka yere gitmiyor
(`assignMoveTasks`). Eksik olan görünürlüktü. Zemine çizilen çizgiler bunu
planda da söylüyor; koridor **hattan ayrı**, çünkü aynı hizada olsaydı doli ile
araç aynı yerden geçerdi ve sahada ilk kaldırılacak şey odur.

**Mal kabul saçağı küçültüldü.** 4,6 m taşıyordu ve ekrandan bakıldığında
altındaki bütün işi gizleyen düz bir levha gibi duruyordu. Saçak, göstermesi
gereken şeyi gizliyorsa yanlış boyuttadır.

### Ara oturum — çalıştırıp bakma turu (düzeltmeler)

Kullanıcı "programı çalıştır da bakalım" dedi; sistem ayağa kaldırıldı ve
bakarken dört gerçek kusur çıktı. Hepsi düzeltildi ve teste bağlandı.

**1. Pano donuyordu — en ciddisi.** `use-factory.ts` çizimi yalnızca
`requestAnimationFrame` ile zamanlıyordu. Sekme kare üretmeyi bıraktığında rAF
hiç ateşlenmiyor, elde kalan dolu tutamak yüzünden sonraki _bütün_ çerçeveler
"zaten bir çizim bekliyor" diye sessizce atılıyordu. Soket açık, bağlantı
"CANLI", ekran donuk: pano kendinden emin biçimde 5 saat önceki fabrikayı
gösteriyordu. Komuta merkezi için en kötü arıza bu. Zamanlama
`lib/frame-scheduler.ts`'e çıkarıldı; artık rAF **ve** bir güvenlik
zamanlayıcısı birlikte kuruluyor, hangisi önce gelirse çizim onunla oluyor.
Sekmeye dönüldüğünde de bekleyen çerçeve hemen çiziliyor. 9 test; eski
davranış geri konduğunda 3'ü düşüyor (mutasyonla doğrulandı).

**2. "Genel" görünüm geneli göstermiyordu.** Kamera `[0, 26, 26]` diye elle
yazılmıştı ve yerleşim revizyonundan sonra geride kaldı: mal kabul solda,
sevkiyat sağda ekran dışındaydı. Artık `ZONES`'un gerçek sınırından
hesaplanıyor. "Sevkiyat" görünümü de eski koordinatta kalmıştı, sahayı değil
20 metre solundaki boşluğu gösteriyordu; adlandırılmış alanların kamerası artık
tesisin konum tablosundan okunuyor. **"Mal Kabul" görünümü eklendi.** Eski test
yalnızca "koordinat sonlu mu" diye baktığı için hatayı kaçırmıştı; yeni test
her bölgenin dört köşesini kameranın görüş piramidine geri yansıtıyor.

**3. Sevkiyat binası ters duruyordu.** Model mal kabulün aynadaki görüntüsü
olarak yapılmıştı, yani çalışma yüzü −X'e bakıyordu; bina sahanın −X tarafında
durduğu için kapılar sahaya değil boşluğa bakıyordu ve ekranda düz bir levha
gibi görünüyordu. π döndürüldü; kapılar, sarı şeritler ve yükleme platformu
göründü.

**4. Ekranda İngilizce kaçakları.** Doli durumu ham haliyle yazılıyordu
("idle", "to pickup"); stok listeleri malzeme _adı_ yerine kodunu gösteriyordu
("STEEL-COIL", oysa depocu "Sac rulo" der); muayene yöntemi "vision" diye
geçiyordu; panel kapatma düğmesi "Close" diyordu. `AGV_STATUS_TEXT` ve
`INSPECTION_METHOD_TEXT` sözlüğe eklendi. Kodlar ekrandan kalkmadı, ipucuna
taşındı — irsaliye ve etiket onunla eşleşiyor.

Ayrıca: bağlantı koptuğunda yeniden deneme gecikmesi sıfırlanmıyordu, sağlıklı
bir oturumda birkaç kesintiden sonra kalıcı olarak 8 saniyeye takılıyordu.

### Güvenlik kapısı ve tırın güzergâhı

Kullanıcı iki şey istedi: tır **normal araba sürüşü gibi** kendi gittiği yöne
baksın ve mal kabul hizasında **sağa dönsün**; ayrıca fabrikaya girmeden önce
bir **güvenlik kapısından** geçsin.

**Tır yan yan gidiyordu.** Güzergâh Z ekseninde, açı ise sabit `0` — yani model
+X'e bakarken −Z yönünde ilerliyordu. Sabit açı, bir önceki turda "çapraz
durmasın" diye konmuştu; çaprazlığı çözerken yönü de dondurmuş. Güzergâh artık
iki düz parça: **kapıdan köşeye** (−Z), **köşeden rampaya** (+X). Açı gidilen
yönden hesaplanıyor ve köşede yumuşak geçiyor — 17 birimlik bir araçta 90°'lik
ani atlama dönmek gibi değil, yerinde takla gibi görünüyordu.

**Güvenlik kapısı** yeni bir Blender varlığı (`guvenlik`): kapı direkleri, üst
kirişte sarı yükseklik şeridi, camlı kulübe ve kırmızı-beyaz bariyer kolu.
Tesisin sınırı artık sahnede var; önceden tır doğrudan mal kabulün önünde
beliriyordu. Tırın yolu da zemine çizildi (`TruckRoad`), doli koridorları gibi
ama daha geniş — genişlik hangi aracın geçtiğini söylüyor.

Bunları yaparken kamerada **beş** kusur daha çıktı, hepsi düzeltildi ve teste
bağlandı:

1. **Kamera ekran oranını bilmiyordu.** 16:9 varsayılıyordu; dikey bir pencerede
   tesis tamamen ekran dışında kalıyordu. Artık sahne kendi oranını veriyor.
2. **`maxDistance={70}`** genel görünümün gerektirdiği mesafeyi kırpıyordu —
   hesaplanan görünüm doğru olsa bile kamera sessizce yakına çekiliyordu. Sınır
   artık çerçevelemeden türüyor.
3. **Sis 55–140 birime sabitti.** Kamera geri çekilince tesisin tamamı sisin
   ötesinde kaldı ve ekran tek renk boşluğa döndü — hiçbir yerde hata mesajı
   olmayan türden. Sis ve görüş menzili sahnenin boyutundan hesaplanıyor.
4. **Açılışta kamera varsayılan görünüme gitmiyordu.** Efekt, `CameraControls`
   henüz bağlanmamışken çalışıp vazgeçiyordu (ref, state değil) ve sahne
   `Canvas` üzerindeki başlangıç kamerasında kalıyordu. Ayrıca ilk yerleştirme
   artık animasyonsuz — açılışta kameranın uçarak gelmesi için sebep yok.
5. **Varsayılan görünüm adı `"line"`** idi ve öyle bir görünüm yok; üst çubukta
   hiçbir düğme seçili görünmüyordu.

Ayrıca **"Mal Kabul" görünümü** artık girişin tamamını çerçeveliyor: güvenlik
kapısı → yol → dönüş → rampa. Yalnızca rampaya bakmak hikâyenin sonunu
göstermekti.

Doğrulandı (tarayıcıda, ekran görüntüsüyle): 00:17'de tır yolda, burnu gidiş
yönünde; 00:19'da sağa dönmüş, mal kabule yanaşıyor.

### Çıkış kapısı, bariyer animasyonu, doli koridoru

Kullanıcı üç şey istedi: aynı güvenlik kapısı **çıkışa** da; tırların geçiş
onayında **bariyer açılsın**; ve **iç lojistik hareketleri görünmüyor**.

**Bariyer ayrı bir varlığa çıkarıldı** (`bariyer`), menteşesi orijinde. Kapıda
yalnızca mil ve kaidesi kaldı. Sahne kolu menteşeden döndürüyor: `openness` 0
iken yatay (kapalı), 1 iken dik (açık). Bu değer uydurulmuyor — motorun
yayınladığı araç konumundan hesaplanıyor, yani kol gerçekten geçen bir araç
için kalkıyor. Ortada araç yokken kalkan bir bariyer, sahnedeki her nesnenin
bir karşılığı olması kuralını bozardı.

**Çıkış kapısı** girişle aynı varlık, çıkış yolunun üzerinde. Bir fabrikadan
araç kapıda durmadan çıkmaz; yalnızca girişte kapı olsaydı tesisin bir tarafı
çitsiz kalırdı. "Sevkiyat" görünümü de artık çıkışın tamamını çerçeveliyor.

**İç lojistik görünmüyordu, çünkü çizilen yol ile gidilen yol farklıydı.**
Koridor zemine plan y=18'e çiziliyordu; arabalar ise hücrenin 6 birim önünden,
iki durak arasında **düz çizgi** hâlinde gidiyordu. Yani işaretli koridor hep
boş, hareket ise makinelerin ve hattın üzerinden geçiyor, gözden kaçıyordu.
Artık koridorun yeri tek bir yerde tanımlı (`AISLE_PLAN_Y`) ve hem çizgi hem
arabalar onu kullanıyor; güzergâh üç parça: duraktan koridora, koridor boyunca,
hedefe.

Bunu yaparken **taşıyıcının çıkış hareketinde** bir hata daha çıktı: ilerleme,
toplam yol süresi yerine **kalan süreye** bölünüyordu (`1 − r/(r+1)`). 12
dakikalık yolun başında 0,08, sonunda 1 — taşıyıcı yolun neredeyse tamamında
yerinde duruyor, son dakikada fırlıyordu. Üstelik çıkış kapısının önünden
görülemeyecek kadar hızlı. Toplam süre artık sevkiyat planından okunuyor;
`FactoryDescriptor` tipinde `shipmentPlan` eksikti, sunucu baştan beri
gönderiyordu.

Doğrulandı (tarayıcıda): 00:16'da tır kapıda ve **bariyer kalkık**; 00:21'de tır
rampada ve **bariyer inmiş**.

### Tır sahada kalıyor, malı forklift indiriyor

Kullanıcı ekran görüntüsüyle gösterdi: tır mal kabul cephesinin **içine girmiş**
gibi duruyordu. Sahada da öyle olmaz — dorse sahada durur, malı içeri forklift
taşır.

**Tır artık köşede park ediyor** (`truckParkWorld`), binadan 11 birim uzakta.
Bunu yaparken kendi hatama düştüm: `truckRoute()` (zemine çizilen yol) düzeldi
ama tırın **konumunu** hesaplayan `truckOnRoute` hâlâ rampayı hedefliyordu ve
ilk yazdığım test yanlış şeyi kontrol ettiği için bunu yakalamadı. Test artık
`placeTrucks` çıktısını doğruluyor; eski davranış geri konduğunda düşüyor.

**Forklift** yeni bir Blender varlığı: direk, çatallar, koruma kafesi, karşı
ağırlık, tepe lambası. Kafes olmadan küçük bir traktöre benziyor; sahada ise
kafes zorunludur. Önceki sürümde palet dorsenin arkasından rampaya doğru kendi
kendine kayıyordu — kodun yorumu bunu "forklift modellenmiş değil, olmayan bir
şeyi ima etmemeli" diye açıkça kabul ediyordu.

Neyin motor gerçeği, neyin gösterim olduğu ayrıldı ve `placeForklifts`
yorumunda yazıyor: **forkliftin var olması, güzergâhı ve iş bitince ortadan
kalkması** motorun `UNLOADING` durumunun doğrudan karşılığı. **Kaç sefer
yaptığı** ise motorun modelinde yok (orada boşaltma tek bir süre), o yüzden
temposu sahnede üretiliyor. Denemesi yapıldı: sefer sayısını yayınlanan
ilerlemeye bağlamak, boşaltma üç dakika sürdüğü için forklifti her karede tam
sefer başında yakalıyor ve araç yerinde donuyordu.

Bir düzeltme daha: forklift şeridi başta tırın kendi ekseni üzerindeydi, yani
araç yükü aldığı an dorsenin içinde kalıyor ve tırın gövdesinden geçip
çıkıyordu. Şerit tırın yanına alındı (`FORKLIFT_LANE_Z`) ve teste bağlandı.

Doğrulandı (tarayıcıda): tır köşede park hâlinde "Boşaltılıyor"; forklift bir
karede paletiyle mal kabulde, sonrakinde dönüş yolunda.

### Üç üretim hattı

Kullanıcı "hattan iki tane daha, her birinde farklı model, aynı mantık
tamamen" dedi. Motorun tek hat varsayımı `config.route` /
`config.reworkStationId` / `config.wipCap` üzerinden yirmi küsur yere
işlemişti; hepsi `LineConfig`'e taşındı. İş emri bir hatta ait, ürün hattını
iş emrinden alıyor, rota ve tamir hücresi ürünün kendi hattından okunuyor.

**Hat 1'in istasyon kimlikleri korundu** (`PRESS-01`, `WELD-04`, …): bunlar
kayıtlı veri kümelerinde, senaryolarda ve testlerde geçiyor ve yeniden
numaralandırmak, işe yaramayan bir değişiklik için doksan küsur yeri elden
geçirmek olurdu.

**Ölçülen ve düzeltilen şey:** üretimi üçe katlayıp beslemeyi olduğu yerde
bırakmak, iki hat değil iki _aç_ hat eklemek olurdu. İlk koşuda hatlar
20/41/17 araç açabildi — hepsi kendi tavanında sıkışmış. Malzeme tedariği hat
sayısıyla ölçeklendi; sonrasında üç tohumun üçünde de üç hat 60'ar araç
bitiriyor.

**Denenip reddedilen:** doli sayısını 9'dan 18'e çıkarmak hat kenarı
beklemesini hiç değiştirmedi (199'da sabit), çünkü arabalar zaten %28
meşguliyetle boştaydı. Kısıt taşıma kapasitesi değil, kanban sipariş
noktasıydı: 2'den 3'e çıkarınca bekleme 199'dan 45'e indi. Sipariş
_miktarını_ büyütmek işi kötüleştiriyor (3/8 → 90 bekleme), çünkü büyük parti
depoyu tek seferde boşaltıyor.

**Bir kayıt eskidi ve bunu test yakaladı.** `optimizer.test.ts` içindeki
"en yakın araç kuralı reddedildi" koruması, tam olarak bu iş için vardı: üç
hatlı tesiste kural artık **yolu azaltıyor** (−1159 dk yol, −835 dk boş yol).
Ret duruyor, çünkü gecikme 1640 dk ve en kötü iş emri 526 dk artıyor — ama
gerekçe artık üç maddeli değil **iki maddeli**. Hem test hem
`IMPLEMENTATION_PLAN.md` buna göre güncellendi; test her iki yönü de tutuyor.

Ayrıca üç test, tesis genelinde doğru ama hat başına yanlış olduğu için
düzeltildi: WIP tavanı (hat başına sayılmalı), son kalite kapısı (aracın kendi
hattının son istasyonu) ve andon (senaryonun durdurduğu istasyona bakmalı —
18 makineyle 40. dakikadan önce rastgele bir arıza olağan).

`analytics.ts` içinde sessiz bir tuzak vardı: yukarı/aşağı akış
`route.indexOf` ile bulunuyordu ve başka hattın makinesi için −1 döner, yani
**hepsi "yukarıda" sayılırdı**. Karşılaştırma kısıtın kendi hattıyla
sınırlandı.

### İç içe geçen nesneler — kısmen

Konveyör **her istasyonun gövdesinin içinden** geçiyordu; presin ortasından
bant görünüyordu. Bant artık istasyonların arasında akıyor, içinden değil:
prese giriyor, presten çıkıyor.

**Açık kalan:** kalite kapısı hâlâ bandın üstüne basıyor, operatörler
makinelere fazla yakın duruyor ve büyük binalar kenarlardan taşıyor. Bunların
ortak sebebi bölüm 6'daki **ölçek uyuşmazlığı**: modeller konumlara göre üç
kat büyük çiziliyor, o yüzden 7 birimlik istasyon aralığına 4,2 birimlik
makine sığmıyor. Tek tek model kaydırmak semptomu örter; asıl karar hâlâ
verilmedi.

### Ölçek uyuşmazlığı çözüldü

İki turdur açık duran madde kapandı. Doğrusu tekti: **plan birimleri metre,
modeller de metre, o hâlde ölçek de aynı olmalı.** `ASSET_SCALE` artık `SCALE`
(0,35). Modeller küçük kaldıkları için değil, **öyle modellendikleri** için
küçüktü: pres 2,6 m, boyahane 4,4 m — bunlar tezgâh ölçüsü. Gerçek bir
otomotiv hattında pres 6 metreyi, boya kabini 9 metreyi aşar.

Çözüm çarpan değil doğru boyut: `disa_aktar` artık varlık başına bir ölçek
alıyor ve makineler gerçek ölçülerinde üretiliyor (pres ×2,4, boyahane ×2,0,
montaj ×1,5, kalite ×1,3, tamir ×2,0, konveyör ×1,25, tır ×1,45). Zaten gerçek
boyutta olanlar (bina, araç, operatör, robot, forklift, bariyer) 1,0.

Bunu yaparken **kendi açtığım bir hataya düştüm**: ilk denemede
`nesne.scale = olcek` yazdım. Oysa `kutu()` parçanın boyutunu nesne ölçeğinde
tutuyor ve `birlestir()` bunu birleşik nesneye taşıyor — yani atama, her
parçanın kendi boyutunu sildi ve bütün modeller küpe döndü. Sahnede fabrikayı
boydan boya kesen bir dikme çıktı. Doğrusu çarpmak; konum da aynı çarpanla
açılmalı, yoksa montaj dağılır.

Ölçek dürüstleşince modellere göre ayarlanmış mesafeler 3 kat cömert kaldı ve
metre cinsinden yeniden yazıldı: `GATE_WINDOW`, `FORKLIFT_LANE_Z`, forklift
alış noktası. Konveyör ve pres için sahnedeki sabit ofsetler (bant yüksekliği,
koç stroku) modelin kendi çarpanını taşıyor.

Ayrıca konveyör her istasyonun gövdesinin içinden geçiyordu; artık istasyonların
arasında akıyor, prese girip presten çıkıyor.

### Sevkiyat üç hatta yayıldı, çıkış tek kapıdan

- **Sevkiyat hat başına.** `Shipment.lineId` eklendi; bir oto taşıyıcı tek
  hattın araçlarını topluyor ve **kendi şeridinde** yükleniyor. Şerit hattın
  kendi hizasında: hangi taşıyıcının hangi hattı yüklediği bakınca görünüyor.
- **Çıkış yolu paylaşılan bir kaynak.** Üç hattın taşıyıcısı aynı takta
  dolduğu için yüklemeleri aynı dakikaya denk geliyordu. Çıkış yolunda aynı
  anda tek taşıyıcı olabiliyor; bekleyen rampada kalıyor. Ölçüldü: 480
  dakikada 45 çıkışın **hiçbiri** 3 dakika içinde çakışmıyor. Kuyruk uydurma
  değil, tek kapılı bir tesisin gerçeği.
- **Tek çıkış kapısı.** Üç şerit ortak yolda birleşiyor, kapı o yolun ucunda.
  Üç şeride üç kapı koymak, tesisi üç ayrı çıkışı olan bir yer yapardı.
- **Tırlar iç içe geçmiyor.** Kuyruk şerit başına sayılıyor (tek sayaçla
  ikinci hattın taşıyıcısı birincinin arkasına diziliyordu) ve bekleyenler bir
  taşıyıcı boyundan uzak. Teste bağlandı.
- **Doli güzergâhı.** Depo ortak, hatlar alt alta; arabaların depodan kendi
  koridorlarına çıktığı bağlantı yolu çizilmemişti, ikinci ve üçüncü hattın
  arabaları boşlukta beliriyor gibi görünüyordu.

**Yol boyunca bulunan bir hata:** `alongPath` açıyı `atan2(dx, dz)` ile
hesaplıyordu; bu **+Z'ye bakan** bir model için doğru. Oysa tır, oto taşıyıcı,
doli ve forkliftin hepsi +X'e bakıyor. Yani doli arabaları baştan beri
gittikleri yöne dik duruyordu — tırda düzeltilen hatanın fark edilmemiş hâli.

### Bitmiş ürün hat başına; zemindeki bantlanma

**Her hattın kendi bitmiş ürün alanı var.** Tek bir mamul depo vardı ve o da
birinci hattın hizasındaydı: ikinci ve üçüncü hattın araçları kalite kapısından
çıkar çıkmaz tesisin öbür ucuna ışınlanıyordu. Alanlar sevkiyat şeritleriyle
aynı mantıkta — hattın kendi hizasında, çünkü araç oradan doğruca kendi
şeridine geçiyor. Park sayacı da hat başına: tek sayaçla ikinci hattın araçları
birincinin arkasına diziliyor, kendi alanları boş kalıyordu.

**Zemindeki "çizgili çizgili" görüntü kare hızı değildi.** Bölgeler, tır
yolları, doli koridorları ve forklift şeridi — hepsi zemine yapışık saydam
düzlemler ve köşelerde birbirinin üstünden geçiyorlar. Aynı yükseklikteki iki
düzlem derinlik tamponunda yarışınca ekranda düzenli koyu-açık bantlar çıkıyor;
desen her karede aynı yerde durduğu için kare hızıyla ilgisi yok.

Üç şey birden yapıldı:

1. Bütün zemin kaplamaları ortak bir malzemeden geçiyor: `depthWrite` kapalı,
   sıralama `polygonOffset` ile. Derinliğe yazmayan bir kaplama kendisiyle
   yarışmaz.
2. Kameranın yakın düzlemi 0,1'den 0,5'e çıktı. Kamera zaten 3 birimden yakına
   gelemiyor; 0,1 ile uzak düzlem arasındaki oran derinlik hassasiyetini boşa
   harcıyordu.
3. Izgara aralığı tesisin boyuna göre seyreltildi (5 m → 20 m hücre). 5
   metrelik hücreler kısa bir tesiste okunaklıydı; 300 metrelik sahada kamera
   geriye çekilince çizgiler ekranda birkaç piksele düşüp moiré üretiyordu.

### İstasyon adı ile kimliği artık uyuşuyor

Çalıştırıp bakarken çıktı: panoda "Gövde Kaynak 01" görünüyor, kimliği ise
`WELD-04` idi. Üç hattı şablondan üretirken addaki numarayı **hat** numarasından
yazmışım; oysa kaynak hücreleri tesis genelinde numaralı (04/05/06), presler hat
bazında (01/02/03). Aynı istasyonu iki farklı numarayla anan bir pano, sahada
telsizle konuşan iki kişiyi karşı karşıya getirir.

Ad artık **kimliğin** numarasını taşıyor. Kimliğinde numara olmayan istasyon
(`FINAL-QC`) adında da numarasız; diğer hatlarınki `FINAL-QC-02` olduğu için
karışma yok. İki test bunu koruyor (ad/kimlik uyuşması ve adların benzersizliği);
eski davranış geri konduğunda birincisi düşüyor.

### Yayın: motor tarayıcıda, site statik

Kullanıcı "lokal değil, bir yerde süresiz çalışsın" dedi. Ölçtüm: motor
çekirdeği (`engine`, `state`, `metrics`, `analytics`, `copilot`, `runtime`)
**hiçbir Node modülüne dokunmuyor**; tek bağımlılık `setInterval`, o da
tarayıcıda var. Yani simülasyon tarayıcıda koşabilir ve site tamamen statik
olabilir — ayakta tutulacak sunucu, uyuyan süreç, aylık ücret yok.

- `src/descriptor.ts` paylaşılan: sunucu ve tarayıcı aynı tanımı okuyor.
- `web/src/lib/local-engine.ts` sunucunun uçlarını **taklit etmiyor**, aynı
  kaynağı çağırıyor (`runAllAnalyses`, `ask`, `SimulationRuntime`). Kopya mantık
  yazmak iki fabrikanın sessizce ayrışması demekti.
- `api.ts` ve `use-factory.ts` moda göre yönleniyor; çerçeve birleştirme, olay
  tamponu ve çizim zamanlaması iki modda da aynı yoldan geçiyor.
- `.github/workflows/pages.yml`: push → kalite kapıları → statik derleme →
  Pages. **Bir kereye mahsus ayar kullanıcıda:** Settings → Pages → Source:
  GitHub Actions.

**Paylaşılan tip bir hatayı ortaya çıkardı.** Arayüzün elle yazdığı
`FactoryDescriptor`, `workOrders` alanını çalışma-zamanı `WorkOrder` diye
tanımlıyordu; oysa `/api/config` yalnızca statik `WorkOrderConfig` gönderiyor.
Kimse o alanları okumadığı için yıllarca görünmedi. Elle yazılan tip silindi,
motorunki paylaşılıyor.

**basePath tuzağı:** `useGLTF` ham `fetch` yapıyor ve `<Image>` de statik
dışa aktarımda logoyu ön eksiz istedi — ikisi de yayında 404 verdi.
`web/src/lib/base-path.ts` ön eki açıkça koyuyor.

**Yayın sürümünde rapor yok.** Excel ve PDF gömülü yazı tiplerini ve logoyu
diskten okuyor; tarayıcıda dosya sistemi yok. Çalışmayacak bir düğme göstermek
yerine rapor alanı "motor sunucusuyla" diyor.

Yerelde doğrulandı: statik çıktı `/AutomativeSimulation/` altında servis edildi,
motor tarayıcıda kuruldu, saat ilerledi, andon çalıştı, 3D sahne yüklendi ve
**hiçbir istek başarısız olmadı**.

### Sırada ne var

Şartnamenin Faz 2'si: giriş kalite kontrol + insan silüetleri. Motor tarafı
zaten hazır (`MATERIAL_ACCEPTED` / `MATERIAL_QUARANTINED` olayları var), iş
çoğunlukla görselleştirme. Sonra Faz 3 (depo), Faz 4-5 (istasyon operasyonları
— burada rota genişletmesi devreye girer).
