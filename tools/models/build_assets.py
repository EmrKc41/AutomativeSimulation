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
CAM = (0.30, 0.45, 0.62)


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

VARLIKLAR = {
    "tir": tir,
    "palet": palet,
    "rampa": rampa,
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
