# -*- coding: utf-8 -*-
"""
Fabrika varlıklarını Blender ile üret, glTF olarak dışa aktar.

Neden betik, neden elle modelleme değil
---------------------------------------
Elle modellenmiş bir `.blend` dosyası ikili bir kutudur: diff'i okunmaz, gözden
geçirilemez, bir ölçü değiştiğinde kimse nereye dokunulduğunu göremez. Bu
dosya ise **kaynak**: her ölçü burada yazılı ve `npm run models` her seferinde
aynı sonucu üretir. `.glb` dosyaları derleme çıktısıdır.

Neden Blender, neden Omniverse değil
------------------------------------
Three.js USD okumaz, glTF okur. Omniverse yolu USD → dönüştür → glTF olurdu;
bizim ihtiyacımız birkaç makine gövdesi olduğu için araya bir dönüştürme adımı
koymak kazanç değil maliyet. Omniverse'ün asıl kazandırdıkları (PhysX, RTX
render, SimReady materyal verisi) bu ekranda görünmüyor. Fizik veya
foto-gerçekçi render gerektiğinde o karar yeniden verilir.

Poligon bütçesi
---------------
Sahne gerçek zamanlı ve varlıklar örneklenerek (instancing) çoğaltılıyor.
Hedef varlık başına birkaç bin üçgen; ayrıntı silüetten gelmeli, yoğunluktan
değil. Uzaktan bakan bir operatör pres ile kaynak robotunu birbirinden
ayırabilmeli — cıvatayı görmesi gerekmiyor.

Çalıştırma:
    npm run models
"""

import math
import os
import sys

import bpy

# ---------------------------------------------------------------------------
# Ortak yardımcılar
# ---------------------------------------------------------------------------


def temizle():
    """Boş bir sahneyle başla. Blender'ın varsayılan küpü ve ışığı istenmiyor."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def kutu(ad, boyut, konum=(0, 0, 0), donme=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=konum, rotation=donme)
    nesne = bpy.context.active_object
    nesne.name = ad
    nesne.scale = (boyut[0] / 2, boyut[1] / 2, boyut[2] / 2)
    return nesne


def silindir(ad, yaricap, derinlik, konum=(0, 0, 0), donme=(0, 0, 0), kenar=16):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=yaricap, depth=derinlik, location=konum, rotation=donme, vertices=kenar
    )
    nesne = bpy.context.active_object
    nesne.name = ad
    return nesne


def pah(nesne, genislik=0.02, bolum=1):
    """
    Keskin kenarları kır.

    Tek başına en çok fark yaratan şey bu: pahlı bir kenar ışığı yakalar ve
    nesne kutu olmaktan çıkıp imal edilmiş bir parçaya benzer. Maliyeti birkaç
    yüz üçgen.
    """
    mod = nesne.modifiers.new(name="Pah", type="BEVEL")
    mod.width = genislik
    mod.segments = bolum
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(40)
    return nesne


def malzeme(nesne, ad, renk, metal=0.0, puruz=0.6):
    mat = bpy.data.materials.get(ad)
    if mat is None:
        mat = bpy.data.materials.new(ad)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*renk, 1.0)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = puruz
    nesne.data.materials.clear()
    nesne.data.materials.append(mat)
    return nesne


def birlestir(parcalar, ad):
    """Tek bir mesh'e indir: sahnede tek çizim çağrısı, tek örnek."""
    for nesne in bpy.data.objects:
        nesne.select_set(False)
    for parca in parcalar:
        parca.select_set(True)
    bpy.context.view_layer.objects.active = parcalar[0]
    bpy.ops.object.join()
    birlesik = bpy.context.active_object
    birlesik.name = ad
    return birlesik


def disa_aktar(ad, klasor):
    """Modifier'ları uygula ve GLB yaz."""
    bpy.ops.object.select_all(action="SELECT")
    for nesne in bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = nesne
        for mod in list(nesne.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)

    yol = os.path.join(klasor, ad + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=yol,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        # Sahnede kendi ışığımız ve kameramız var; varlık yalnızca geometri
        # ve malzeme taşımalı.
        export_cameras=False,
        export_lights=False,
    )
    ucgen = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"VARLIK {ad} {os.path.getsize(yol)} {ucgen}")


# ---------------------------------------------------------------------------
# Renkler — sahnenin paletiyle aynı aile
# ---------------------------------------------------------------------------

GOVDE = (0.16, 0.18, 0.24)
CELIK = (0.42, 0.45, 0.52)
KOYU = (0.09, 0.10, 0.14)
LASTIK = (0.05, 0.05, 0.06)
SARI = (0.78, 0.62, 0.16)
AHSAP = (0.42, 0.31, 0.18)
CAM = (0.22, 0.34, 0.50)

# İş merkezi renkleri.
#
# Hepsi aynı gri olduğunda hat tek bir uzun nesne gibi okunuyordu. Bu renkler
# dekor değil: birinin etiket okumadan boyahaneyi bulmasını sağlayan şey.
# Durum renkleriyle (yeşil/sarı/turuncu/kırmızı) çakışmasınlar diye hepsi
# düşük doygunlukta seçildi — sahnede parlayan tek şey makinenin durumu olmalı.
PRES_MAVI = (0.20, 0.26, 0.38)
BOYA_YESIL = (0.22, 0.32, 0.30)
KALITE_MOR = (0.28, 0.26, 0.40)
KAPORTA = (0.55, 0.58, 0.64)


# ---------------------------------------------------------------------------
# Faz 1 — mal kabul
# ---------------------------------------------------------------------------


def tir(klasor):
    """
    Çekici + dorse.

    Uzunluk ekseni +X. Sahne aracı yerleşim yönüne göre döndürür, bu yüzden
    varlık orijinde ve tek yönde durur; konum bilgisi burada değil,
    `scene-layout.ts` içinde.
    """
    temizle()
    parcalar = []

    # Dorse gövdesi
    dorse = kutu("dorse", (7.6, 2.5, 2.6), konum=(-2.2, 0, 2.0))
    malzeme(pah(dorse, 0.04), "tir-dorse", GOVDE, metal=0.1, puruz=0.5)
    parcalar.append(dorse)

    # Dorsenin alt şasesi — gövdeyi havaya kaldıran şey, silueti belirliyor
    sase = kutu("sase", (7.4, 2.1, 0.22), konum=(-2.2, 0, 0.66))
    malzeme(pah(sase, 0.02), "tir-sase", KOYU, metal=0.4, puruz=0.5)
    parcalar.append(sase)

    # Çekici kabini
    kabin = kutu("kabin", (2.3, 2.4, 2.3), konum=(2.6, 0, 1.85))
    malzeme(pah(kabin, 0.06), "tir-kabin", SARI, metal=0.2, puruz=0.4)
    parcalar.append(kabin)

    # Ön cam — düz bir yüzeyde tek koyu dikdörtgen, kabini "ön" yapan detay
    cam = kutu("cam", (0.08, 2.0, 0.9), konum=(3.72, 0, 2.35))
    malzeme(cam, "tir-cam", CAM, metal=0.1, puruz=0.15)
    parcalar.append(cam)

    # Motor kaputu
    kaput = kutu("kaput", (1.0, 2.2, 0.9), konum=(4.2, 0, 1.1))
    malzeme(pah(kaput, 0.04), "tir-kaput", SARI, metal=0.2, puruz=0.4)
    parcalar.append(kaput)

    # Tekerlekler: çekicide iki aks, dorsede iki aks
    for x in (3.9, 2.0, -3.6, -4.7):
        for y in (-1.15, 1.15):
            tekerlek = silindir(
                "tekerlek", 0.55, 0.34, konum=(x, y, 0.55), donme=(math.pi / 2, 0, 0), kenar=14
            )
            malzeme(tekerlek, "tir-lastik", LASTIK, metal=0.0, puruz=0.9)
            parcalar.append(tekerlek)

    birlestir(parcalar, "Tir")
    disa_aktar("tir", klasor)


def palet(klasor):
    """Üzerinde malzeme olan bir palet. Tırdan inen ve depoya giden birim."""
    temizle()
    parcalar = []

    for x in (-0.45, 0, 0.45):
        kalas = kutu("kalas", (0.16, 1.2, 0.1), konum=(x, 0, 0.05))
        malzeme(kalas, "palet-ahsap", AHSAP, puruz=0.9)
        parcalar.append(kalas)
    tabla = kutu("tabla", (1.2, 1.2, 0.06), konum=(0, 0, 0.13))
    malzeme(tabla, "palet-ahsap", AHSAP, puruz=0.9)
    parcalar.append(tabla)

    # Yük: iki kademe, üstteki biraz küçük — yığın olduğu anlaşılsın
    alt = kutu("yuk-alt", (1.05, 1.05, 0.55), konum=(0, 0, 0.44))
    malzeme(pah(alt, 0.02), "palet-yuk", CELIK, metal=0.6, puruz=0.4)
    parcalar.append(alt)
    ust = kutu("yuk-ust", (0.85, 0.85, 0.35), konum=(0, 0, 0.89))
    malzeme(pah(ust, 0.02), "palet-yuk", CELIK, metal=0.6, puruz=0.4)
    parcalar.append(ust)

    birlestir(parcalar, "Palet")
    disa_aktar("palet", klasor)


def rampa(klasor):
    """
    Mal kabul rampası: platform, üstünde saçak, iki yanında direk.

    Tırın nereye yanaşacağını belirleyen şey bu; sahnede tırın hedefi bu
    varlığın önü oluyor.
    """
    temizle()
    parcalar = []

    platform = kutu("platform", (6.0, 4.0, 1.1), konum=(0, 0, 0.55))
    malzeme(pah(platform, 0.04), "rampa-beton", (0.24, 0.25, 0.30), puruz=0.95)
    parcalar.append(platform)

    # Yanaşma tamponu — tırın değdiği yer
    for y in (-1.2, 1.2):
        tampon = kutu("tampon", (0.2, 0.5, 0.3), konum=(3.0, y, 1.0))
        malzeme(tampon, "rampa-tampon", (0.5, 0.15, 0.12), puruz=0.85)
        parcalar.append(tampon)

    for y in (-1.8, 1.8):
        direk = kutu("direk", (0.24, 0.24, 3.4), konum=(2.6, y, 2.8))
        malzeme(pah(direk, 0.02), "rampa-celik", CELIK, metal=0.7, puruz=0.4)
        parcalar.append(direk)

    sacak = kutu("sacak", (6.4, 4.4, 0.2), konum=(0.2, 0, 4.6))
    malzeme(pah(sacak, 0.03), "rampa-celik", CELIK, metal=0.7, puruz=0.45)
    parcalar.append(sacak)

    birlestir(parcalar, "Rampa")
    disa_aktar("rampa", klasor)


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Faz 4-6 — üretim sahası
# ---------------------------------------------------------------------------


def arac(klasor):
    """
    Araç gövdesi.

    Bir kutu değil, araba. Silueti belirleyen üç şey var ve üçü de burada:
    kaportanın alçak-uzun gövdesi, üstündeki daha dar ve geri çekilmiş kabin
    (greenhouse), ve tekerleklerin gövdeyi yerden kaldırması. Bunlar olmadan
    hangi açıdan bakılırsa bakılsın kutu görünür.

    Uzunluk ekseni +X, hattın akış yönü. Sahne aracı yalnızca konumlandırıyor.
    """
    temizle()
    parcalar = []

    # Alt gövde — kaporta. Hafif pahlı, çünkü keskin kenar sac paneli gibi
    # durmuyor.
    alt = kutu("alt-govde", (4.3, 1.9, 0.84), konum=(0, 0, 0.78))
    malzeme(pah(alt, 0.09, 2), "arac-kaporta", KAPORTA, metal=0.6, puruz=0.3)
    parcalar.append(alt)

    # Marşpiyel — gövdenin altındaki ince şerit; araca "oturmuş" görüntü verir.
    esik = kutu("esik", (3.6, 2.0, 0.16), konum=(0, 0, 0.46))
    malzeme(esik, "arac-koyu", KOYU, metal=0.3, puruz=0.6)
    parcalar.append(esik)

    # Kabin — daha dar, daha kısa ve geri çekilmiş. Sedan silueti buradan.
    kabin = kutu("kabin", (2.3, 1.66, 0.82), konum=(-0.3, 0, 1.6))
    malzeme(pah(kabin, 0.1, 2), "arac-kaporta", KAPORTA, metal=0.6, puruz=0.3)
    parcalar.append(kabin)

    # Camlar: ön, arka ve iki yan. Koyu yüzeyler kabini boşluk gibi gösteriyor.
    on_cam = kutu("on-cam", (0.1, 1.5, 0.62), konum=(0.86, 0, 1.62), donme=(0, -0.42, 0))
    malzeme(on_cam, "arac-cam", CAM, metal=0.2, puruz=0.1)
    parcalar.append(on_cam)
    arka_cam = kutu("arka-cam", (0.1, 1.5, 0.58), konum=(-1.44, 0, 1.62), donme=(0, 0.5, 0))
    malzeme(arka_cam, "arac-cam", CAM, metal=0.2, puruz=0.1)
    parcalar.append(arka_cam)
    for y in (-0.85, 0.85):
        yan = kutu("yan-cam", (1.95, 0.06, 0.52), konum=(-0.3, y, 1.62))
        malzeme(yan, "arac-cam", CAM, metal=0.2, puruz=0.1)
        parcalar.append(yan)

    # Farlar ve stoplar — küçük ama aracın önünü arkasından ayıran şey.
    for y in (-0.62, 0.62):
        far = kutu("far", (0.12, 0.44, 0.2), konum=(2.13, y, 0.96))
        malzeme(far, "arac-far", (0.90, 0.88, 0.72), metal=0.1, puruz=0.2)
        parcalar.append(far)
        stop = kutu("stop", (0.12, 0.42, 0.18), konum=(-2.13, y, 1.0))
        malzeme(stop, "arac-stop", (0.62, 0.14, 0.12), metal=0.1, puruz=0.3)
        parcalar.append(stop)

    # Tekerlekler — davlumbazın içine gömülü değil, gövdenin altında görünür.
    for x in (1.35, -1.3):
        for y in (-0.94, 0.94):
            teker = silindir(
                "teker", 0.36, 0.22, konum=(x, y, 0.36), donme=(math.pi / 2, 0, 0), kenar=14
            )
            malzeme(teker, "arac-lastik", LASTIK, puruz=0.9)
            parcalar.append(teker)
            jant = silindir(
                "jant", 0.19, 0.24, konum=(x, y, 0.36), donme=(math.pi / 2, 0, 0), kenar=12
            )
            malzeme(jant, "arac-jant", (0.68, 0.70, 0.74), metal=0.85, puruz=0.25)
            parcalar.append(jant)

    birlestir(parcalar, "Arac")
    disa_aktar("arac", klasor)


def robot(klasor):
    """
    Altı eksenli robot kolu.

    Kaynak, montaj ve boya istasyonlarında kullanılıyor. Poz bilerek nötr
    değil: kol hafifçe öne ve aşağı eğik, yani duran bir robot bile "bir şeye
    uzanıyor" gibi duruyor. Dümdüz yukarı bakan bir kol direk gibi görünür.

    Taban orijinde, +Z yukarı. Sahne yalnızca yerleştiriyor ve döndürüyor.
    """
    temizle()
    parcalar = []

    kaide = silindir("kaide", 0.42, 0.18, konum=(0, 0, 0.09), kenar=16)
    malzeme(pah(kaide, 0.02), "robot-kaide", KOYU, metal=0.5, puruz=0.5)
    parcalar.append(kaide)

    govde = silindir("govde", 0.3, 0.5, konum=(0, 0, 0.42), kenar=16)
    malzeme(pah(govde, 0.02), "robot-govde", SARI, metal=0.3, puruz=0.4)
    parcalar.append(govde)

    # Omuz eklemi
    omuz = silindir(
        "omuz", 0.2, 0.44, konum=(0, 0, 0.72), donme=(math.pi / 2, 0, 0), kenar=14
    )
    malzeme(omuz, "robot-eklem", CELIK, metal=0.8, puruz=0.3)
    parcalar.append(omuz)

    # Üst kol — geriye ve yukarı
    ust_kol = kutu("ust-kol", (0.26, 0.3, 1.0), konum=(-0.16, 0, 1.16), donme=(0, 0.32, 0))
    malzeme(pah(ust_kol, 0.03), "robot-govde", SARI, metal=0.3, puruz=0.4)
    parcalar.append(ust_kol)

    dirsek = silindir(
        "dirsek", 0.17, 0.36, konum=(-0.46, 0, 1.62), donme=(math.pi / 2, 0, 0), kenar=14
    )
    malzeme(dirsek, "robot-eklem", CELIK, metal=0.8, puruz=0.3)
    parcalar.append(dirsek)

    # Ön kol — öne ve aşağı uzanıyor
    on_kol = kutu("on-kol", (0.2, 0.24, 1.15), konum=(0.05, 0, 1.5), donme=(0, 1.15, 0))
    malzeme(pah(on_kol, 0.025), "robot-govde", SARI, metal=0.3, puruz=0.4)
    parcalar.append(on_kol)

    bilek = silindir(
        "bilek", 0.12, 0.24, konum=(0.55, 0, 1.28), donme=(math.pi / 2, 0, 0), kenar=12
    )
    malzeme(bilek, "robot-eklem", CELIK, metal=0.8, puruz=0.3)
    parcalar.append(bilek)

    # Uç işlevsel eleman — kaynak torcu. Sivri uç, robotun "işi" burada.
    torc = silindir("torc", 0.07, 0.34, konum=(0.72, 0, 1.14), donme=(0, 0.9, 0), kenar=10)
    malzeme(torc, "robot-torc", KOYU, metal=0.6, puruz=0.35)
    parcalar.append(torc)

    birlestir(parcalar, "Robot")
    disa_aktar("robot", klasor)


def operator(klasor):
    """
    İnsan silüeti.

    Yüz yok, kol detayı yok — bu ölçekte görünmez ve poligon yer. Gereken tek
    şey "burada bir insan çalışıyor" bilgisi: baş, gövde, bacaklar ve baret.
    Baret rengi ayrı, çünkü sahada insanı uzaktan ayıran şey odur.
    """
    temizle()
    parcalar = []

    for y in (-0.11, 0.11):
        bacak = kutu("bacak", (0.17, 0.17, 0.82), konum=(0, y, 0.41))
        malzeme(bacak, "operator-pantolon", (0.16, 0.20, 0.30), puruz=0.85)
        parcalar.append(bacak)

    govde = kutu("govde", (0.3, 0.44, 0.6), konum=(0, 0, 1.1))
    malzeme(pah(govde, 0.05, 2), "operator-yelek", (0.72, 0.55, 0.14), puruz=0.75)
    parcalar.append(govde)

    for y in (-0.28, 0.28):
        kol = kutu("kol", (0.14, 0.14, 0.5), konum=(0, y, 1.12))
        malzeme(kol, "operator-yelek", (0.72, 0.55, 0.14), puruz=0.75)
        parcalar.append(kol)

    bas = silindir("bas", 0.12, 0.24, konum=(0, 0, 1.52), kenar=12)
    malzeme(bas, "operator-ten", (0.55, 0.42, 0.34), puruz=0.8)
    parcalar.append(bas)

    baret = silindir("baret", 0.15, 0.12, konum=(0, 0, 1.68), kenar=12)
    malzeme(pah(baret, 0.03, 2), "operator-baret", (0.85, 0.72, 0.18), puruz=0.4)
    parcalar.append(baret)

    birlestir(parcalar, "Operator")
    disa_aktar("operator", klasor)


def pres(klasor):
    """
    Pres — C gövdeli, üstünde koç kafası.

    Presi presten yapan şey ağırlığı: kalın kolonlar, üstte taç, altta tabla ve
    aralarında inip kalkan koç. Sahne koçu istasyon çalışırken aşağı indiriyor.
    Koç ayrı bir varlık değil; burada üst konumda modellendi ve sahne onu
    hareket ettirmek yerine bütün gövdeyi statik gösteriyor — hareketli parça
    `pres-koc` olarak ayrıca dışa aktarılıyor.
    """
    temizle()
    parcalar = []

    tabla = kutu("tabla", (2.6, 2.2, 0.4), konum=(0, 0, 0.2))
    malzeme(pah(tabla, 0.04), "pres-govde", PRES_MAVI, metal=0.55, puruz=0.45)
    parcalar.append(tabla)

    for y in (-0.9, 0.9):
        kolon = kutu("kolon", (0.42, 0.36, 2.7), konum=(-0.85, y, 1.75))
        malzeme(pah(kolon, 0.03), "pres-govde", PRES_MAVI, metal=0.55, puruz=0.45)
        parcalar.append(kolon)

    tac = kutu("tac", (2.4, 2.2, 0.55), konum=(0, 0, 3.35))
    malzeme(pah(tac, 0.05), "pres-govde", PRES_MAVI, metal=0.55, puruz=0.45)
    parcalar.append(tac)

    # Kılavuz sütunlar — koçun üzerinde indiği raylar
    for y in (-0.7, 0.7):
        ray = silindir("ray", 0.08, 2.5, konum=(0.55, y, 1.9), kenar=10)
        malzeme(ray, "pres-ray", CELIK, metal=0.85, puruz=0.2)
        parcalar.append(ray)

    birlestir(parcalar, "Pres")
    disa_aktar("pres", klasor)


def pres_koc(klasor):
    """Presin inip kalkan koç kafası. Sahne bunu Z ekseninde hareket ettirir."""
    temizle()
    koc = kutu("koc", (2.0, 1.9, 0.5), konum=(0, 0, 0))
    malzeme(pah(koc, 0.05), "pres-koc", (0.34, 0.37, 0.44), metal=0.7, puruz=0.3)
    disa_aktar("pres-koc", klasor)


def boyahane(klasor):
    """
    Boya kabini.

    Kapalı bir hacim: araç içine giriyor, dışarıdan görünmüyor. Kabini kabin
    yapan şey üstündeki havalandırma bacası ve iki yanındaki filtre duvarı.
    Ön yüz açık bırakıldı ki içeri bakılabilsin.
    """
    temizle()
    parcalar = []

    # Arka duvar tam yükseklik, ön duvar yarım.
    #
    # Gerçek bir boya kabini kapalıdır ve dışarıdan bakıldığında düz bir kutu
    # görünür — doğru ama işe yaramaz. Fabrika görselleştirmesinin standart
    # çözümü kesit: bakan tarafın duvarı alçaltılıyor ki içerideki robot ve
    # araç görünsün. Kabinin kapalı olduğu bilgisi tavan ve bacadan zaten
    # okunuyor.
    arka_duvar = kutu("arka-duvar", (4.4, 0.18, 2.8), konum=(0, 1.5, 1.4))
    malzeme(pah(arka_duvar, 0.03), "boya-duvar", BOYA_YESIL, metal=0.2, puruz=0.65)
    parcalar.append(arka_duvar)

    on_duvar = kutu("on-duvar", (4.4, 0.18, 0.85), konum=(0, -1.5, 0.42))
    malzeme(pah(on_duvar, 0.03), "boya-duvar", BOYA_YESIL, metal=0.2, puruz=0.65)
    parcalar.append(on_duvar)

    # Kesit kenarını belirginleştiren üst kirişi: duvarın kesildiği yer keskin
    # bir çizgi olsun, kırık bir duvar gibi durmasın.
    kesit = kutu("kesit-kiris", (4.4, 0.26, 0.14), konum=(0, -1.5, 0.92))
    malzeme(pah(kesit, 0.02), "boya-kesit", SARI, metal=0.3, puruz=0.5)
    parcalar.append(kesit)

    tavan = kutu("tavan", (4.4, 3.0, 0.18), konum=(0, 0.1, 2.9))
    malzeme(pah(tavan, 0.03), "boya-duvar", BOYA_YESIL, metal=0.2, puruz=0.65)
    parcalar.append(tavan)

    arka = kutu("arka", (0.18, 3.2, 2.8), konum=(-2.2, 0, 1.4))
    malzeme(pah(arka, 0.03), "boya-duvar", BOYA_YESIL, metal=0.2, puruz=0.65)
    parcalar.append(arka)

    # Havalandırma bacası — kabini boyahane yapan silüet
    baca = kutu("baca", (1.2, 1.2, 1.1), konum=(0.4, 0, 3.5))
    malzeme(pah(baca, 0.04), "boya-baca", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(baca)
    boru = silindir("boru", 0.28, 1.4, konum=(0.4, 0, 4.7), kenar=14)
    malzeme(boru, "boya-baca", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(boru)

    birlestir(parcalar, "Boyahane")
    disa_aktar("boyahane", klasor)


def montaj_koprusu(klasor):
    """
    Montaj hattı üstü köprü.

    Üstten geçen bir kiriş ve ondan sarkan kaldırma düzeni. Montajı montaj
    yapan şey aracın üstünde bir şeyin asılı durması: motor, kapı, koltuk.
    """
    temizle()
    parcalar = []

    for y in (-1.8, 1.8):
        ayak = kutu("ayak", (0.3, 0.3, 3.4), konum=(0, y, 1.7))
        malzeme(pah(ayak, 0.03), "montaj-celik", CELIK, metal=0.7, puruz=0.4)
        parcalar.append(ayak)

    kiris = kutu("kiris", (0.45, 4.2, 0.4), konum=(0, 0, 3.6))
    malzeme(pah(kiris, 0.04), "montaj-celik", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(kiris)

    # Sarkan kaldırma düzeni
    halat = silindir("halat", 0.05, 1.1, konum=(0, 0, 2.9), kenar=8)
    malzeme(halat, "montaj-halat", KOYU, metal=0.4, puruz=0.6)
    parcalar.append(halat)
    kanca = kutu("kanca", (0.5, 0.5, 0.32), konum=(0, 0, 2.2))
    malzeme(pah(kanca, 0.03), "montaj-kanca", SARI, metal=0.4, puruz=0.4)
    parcalar.append(kanca)

    birlestir(parcalar, "MontajKoprusu")
    disa_aktar("montaj", klasor)


def kalite_kapisi(klasor):
    """
    Kalite kontrol kapısı.

    Araç içinden geçiyor. Kapıyı kapı yapan şey kemer çerçevesi ve üzerindeki
    tarayıcı kafaları; ışık rengini sahne veriyor, çünkü PASS/FAIL modelin
    değil kalitenin kararı.
    """
    temizle()
    parcalar = []

    for y in (-1.7, 1.7):
        ayak = kutu("ayak", (0.34, 0.34, 3.0), konum=(0, y, 1.5))
        malzeme(pah(ayak, 0.03), "kalite-celik", KALITE_MOR, metal=0.55, puruz=0.4)
        parcalar.append(ayak)

    kemer = kutu("kemer", (0.34, 3.74, 0.4), konum=(0, 0, 3.2))
    malzeme(pah(kemer, 0.04), "kalite-celik", KALITE_MOR, metal=0.55, puruz=0.4)
    parcalar.append(kemer)

    # Tarayıcı kafaları — kemerden aşağı bakan üç kutu
    for y in (-1.1, 0, 1.1):
        kafa = kutu("tarayici", (0.3, 0.34, 0.3), konum=(0, y, 2.85))
        malzeme(kafa, "kalite-tarayici", KOYU, metal=0.5, puruz=0.35)
        parcalar.append(kafa)

    birlestir(parcalar, "KaliteKapisi")
    disa_aktar("kalite", klasor)


def tamir_hucresi(klasor):
    """
    Tamir hücresi.

    Hattın dışında, açık bir tezgâh alanı: iki tezgâh ve bir alet paneli.
    Kapalı bir kabin değil, çünkü tamir hattan ayrılan aracın görünür olması
    gereken yer.
    """
    temizle()
    parcalar = []

    zemin = kutu("zemin", (4.0, 3.2, 0.08), konum=(0, 0, 0.04))
    malzeme(zemin, "tamir-zemin", (0.30, 0.26, 0.16), puruz=0.95)
    parcalar.append(zemin)

    for y in (-1.2, 1.2):
        tezgah = kutu("tezgah", (2.6, 0.55, 0.1), konum=(-0.4, y, 0.9))
        malzeme(pah(tezgah, 0.02), "tamir-tezgah", (0.36, 0.30, 0.20), puruz=0.8)
        parcalar.append(tezgah)
        for x in (-1.5, 0.7):
            ayak = kutu("ayak", (0.1, 0.5, 0.9), konum=(x, y, 0.45))
            malzeme(ayak, "tamir-celik", CELIK, metal=0.6, puruz=0.5)
            parcalar.append(ayak)

    panel = kutu("alet-paneli", (0.12, 2.0, 1.3), konum=(-1.9, 0, 1.4))
    malzeme(pah(panel, 0.02), "tamir-panel", (0.28, 0.31, 0.38), metal=0.4, puruz=0.6)
    parcalar.append(panel)

    birlestir(parcalar, "TamirHucresi")
    disa_aktar("tamir", klasor)


def konveyor(klasor):
    """
    Konveyör parçası.

    Hattı hat yapan şey. Bir bant yatağı, iki yan korkuluk ve altında rulolar.
    Sahne bunu istasyonlar arasına tekrarlayarak diziyor, o yüzden tek parça
    kısa ve uçları düz.
    """
    temizle()
    parcalar = []

    yatak = kutu("yatak", (4.0, 1.7, 0.12), konum=(0, 0, 0.62))
    malzeme(pah(yatak, 0.02), "konveyor-bant", (0.14, 0.15, 0.18), puruz=0.85)
    parcalar.append(yatak)

    for y in (-0.92, 0.92):
        korkuluk = kutu("korkuluk", (4.0, 0.1, 0.26), konum=(0, y, 0.78))
        malzeme(pah(korkuluk, 0.02), "konveyor-celik", CELIK, metal=0.7, puruz=0.4)
        parcalar.append(korkuluk)

    for x in (-1.5, -0.5, 0.5, 1.5):
        rulo = silindir(
            "rulo", 0.1, 1.6, konum=(x, 0, 0.5), donme=(math.pi / 2, 0, 0), kenar=10
        )
        malzeme(rulo, "konveyor-rulo", (0.45, 0.47, 0.52), metal=0.8, puruz=0.3)
        parcalar.append(rulo)

    for x in (-1.7, 1.7):
        for y in (-0.75, 0.75):
            ayak = kutu("ayak", (0.12, 0.12, 0.5), konum=(x, y, 0.25))
            malzeme(ayak, "konveyor-celik", CELIK, metal=0.7, puruz=0.4)
            parcalar.append(ayak)

    birlestir(parcalar, "Konveyor")
    disa_aktar("konveyor", klasor)


def raf(klasor):
    """Depo rafı — üzerinde paletlerin durduğu çelik iskelet."""
    temizle()
    parcalar = []

    for x in (-1.7, 1.7):
        for y in (-0.6, 0.6):
            dikme = kutu("dikme", (0.12, 0.12, 3.0), konum=(x, y, 1.5))
            malzeme(dikme, "raf-celik", (0.45, 0.28, 0.16), metal=0.5, puruz=0.6)
            parcalar.append(dikme)

    for z in (0.9, 1.9, 2.9):
        for y in (-0.6, 0.6):
            kiris = kutu("kiris", (3.6, 0.1, 0.16), konum=(0, y, z))
            malzeme(kiris, "raf-celik", (0.45, 0.28, 0.16), metal=0.5, puruz=0.6)
            parcalar.append(kiris)

    birlestir(parcalar, "Raf")
    disa_aktar("raf", klasor)


VARLIKLAR = {
    # Faz 1 — mal kabul
    "tir": tir,
    "palet": palet,
    "rampa": rampa,
    # Faz 3 — depo
    "raf": raf,
    # Faz 4-6 — üretim sahası
    "konveyor": konveyor,
    "pres": pres,
    "pres-koc": pres_koc,
    "robot": robot,
    "boyahane": boyahane,
    "montaj": montaj_koprusu,
    "kalite": kalite_kapisi,
    "tamir": tamir_hucresi,
    "operator": operator,
    "arac": arac,
}


def main():
    argumanlar = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argumanlar:
        print("HATA: cikti klasoru verilmedi")
        raise SystemExit(2)
    klasor = argumanlar[0]
    os.makedirs(klasor, exist_ok=True)

    istenen = argumanlar[1:] or list(VARLIKLAR)
    for ad in istenen:
        yapici = VARLIKLAR.get(ad)
        if yapici is None:
            print(f"HATA: bilinmeyen varlik {ad}")
            raise SystemExit(2)
        yapici(klasor)


main()
