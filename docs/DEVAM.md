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

Beklenen: motorda **162 test**, web tarafında **18 test**, hepsi geçer.

---

## 2. Nerede ne var

| Yol                           | Ne                                                                   |
| ----------------------------- | -------------------------------------------------------------------- |
| `src/domain.ts`               | Tip sözleşmeleri, durum makineleri, olay sözlüğü                     |
| `src/labels.ts`               | **Türkçe saha sözlüğü — tek kaynak.** Motor ve arayüz ortak kullanır |
| `src/language.test.ts`        | Dil muhafızı: motoru koşturup her alarm metnini Türkçe diye doğrular |
| `src/factory.ts`              | Ana veri: istasyonlar, malzemeler, iş emirleri, yerleşim             |
| `src/rng.ts`                  | Tohumlu rastgelelik (mulberry32)                                     |
| `src/state.ts`                | Çalışma zamanı durumu, olay/alarm üretimi, parti muhasebesi          |
| `src/engine.ts`               | Tick — 9 fazlı sabit sıra                                            |
| `src/metrics.ts`              | KPI projeksiyonu ve kısıt tespiti                                    |
| `src/analytics.ts`            | Kanıtlı deterministik analizler (8 adet)                             |
| `src/optimizer.ts`            | **Planlama ayrımı** — iş emri sırası ve araç sevki                   |
| `src/optimizer-compare.ts`    | Politika karşılaştırma koşumu (aynı tohum, tek fark politika)        |
| `src/optimizer-service.ts`    | cuOpt/çözücü adaptörü — bağlanacağı yer                              |
| `src/optimizer-cli.ts`        | `npm run optimize` — karşılaştırmayı yazdırır, "hayır" da der        |
| `src/hardening.test.ts`       | Faz 8 arızalarının nöbetçisi — çökme, sınırsız büyüme, çiftleme      |
| `src/copilot.ts`              | Soru → niyet → analiz yönlendirmesi (TR + EN)                        |
| `src/runtime.ts`              | Canlı host: play/pause/hız/adım/sıfırla                              |
| `src/server.ts`               | REST + WebSocket                                                     |
| `src/report/`                 | Excel çalışma kitabı + PDF vardiya raporu (ortak model)              |
| `src/cli.ts`                  | Terminal denetleyici (`npm run scenario`)                            |
| `src/report-cli.ts`           | Rapor üretici (`npm run report`)                                     |
| `src/vision/`                 | Muayene adaptörü, sentetik veri seti, KITTI/COCO/sınıf dışa aktarım  |
| `src/vision/service.ts`       | **Çıkarım servisi adaptörü** — eğitilmiş modelin bağlanacağı yer     |
| `tao/`                        | TAO runbook'u + eğitim spec dosyaları (`README.md` önce okunmalı)    |
| `web/`                        | Next.js komuta merkezi + 3D sahne                                    |
| `assets/brand/`               | Marka görselleri (kaynak)                                            |
| `scripts/prepare-brand.mjs`   | Marka görsellerini boyutlandırır (`npm run brand`)                   |
| `assets/fonts/`               | Fira Sans TTF (PDF için, SIL OFL)                                    |
| `docs/TERMINOLOGY.md`         | Enum ↔ Türkçe saha terimi eşlemesi ve gerekçeleri                    |
| `docs/IMPLEMENTATION_PLAN.md` | Faz faz ne yapıldı, hangi karar niye verildi                         |
| `SKILL_USAGE_MATRIX.md`       | Hangi NVIDIA skill'i neden kullanıldı/kullanılmadı                   |

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
- **3D sahne görsel olarak doğrulanmadı.** Geliştirme ortamında tarayıcı paneli
  kare üretmiyordu; WebGL bağlamı açılıyor, hata yok, yerleştirme matematiği
  18 testle korunuyor — ama nasıl göründüğüne insan bakmalı.
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
