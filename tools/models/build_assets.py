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
    Mal kabul: depo cephesi, içinde kapılar, önünde yükleme platformu.

    İlk sürüm havada duran bir sundurmaydı ve fabrikadan çok otopark girişine
    benziyordu. Mal kabul **bir binanın kapısıdır**: arkasında duvar olmadan
    tırın neye yanaştığı belli olmuyor.

    Cephe +Y ekseni boyunca uzanıyor, tır +X yönünden yanaşıyor.
    """
    temizle()
    parcalar = []

    # Depo cephesi — sahnedeki en büyük düz yüzey, mal kabulü bina yapan şey
    cephe = kutu("cephe", (1.0, 16.0, 7.0), konum=(-3.5, 0, 3.5))
    malzeme(pah(cephe, 0.06), "depo-cephe", (0.21, 0.22, 0.28), metal=0.15, puruz=0.8)
    parcalar.append(cephe)

    # Çatı saçağı — yalnızca kapıların üstünü örtüyor.
    #
    # İlk sürümde 4.6 m taşıyordu ve ekrandan bakıldığında bütün mal kabul
    # alanını gizleyen düz bir levha gibi duruyordu. Saçak, altındaki işi
    # göstermeyi engelliyorsa yanlış boyuttadır.
    sacak = kutu("sacak", (1.8, 16.0, 0.3), konum=(-2.4, 0, 6.9))
    malzeme(pah(sacak, 0.04), "depo-cephe", (0.21, 0.22, 0.28), metal=0.15, puruz=0.8)
    parcalar.append(sacak)

    for y in (-4.0, 4.0):
        # Kapı boşluğu — cephede koyu dikdörtgen
        kapi = kutu("kapi", (0.12, 4.4, 4.4), konum=(-2.95, y, 2.5))
        malzeme(kapi, "depo-kapi", (0.07, 0.08, 0.11), puruz=0.9)
        parcalar.append(kapi)

        # Kapı üstü sarı şerit: sahada kapıyı işaretleyen şey
        serit = kutu("serit", (0.14, 4.4, 0.22), konum=(-2.94, y, 4.82))
        malzeme(serit, "depo-serit", SARI, puruz=0.6)
        parcalar.append(serit)

        # Yükleme platformu — tır kasası seviyesine yükseltilmiş beton
        platform = kutu("platform", (3.4, 5.2, 1.2), konum=(-1.2, y, 0.6))
        malzeme(pah(platform, 0.04), "rampa-beton", (0.26, 0.27, 0.32), puruz=0.95)
        parcalar.append(platform)

        # Yanaşma tamponları — tırın değdiği yer
        for dy in (-1.9, 1.9):
            tampon = kutu("tampon", (0.22, 0.5, 0.34), konum=(0.6, y + dy, 1.05))
            malzeme(tampon, "rampa-tampon", (0.48, 0.15, 0.12), puruz=0.85)
            parcalar.append(tampon)

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
    """
    Depo rafı: iki dikey çerçeve, aralarında kirişler, gözlerinde yük.

    Önceki sürüm ince çubuklardan oluşuyordu ve uzaktan yatmış bir çite
    benziyordu. Gerçek palet rafı ağırdır: kalın dikmeler, çapraz bağlantılar
    ve dolu gözler. Boş bir raf depo gibi durmuyor.
    """
    temizle()
    parcalar = []

    for x in (-1.8, 1.8):
        for y in (-0.65, 0.65):
            dikme = kutu("dikme", (0.18, 0.18, 3.4), konum=(x, y, 1.7))
            malzeme(pah(dikme, 0.02), "raf-celik", (0.42, 0.26, 0.14), metal=0.5, puruz=0.6)
            parcalar.append(dikme)
        for z in (0.9, 2.3):
            capraz = kutu("capraz", (0.1, 1.5, 0.09), konum=(x, 0, z), donme=(0.7, 0, 0))
            malzeme(capraz, "raf-celik", (0.42, 0.26, 0.14), metal=0.5, puruz=0.6)
            parcalar.append(capraz)

    for z in (1.15, 2.35, 3.3):
        for y in (-0.65, 0.65):
            kiris = kutu("kiris", (3.9, 0.14, 0.2), konum=(0, y, z))
            malzeme(kiris, "raf-celik", (0.42, 0.26, 0.14), metal=0.5, puruz=0.6)
            parcalar.append(kiris)
        tabla = kutu("tabla", (3.7, 1.35, 0.06), konum=(0, 0, z + 0.12))
        malzeme(tabla, "raf-tabla", (0.30, 0.24, 0.16), puruz=0.9)
        parcalar.append(tabla)

    for z in (1.35, 2.55):
        for x in (-1.0, 1.0):
            yuk = kutu("yuk", (1.4, 1.1, 0.75), konum=(x, 0, z + 0.42))
            malzeme(pah(yuk, 0.02), "raf-yuk", CELIK, metal=0.45, puruz=0.55)
            parcalar.append(yuk)

    birlestir(parcalar, "Raf")
    disa_aktar("raf", klasor)


def oto_tasiyici(klasor):
    """
    Oto taşıyıcı: çekici + açık iki katlı araç taşıma kafesi.

    Kapalı dorse yanlış araç olurdu — bitmiş araba kapalı kasada değil, açık
    kafeste gider ve fabrikadan çıkan şeyin ne olduğu uzaktan görünür. Kafes
    boş modelleniyor; üstündeki araçları sahne koyuyor ve **sayısı sevkiyatın
    gerçek araç sayısı** kadar oluyor.

    Uzunluk ekseni +X, çekici önde.
    """
    temizle()
    parcalar = []

    # Çekici — tırla aynı aile, aynı renk
    kabin = kutu("kabin", (2.3, 2.4, 2.3), konum=(3.4, 0, 1.85))
    malzeme(pah(kabin, 0.06), "tir-kabin", SARI, metal=0.2, puruz=0.4)
    parcalar.append(kabin)
    cam = kutu("cam", (0.08, 2.0, 0.9), konum=(4.52, 0, 2.35))
    malzeme(cam, "tir-cam", CAM, metal=0.1, puruz=0.15)
    parcalar.append(cam)
    kaput = kutu("kaput", (1.0, 2.2, 0.9), konum=(5.0, 0, 1.1))
    malzeme(pah(kaput, 0.04), "tir-kaput", SARI, metal=0.2, puruz=0.4)
    parcalar.append(kaput)

    # Şase
    sase = kutu("sase", (8.4, 2.1, 0.24), konum=(-1.6, 0, 0.7))
    malzeme(pah(sase, 0.02), "tir-sase", KOYU, metal=0.4, puruz=0.5)
    parcalar.append(sase)

    # Alt kat platformu
    alt_kat = kutu("alt-kat", (8.0, 2.3, 0.1), konum=(-1.6, 0, 0.88))
    malzeme(pah(alt_kat, 0.02), "tasiyici-kat", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(alt_kat)

    # Üst kat platformu — taşıyıcıyı taşıyıcı yapan şey
    ust_kat = kutu("ust-kat", (7.4, 2.3, 0.1), konum=(-1.9, 0, 2.7))
    malzeme(pah(ust_kat, 0.02), "tasiyici-kat", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(ust_kat)

    # Kafes dikmeleri
    for x in (1.9, -0.4, -2.8, -5.2):
        for y in (-1.1, 1.1):
            dikme = kutu("dikme", (0.14, 0.14, 1.9), konum=(x, y, 1.78))
            malzeme(dikme, "tasiyici-kafes", CELIK, metal=0.75, puruz=0.35)
            parcalar.append(dikme)

    # Yan korkuluklar — açık kafes, kapalı duvar değil
    for z in (1.25, 3.05):
        for y in (-1.12, 1.12):
            korkuluk = kutu("korkuluk", (7.8, 0.08, 0.12), konum=(-1.7, y, z))
            malzeme(korkuluk, "tasiyici-kafes", CELIK, metal=0.75, puruz=0.35)
            parcalar.append(korkuluk)

    # Arka rampa — yüklemenin nereden yapıldığı
    rampa_ = kutu("rampa", (1.4, 2.2, 0.08), konum=(-6.2, 0, 0.62), donme=(0, -0.22, 0))
    malzeme(rampa_, "tasiyici-kat", CELIK, metal=0.7, puruz=0.45)
    parcalar.append(rampa_)

    # Tekerlekler
    for x in (4.7, 2.8, -3.4, -4.6, -5.8):
        for y in (-1.15, 1.15):
            teker = silindir(
                "teker", 0.55, 0.34, konum=(x, y, 0.55), donme=(math.pi / 2, 0, 0), kenar=14
            )
            malzeme(teker, "tir-lastik", LASTIK, puruz=0.9)
            parcalar.append(teker)

    birlestir(parcalar, "OtoTasiyici")
    disa_aktar("oto-tasiyici", klasor)


def kalite_masasi(klasor):
    """
    Giriş kalite kontrol tezgâhı.

    Mal kabulden çıkan malzeme doğrudan depoya gitmez; önce burada bakılır.
    Tezgâh, üstünde ölçü aleti, yanında numune rafı. Kapalı bir laboratuvar
    değil — girdi kalitesi hattın kenarında, gelen malın yanında yapılır.
    """
    temizle()
    parcalar = []

    tezgah = kutu("tezgah", (3.2, 1.2, 0.12), konum=(0, 0, 0.92))
    malzeme(pah(tezgah, 0.02), "iqc-tezgah", (0.34, 0.36, 0.42), metal=0.3, puruz=0.6)
    parcalar.append(tezgah)
    for x in (-1.4, 1.4):
        for y in (-0.45, 0.45):
            ayak = kutu("ayak", (0.1, 0.1, 0.92), konum=(x, y, 0.46))
            malzeme(ayak, "iqc-celik", CELIK, metal=0.7, puruz=0.4)
            parcalar.append(ayak)

    # Ölçü kolonu ve tarama kafası — masayı "kontrol" masası yapan şey
    kolon = kutu("kolon", (0.18, 0.18, 1.5), konum=(-1.2, 0, 1.7))
    malzeme(pah(kolon, 0.02), "iqc-celik", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(kolon)
    kafa = kutu("tarayici", (0.9, 0.3, 0.24), konum=(-0.7, 0, 2.3))
    malzeme(pah(kafa, 0.03), "iqc-tarayici", KOYU, metal=0.5, puruz=0.35)
    parcalar.append(kafa)

    # Numune rafı
    raf_ = kutu("numune-rafi", (0.9, 1.1, 0.1), konum=(1.5, 0, 1.5))
    malzeme(raf_, "iqc-tezgah", (0.34, 0.36, 0.42), metal=0.3, puruz=0.6)
    parcalar.append(raf_)

    birlestir(parcalar, "KaliteMasasi")
    disa_aktar("iqc-masa", klasor)


def doli(klasor):
    """
    Doli arabası — iç lojistik taşıma arabası.

    Hücrelere parça besleyen şey bu. Motor zaten onu **hammadde deposundan
    ilgili hücrenin hat kenarına** sürüyor; burada eksik olan tek şey neye
    benzediğiydi: düz bir kutuydu.

    Arabayı araba yapan üç şey: alçak yük platformu, dört küçük tekerlek ve
    öne uzanan çeki oku. Ok olmadan kendi kendine giden bir kutu gibi durur;
    gerçek doli çekilir.

    Uzunluk ekseni +X, ok önde.
    """
    temizle()
    parcalar = []

    # Yük platformu
    platform = kutu("platform", (1.9, 1.1, 0.1), konum=(0, 0, 0.42))
    malzeme(pah(platform, 0.02), "doli-platform", (0.30, 0.33, 0.40), metal=0.5, puruz=0.5)
    parcalar.append(platform)

    # Şase
    sase = kutu("sase", (1.8, 0.9, 0.09), konum=(0, 0, 0.3))
    malzeme(sase, "doli-sase", KOYU, metal=0.5, puruz=0.55)
    parcalar.append(sase)

    # Köşe dikmeleri — yükün kaymasını engelleyen kafes
    for x in (-0.85, 0.85):
        for y in (-0.48, 0.48):
            dikme = kutu("dikme", (0.07, 0.07, 0.55), konum=(x, y, 0.74))
            malzeme(dikme, "doli-kafes", SARI, metal=0.4, puruz=0.45)
            parcalar.append(dikme)

    # Tekerlekler — küçük, endüstriyel
    for x in (-0.7, 0.7):
        for y in (-0.5, 0.5):
            teker = silindir(
                "teker", 0.16, 0.1, konum=(x, y, 0.16), donme=(math.pi / 2, 0, 0), kenar=10
            )
            malzeme(teker, "doli-teker", LASTIK, puruz=0.9)
            parcalar.append(teker)

    # Çeki oku — arabanın çekildiğini anlatan parça
    ok = kutu("ceki-oku", (0.9, 0.09, 0.09), konum=(1.35, 0, 0.3))
    malzeme(ok, "doli-ok", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(ok)
    halka = silindir("halka", 0.11, 0.06, konum=(1.78, 0, 0.3), kenar=10)
    malzeme(halka, "doli-ok", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(halka)

    birlestir(parcalar, "Doli")
    disa_aktar("doli", klasor)


def sevkiyat_binasi(klasor):
    """
    Sevkiyat binası — mal kabulle aynı mantık, ters yön.

    Talep açıktı: "mal kabul için uygulanan mantığın aynısını sevkiyata da
    uygula". Aynı aile, aynı cephe, aynı kapı işaretleri; fark yalnızca
    kapıların **+X'e** bakması, çünkü araç fabrikadan o yöne çıkıyor.
    """
    temizle()
    parcalar = []

    cephe = kutu("cephe", (1.0, 15.0, 6.4), konum=(3.5, 0, 3.2))
    malzeme(pah(cephe, 0.06), "sevk-cephe", (0.21, 0.22, 0.28), metal=0.15, puruz=0.8)
    parcalar.append(cephe)

    sacak = kutu("sacak", (1.8, 15.0, 0.3), konum=(2.4, 0, 6.3))
    malzeme(pah(sacak, 0.04), "sevk-cephe", (0.21, 0.22, 0.28), metal=0.15, puruz=0.8)
    parcalar.append(sacak)

    for y in (-4.6, 0.0, 4.6):
        kapi = kutu("kapi", (0.12, 3.9, 4.2), konum=(2.95, y, 2.4))
        malzeme(kapi, "sevk-kapi", (0.07, 0.08, 0.11), puruz=0.9)
        parcalar.append(kapi)

        serit = kutu("serit", (0.14, 3.9, 0.2), konum=(2.94, y, 4.62))
        malzeme(serit, "sevk-serit", SARI, puruz=0.6)
        parcalar.append(serit)

        platform = kutu("platform", (3.4, 5.2, 1.2), konum=(1.2, y, 0.6))
        malzeme(pah(platform, 0.04), "sevk-beton", (0.26, 0.27, 0.32), puruz=0.95)
        parcalar.append(platform)

    birlestir(parcalar, "SevkiyatBinasi")
    disa_aktar("sevkiyat", klasor)


def gecis(klasor):
    """
    Giriş kaliteden üretime geçiş.

    Talebin en somut maddesi: giriş kalite kapısının **arkasında** malın
    üretime geçtiği bir delik olmalı. Onaylanan malzemenin nereden içeri
    girdiği planda görünmüyordu; kontrol edilen mal sanki havada üretime
    ışınlanıyordu.

    Bir duvar parçası ve içinde bir açıklık. Açıklığın kenarı sarı-siyah
    şeritli, çünkü sahada geçiş noktaları işaretlidir.
    """
    temizle()
    parcalar = []

    # Duvar, ortasında boşluk bırakacak şekilde dört parça
    for y, genislik in ((-4.2, 4.4), (4.2, 4.4)):
        kanat = kutu("kanat", (0.6, genislik, 5.0), konum=(0, y, 2.5))
        malzeme(pah(kanat, 0.04), "gecis-duvar", (0.20, 0.21, 0.27), metal=0.15, puruz=0.8)
        parcalar.append(kanat)

    lento = kutu("lento", (0.6, 4.2, 1.4), konum=(0, 0, 4.3))
    malzeme(pah(lento, 0.04), "gecis-duvar", (0.20, 0.21, 0.27), metal=0.15, puruz=0.8)
    parcalar.append(lento)

    # Açıklığın kenarları — geçişi işaretleyen sarı çerçeve
    for y in (-2.05, 2.05):
        kenar = kutu("kenar", (0.66, 0.16, 3.6), konum=(0, y, 1.8))
        malzeme(kenar, "gecis-serit", SARI, puruz=0.55)
        parcalar.append(kenar)
    ust = kutu("ust-kenar", (0.66, 4.26, 0.16), konum=(0, 0, 3.68))
    malzeme(ust, "gecis-serit", SARI, puruz=0.55)
    parcalar.append(ust)

    # Zemindeki geçiş eşiği
    esik = kutu("esik", (0.9, 4.0, 0.06), konum=(0, 0, 0.03))
    malzeme(esik, "gecis-esik", (0.30, 0.28, 0.16), puruz=0.9)
    parcalar.append(esik)

    birlestir(parcalar, "Gecis")
    disa_aktar("gecis", klasor)


def guvenlik(klasor):
    """
    Fabrika güvenlik kapısı — tesise girişin ilk noktası.

    Sahada hiçbir tır doğrudan mal kabule dalmaz: önce kapıda durur, evrakı
    kontrol edilir, bariyer kalkar. Sahnede bu nokta yoktu ve tır sanki
    fabrikanın içinde beliriveriyordu.

    Üç parça: iki yandan kapı direkleri, sağda güvenlik kulübesi, ortada
    kalkan bariyer. Bariyer yatay duruyor — yani kapalı; tır geçerken
    açıldığını anlatmak sahnenin işi, modelin değil.

    Geçiş ekseni +X; kapıdan geçen araç bu yönde ilerler.
    """
    temizle()
    parcalar = []

    # Kapı direkleri — geçiş açıklığını tanımlayan şey
    for y in (-4.6, 4.6):
        direk = kutu("direk", (0.7, 0.7, 5.4), konum=(0, y, 2.7))
        malzeme(pah(direk, 0.04), "guv-direk", (0.24, 0.25, 0.31), metal=0.2, puruz=0.75)
        parcalar.append(direk)

    # Üst kiriş — kapıyı "kapı" yapan, üstten bağlayan parça
    kiris = kutu("kiris", (0.7, 9.9, 0.8), konum=(0, 0, 5.8))
    malzeme(pah(kiris, 0.04), "guv-direk", (0.24, 0.25, 0.31), metal=0.2, puruz=0.75)
    parcalar.append(kiris)

    # Kirişin altındaki sarı şerit: yükseklik sınırını işaretler
    serit = kutu("serit", (0.74, 9.9, 0.24), konum=(0, 0, 5.3))
    malzeme(serit, "guv-serit", SARI, puruz=0.55)
    parcalar.append(serit)

    # Güvenlik kulübesi — camlı, içeride biri var
    kulube = kutu("kulube", (2.6, 2.6, 3.0), konum=(0, 6.9, 1.5))
    malzeme(pah(kulube, 0.05), "guv-kulube", (0.21, 0.22, 0.28), metal=0.15, puruz=0.8)
    parcalar.append(kulube)

    for x, y, boyut in ((-1.32, 6.9, (0.06, 2.0, 1.2)), (0, 5.58, (2.0, 0.06, 1.2))):
        cam_p = kutu("kulube-cam", boyut, konum=(x, y, 2.0))
        malzeme(cam_p, "guv-cam", CAM, metal=0.1, puruz=0.15)
        parcalar.append(cam_p)

    cati = kutu("kulube-cati", (3.0, 3.0, 0.16), konum=(0, 6.9, 3.08))
    malzeme(pah(cati, 0.03), "guv-cati", KOYU, metal=0.3, puruz=0.7)
    parcalar.append(cati)

    # Bariyer menteşesi. Kolun kendisi ayrı bir varlık (`bariyer`), çünkü
    # açılıp kapanması gerekiyor ve sahne onu bu noktadan döndürüyor.
    mil = silindir("bariyer-mil", 0.22, 0.5, konum=(0, 5.2, 1.15), donme=(0, math.pi / 2, 0))
    malzeme(mil, "guv-mil", CELIK, metal=0.7, puruz=0.4)
    parcalar.append(mil)

    kaide = kutu("mil-kaide", (0.5, 0.5, 1.15), konum=(0, 5.2, 0.58))
    malzeme(pah(kaide, 0.03), "guv-kaide", (0.24, 0.25, 0.31), metal=0.3, puruz=0.7)
    parcalar.append(kaide)

    birlestir(parcalar, "Guvenlik")
    disa_aktar("guvenlik", klasor)


def bariyer(klasor):
    """
    Bariyer kolu — kapıdan ayrı, çünkü açılıp kapanıyor.

    Menteşe **orijinde**: sahne kolu buradan döndürüyor. Kol −Y yönünde
    uzanıyor, yani kapalıyken geçişin karşısında yatıyor; açılırken X ekseni
    etrafında yukarı kalkıyor.

    Kırmızı-beyaz şeritler süs değil: bariyerin kapalı olduğunu uzaktan
    okutan şey onlar.
    """
    temizle()
    parcalar = []

    uzunluk = 8.4
    kol = kutu("kol", (0.16, uzunluk, 0.22), konum=(0, -uzunluk / 2, 0))
    malzeme(kol, "bariyer-kol", (0.62, 0.18, 0.15), puruz=0.5)
    parcalar.append(kol)

    # Şeritler kol boyunca eşit aralıklı
    for i in range(1, 6):
        y = -uzunluk * i / 6
        band = kutu("band", (0.18, uzunluk / 12, 0.24), konum=(0, y, 0))
        malzeme(band, "bariyer-band", (0.86, 0.86, 0.88), puruz=0.5)
        parcalar.append(band)

    # Uçtaki karşı ağırlık — gerçek bariyerlerde kolu dengeleyen parça
    agirlik = kutu("agirlik", (0.3, 0.5, 0.3), konum=(0, 0.45, 0))
    malzeme(pah(agirlik, 0.03), "bariyer-agirlik", KOYU, metal=0.5, puruz=0.5)
    parcalar.append(agirlik)

    birlestir(parcalar, "Bariyer")
    disa_aktar("bariyer", klasor)


VARLIKLAR = {
    # Faz 1 — mal kabul
    "tir": tir,
    "oto-tasiyici": oto_tasiyici,
    "palet": palet,
    "rampa": rampa,
    "iqc-masa": kalite_masasi,
    "gecis": gecis,
    "guvenlik": guvenlik,
    "bariyer": bariyer,
    "sevkiyat": sevkiyat_binasi,
    "doli": doli,
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
