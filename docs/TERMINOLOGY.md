# Terminoloji — Saha Dili Sözlüğü

Bu dosya, motorun İngilizce alan modeli ile ekranda görünen Türkçe saha dili
arasındaki tek eşlemedir.

**Kural:** kod, tip adları, event adları ve durum enum'ları İngilizce kalır —
bunlar veri, çeviri konusu değil. Operatörün gördüğü her şey Türkçedir.
Fabrikada zaten Türkçeleşmiş yabancı terimler (OEE, takt, kanban, AGV, FIFO,
FEFO, WIP) olduğu gibi bırakılır; çevirmek anlaşılırlığı azaltırdı.

## Makine durumları

| Enum          | Ekranda     | Ne demek                                                |
| ------------- | ----------- | ------------------------------------------------------- |
| `RUNNING`     | Çalışıyor   | Üzerinde araç var, işlem sürüyor.                       |
| `IDLE`        | Boşta       | Hatta iş yok; istasyon beklemiyor, işi bitmiş.          |
| `STARVED`     | Besleme Yok | Parça ya da hat kenarı malzeme bekliyor.                |
| `BLOCKED`     | Önü Tıkalı  | Aracı bitirdi ama bir sonraki tampon dolu, bırakamıyor. |
| `DOWN`        | Arızalı     | Plansız duruş, onarım sürüyor.                          |
| `MAINTENANCE` | Bakımda     | Planlı bakım sürüyor.                                   |

`Besleme Yok` ile `Önü Tıkalı` ayrımı kritik: ilkinde sorun **yukarıda**,
ikincisinde **aşağıdadır**. Ekranda ikisi farklı renkte gösterilir.

## Araç durumları

| Enum                   | Ekranda          |
| ---------------------- | ---------------- |
| `WAITING_FOR_MATERIAL` | Malzeme Bekliyor |
| `QUEUED`               | Sırada           |
| `IN_PRODUCTION`        | İşlemde          |
| `IN_REWORK`            | Tamirde          |
| `READY_TO_SHIP`        | Sevke Hazır      |
| `LOADING`              | Yükleniyor       |
| `DISPATCHED`           | Sevk Edildi      |
| `IN_TRANSIT`           | Yolda            |
| `DELIVERED`            | Teslim Edildi    |
| `SCRAPPED`             | Hurdaya Ayrıldı  |

## Sevkiyat durumları

`PLANNED` Planlandı · `READY` Hazır · `LOADING` Yükleniyor ·
`DISPATCHED` Sevk Edildi · `IN_TRANSIT` Yolda · `DELIVERED` Teslim Edildi

## Alarm kodları

| Kod                 | Ekranda        |
| ------------------- | -------------- |
| `MACHINE_FAILURE`   | Makine Arızası |
| `BOTTLENECK`        | Hattı Tutuyor  |
| `QUALITY_FAILURE`   | Kalite Red     |
| `MATERIAL_SHORTAGE` | Malzeme Eksiği |
| `SCRAP`             | Hurda          |
| `SCHEDULE_RISK`     | Termin Riski   |

## Göstergeler

| İngilizce          | Ekranda              | Not                                    |
| ------------------ | -------------------- | -------------------------------------- |
| OEE                | OEE                  | Sahada zaten OEE denir, çevrilmez.     |
| Availability       | Kullanılabilirlik    | Duruşsuz geçen sürenin oranı.          |
| Performance        | Performans           | Açık kalan sürede beklenen hıza uyum.  |
| Quality            | Kalite               | Hurdasız çıkan araç oranı.             |
| Production output  | Üretim               |                                        |
| Planned production | Plan                 |                                        |
| Schedule adherence | Plana Uyum           |                                        |
| First pass yield   | İlk Seferde Doğru    | Kısaltma FPY parantez içinde verilir.  |
| Rework rate        | Tamir Oranı          |                                        |
| Scrap rate         | Hurda Oranı          |                                        |
| Cycle time         | Çevrim Süresi        | İki araç arasındaki ortalama süre.     |
| Takt time          | Takt Süresi          | Sahada "takt" denir.                   |
| Throughput         | Çıktı Hızı           | Araç/saat.                             |
| WIP                | Hattaki Araç         | Kısaltma WIP parantez içinde verilir.  |
| Downtime           | Duruş                |                                        |
| MTBF               | Arızalar Arası Süre  | Kısaltma parantez içinde.              |
| MTTR               | Onarım Süresi        | Kısaltma parantez içinde.              |
| Energy             | Enerji               |                                        |
| Inventory on hand  | Eldeki Stok          |                                        |
| Bottleneck         | Hattı Tutan          | "Darboğaz" sahada kullanılmaz.         |
| Constraint         | Hattı Tutan İstasyon | Hattın hızını belirleyen istasyon.     |
| Buffer             | Tampon               |                                        |
| Line-side stock    | Hat Kenarı Stok      |                                        |
| Work order         | İş Emri              |                                        |
| Due date           | Termin               |                                        |
| Lead time          | Akış Süresi          | Hatta giriş ile çıkış arası.           |
| Traceability       | İzlenebilirlik       |                                        |
| Lot / batch        | Parti                |                                        |
| Quarantine         | Karantina            |                                        |
| Incoming QC        | Girdi Kalite         |                                        |
| Final QC           | Son Kalite           |                                        |
| Escaped defect     | Kaçan Hata           | Son kapıyı geçip müşteriye giden hata. |
| Recall (muayene)   | Yakalama Oranı       | Kameranın gördüğü hataların payı.      |
| False positive     | Yanlış Red           | Sağlam aracı hatalı sayma.             |

## Kusur tipleri

`SCRATCH` Çizik · `DENT` Ezik · `WELD_DEFECT` Kaynak Hatası ·
`PAINT_DEFECT` Boya Kusuru · `MISSING_PART` Eksik Parça ·
`WRONG_PART` Yanlış Parça · `SURFACE_DEFORMATION` Yüzey Deformasyonu ·
`MISALIGNMENT` Hizalama Hatası · `DIMENSIONAL` Ölçü Sapması

## Zaman birimi

Bir tick = bir dakika fabrika zamanı. Ekranda saat olarak gösterilir
(`03:44` = üretime başlanalı 3 saat 44 dakika). Vardiya 480 tick = 8 saat.

## Kullanılmayan ve neden kullanılmadığı

Bunlar literatürde geçer ama sahada konuşulmaz. Ekranda, raporda ve asistan
cevabında **çıkmaz**:

| Kullanılmayan           | Yerine                                           | Gerekçe                                      |
| ----------------------- | ------------------------------------------------ | -------------------------------------------- |
| Darboğaz                | Hattı tutan istasyon                             | Sahada kimse "darboğaz" demiyor.             |
| Kısıt                   | Hattı tutan istasyon                             | Kısıtlar teorisi terimi; vardiya dili değil. |
| Örneklem                | "Aynı hat tekrar çalıştırılırsa sayılar değişir" | İstatistik dili.                             |
| Süreç yeterliliği kaybı | Kalite bozulması                                 | Cp/Cpk jargonu; senaryo adında gereksiz.     |
| Tedarik daralması       | Malzeme gelmiyor                                 | Sahada böyle söylenir.                       |
| Dönemsel doluluk        | Son dönem doluluk                                | Daha düz.                                    |

**Girdi tarafında hâlâ anlaşılıyorlar.** Asistan "darboğaz" yazan birini
anlamaya devam eder; sadece cevabında o kelimeyi kullanmaz. Kimsenin alışkanlığı
yüzünden cevapsız kalmaması için.

## Andon — Dur, Haber Ver, Bekle

Bir istasyon plansız durduğunda ekran bunu bir alarm satırı olarak değil,
sayfanın en üstünü kaplayan bir uyarı olarak gösterir ve kuralı uygulanma
sırasıyla yazar:

1. **DUR** — Hattı çalıştırma
2. **HABER VER** — Amirine bildir
3. **BEKLE** — Onay gelmeden başlama

Uyarının kapatma düğmesi **yoktur**. İstasyon tekrar çalışınca kendiliğinden
kapanır. Bir duruşu onaylamak sahada yapılan bir iştir; bir panonun kimse adına
kaydedebileceği bir şey değildir.

Planlı bakım andon değildir. İkisini aynı göstermek, operatöre asıl önemli olan
sinyali görmezden gelmeyi öğretir.
