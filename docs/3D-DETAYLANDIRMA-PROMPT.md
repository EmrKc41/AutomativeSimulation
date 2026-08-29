# Automotive Smart Factory Digital Twin — 3D Üretim Detaylandırma Promptu

## Geliştirme Amacı

Mevcut **AI-Powered Automotive Smart Factory Digital Twin** projesinin görsel ve operasyonel detay seviyesini önemli ölçüde artır.

Amaç yalnızca fabrikayı 3D olarak göstermek değil; **hammadde kabulünden başlayarak kalite kontrol, üretim, montaj ve sevkiyata kadar otomobilin fabrikadaki gerçek üretim yolculuğunu 3D animasyonlarla adım adım görünür hâle getirmek**.

Mevcut simülasyon mimarisini bozmadan yeni detayları sisteme entegre et.

## 1. Mal Kabul ve Fabrikaya Giriş

Fabrika girişindeki mal kabul sürecini görsel olarak detaylandır.

- Gerçekçi bir **3D tır modeli** fabrikaya gelmeli.
- Tır fabrika giriş kapısından içeri girmeli ve mal kabul alanına yönelmeli.
- Tır uygun noktaya yanaşmalı.
- Malzemelerin tırdan indirilmesi mümkün olduğunca 3D animasyonlarla gösterilmeli.
- Tırın durumu `ARRIVING → DOCKED → UNLOADING → COMPLETED` şeklinde simüle edilebilmeli.
- Mal kabul süreci gerçek `material receiving` state'i ile bağlantılı olmalı.

Temel akış:

`Truck Arrival → Dock Assignment → Unloading → Material Inspection → Accepted/Rejected → Warehouse`

## 2. Giriş Kalite Kontrol Bölümü

Mal kabulden sonra malzeme doğrudan üretime gitmemeli. Öncelikle **Incoming Quality Control (IQC)** bölümüne yönlendirilmeli.

Bu bölümde:

- 3D insan karakterleri veya insan silüetleri kullanılmalı.
- Kalite kontrol personeli malzemeyi incelemeli.
- Malzeme üzerinde inspection animasyonları gösterilmeli.
- Kontrol sonunda `PASS` veya `FAIL` sonucu üretilmeli.

`PASS`:

`Quality Approved → Warehouse → Production`

`FAIL`:

`Quality Failed → Quarantine Area / Rework / Return`

Bu karar hem 3D sahnede hem dashboard üzerinde görünür olmalı.

## 3. Üretim Alanının 3D Detaylandırılması

Mal kabul ve giriş kalite kontrolünden sonraki 3D detayların ağırlık merkezi **üretim operasyonları** olmalı.

Üretim alanını gerçek bir otomotiv üretim tesisi mantığıyla mümkün olduğunca detaylandır. Üretim hattı yalnızca bir konveyörden oluşmamalı; farklı operasyon ve istasyonlardan oluşan gerçekçi bir akış oluşturulmalı.

## 4. 3D Otomobilin Üretim Hattındaki Yolculuğu

Projenin temel görsel unsurlarından biri **3D otomobilin üretim hattındaki yolculuğu** olmalı.

Araç her istasyona sırayla uğramalı:

`Station 01 → Station 02 → Station 03 → Station 04 → Station 05 → ... → Final Quality → Finished Vehicle → Shipment`

Araç her istasyonda durmalı ve ilgili operasyon mümkün olduğunca detaylı şekilde animasyonla gösterilmeli.

## 5. Üretim İstasyonlarının Detaylandırılması

Her istasyon şu bilgileri desteklemeli:

- Station ID
- Station Name
- Operation
- Cycle Time
- Machine
- Operator
- Quality Gate
- Status
- Current Product
- Production Count
- Defect Count

Araç istasyona geldiğinde:

1. Konveyör aracı istasyona taşır.
2. Araç istasyonda durur.
3. Makine veya robot aktif olur.
4. Operasyon animasyonu başlar.
5. İşlem tamamlanır.
6. Gerekliyse kalite kontrol yapılır.
7. Ürün bir sonraki istasyona gönderilir.

Bu akış simulation state ile senkron çalışmalı.

## 6. Otomotiv Üretim Operasyonlarını Detaylandır

Model ve teknik imkanlar elverdiği ölçüde şu operasyonları görselleştir:

- Body Shop
- Press / Forming
- Robotic Welding
- Manual Welding
- Body Assembly
- Surface Inspection
- Painting
- Paint Inspection
- Drying / Curing
- Powertrain Installation
- Battery Installation
- Interior Assembly
- Dashboard Installation
- Glass Installation
- Wheel Installation
- Seat Installation
- Door Assembly
- Lighting Assembly
- Final Assembly
- Software / Diagnostic Check
- Final Quality Control

Hepsini tek seferde yapmak zorunlu değil; mimari yeni istasyonların kolayca eklenmesine uygun olmalı.

## 7. Robotik Operasyonlar

Uygun istasyonlarda 3D robot kolları kullanılmalı:

- Kaynak robotları
- Montaj robotları
- Boya robotları
- Parça taşıma robotları

Robot state'leri:

`IDLE → MOVING → PROCESSING → COMPLETED → IDLE`

Robotun operasyonu araç üzerindeki ilgili bölgeyle görsel olarak ilişkilendirilmeli.

## 8. İnsan Operatörler

Gerekli istasyonlarda 3D insan karakterleri veya silüetleri kullanılmalı. Operatörlerin araç kontrolü, parça montajı, kalite kontrolü, manuel işlem, malzeme taşıma ve final inspection gibi görevleri görsel olarak ifade edilmeli.

## 9. Kalite Kontrol Kapıları

Üretim hattı boyunca gerekli noktalarda `Quality Gate` oluştur:

`Incoming Quality → Body Quality → Paint Quality → Assembly Quality → Final Quality`

Her Quality Gate `PASS`, `FAIL` ve `WARNING` durumlarını desteklemeli.

FAIL durumunda araç normal akıştan ayrılarak `REWORK` veya `QUARANTINE` alanına yönlendirilebilmeli. Bu durum 3D sahnede açıkça görülmeli.

## 10. Araç Üzerindeki İşlemlerin Görselleştirilmesi

Mümkün olduğunca gerçek operasyonu araç üzerinde göster:

- Kaynak noktalarının görünmesi ve robot kolunun ilgili noktaya hareket etmesi
- Boya robotlarının araç çevresinde hareket etmesi
- Cam montajı
- Tekerlek montajı
- Koltuk montajı
- Motor veya güç aktarma sisteminin yerleştirilmesi
- Batarya montajı
- Kapı montajı
- Final inspection taraması

Amaç sinematik video değil; **üretim operasyonunu anlaşılır ve teknik olarak anlamlı bir 3D simülasyon hâline getirmek**.

## 11. Üretim Akışının Görsel Takibi

Kullanıcı aracın nerede olduğunu her an anlayabilmeli.

3D sahnede aktif istasyon, tamamlanan istasyonlar, bekleyen istasyonlar, hatalı istasyonlar, kalite kontrol noktaları ve aracın mevcut konumu ayırt edilebilmeli.

Örnek:

`CAR-000184`
`Current Station: PAINT-07`
`Status: PROCESSING`
`Progress: 68%`

## 12. Simülasyon ve Dashboard Senkronizasyonu

3D animasyon ve dashboard birbirinden bağımsız çalışmamalı. Tek bir simulation state kullanılmalı.

Örneğin `machine.status = RUNNING` ise 3D makine çalışmalı, ilgili animasyon başlamalı, dashboard makineyi RUNNING göstermeli ve KPI hesaplaması etkilenmeli.

`quality.result = FAIL` olduğunda araç 3D olarak rework alanına yönelmeli, dashboard'da kalite alarmı oluşmalı, defect kaydı oluşturulmalı ve KPI'lar güncellenmeli.

## 13. Performans

3D detayları artırırken gerçek zamanlı performansı koru. Gerektiğinde:

- LOD
- Instancing
- Asset reuse
- Efficient animation
- Occlusion / visibility optimization
- Texture optimization
- USD optimization

kullan.

Hedef: **Daha fazla detay + gerçek zamanlı performans** dengesini korumak.

## 14. Aşamalı Geliştirme

### Faz 1

3D tır + fabrika girişi + mal kabul.

### Faz 2

3D insan silüetleri + giriş kalite kontrol.

### Faz 3

Depo + üretime malzeme aktarımı.

### Faz 4

Üretim hattı + konveyör + ilk araç.

### Faz 5

Araç için istasyon bazlı operasyonlar.

### Faz 6

Robotlar + insan operatörler + kalite kapıları.

### Faz 7

Detaylı final assembly.

### Faz 8

Final quality + rework.

### Faz 9

Finished vehicle + shipment.

### Faz 10

Tüm sürecin gerçek zamanlı dashboard ve AI Factory Copilot ile entegrasyonu.

Her fazın sonunda çalışan bir sistem bırak.

## 15. Tasarım Hedefi

Ortaya çıkan deneyim şu hissi vermeli:

> “Bu bir fabrika resmi değil; çalışan bir otomotiv fabrikasının dijital ikizi.”

Kullanıcı yalnızca fabrikanın 3D modelini görmemeli; **üretimin gerçekleştiğini görmeli.**

Tırın geldiğini, malzemenin kontrol edildiğini, onaylandığını, depolandığını, üretime gönderildiğini, aracın hatta ilerlediğini, robotların çalıştığını, operatörlerin işlem yaptığını, kalite kontrollerinin gerçekleştiğini, hatalı ürünlerin ayrıldığını, aracın tamamlandığını ve sonunda sevkiyata gönderildiğini adım adım izleyebilmeli.

## 16. NVIDIA Skills Entegrasyonu

Daha önce belirlenen NVIDIA skill mimarisini koru. Uygun olduğu yerlerde özellikle:

- NVIDIA Omniverse
- NVIDIA TAO
- NVIDIA DeepStream
- NVIDIA VSS
- NVIDIA cuOpt
- Data Designer
- Physical AI

skill'lerini değerlendir.

Yeni bir skill kullanmadan önce projeye gerçekten katkı sağlayıp sağlamadığını değerlendir. Her yeni skill için `SKILL_USAGE_MATRIX.md` dosyasını güncelle.

## 17. En Önemli Kural

Geliştirme önceliği:

**Gerçekçilik → Operasyonel doğruluk → Görsel anlaşılabilirlik → Etkileşim → Performans**

Sadece görsel olarak etkileyici bir sahne oluşturma. Her 3D nesnenin ve animasyonun mümkün olduğunca gerçek bir üretim operasyonunda karşılığı olsun.

Sonuçta hedefimiz:

**3D Animated Automotive Manufacturing Process + Real-Time Simulation + AI + Computer Vision + Digital Twin**

bileşenlerini tek bir profesyonel platformda birleştirmektir.
