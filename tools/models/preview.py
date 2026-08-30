# -*- coding: utf-8 -*-
"""
Fabrika yerleşimini Blender'da kur ve bir önizleme görüntüsü render et.

Neden var
---------
Varlıkları üretip tarayıcıya koyduktan sonra ortaya çıkan soru şu: **gerçekten
neye benziyorlar?** Geliştirme ortamındaki tarayıcı paneli kare üretmediği için
sahne render edilmiyor, dolayısıyla modeller görülmeden gönderiliyordu. Bu
betik o boşluğu kapatıyor: aynı `.glb` dosyalarını, komuta merkezindeki
yerleşimin aynısına dizip tek bir PNG üretiyor.

Bu bir pazarlama görseli değil, bir **kontrol aracı**. Tarayıcıdaki sahnenin
yerini tutmaz — ışıklandırma ve etkileşim orada — ama "pres presse benziyor mu,
araba arabaya benziyor mu" sorusunu cevaplar.

Çalıştırma:
    npm run preview
"""

import math
import os
import sys

import bpy

# Yerleşim `src/factory.ts` ile aynı: istasyonlar 40..120 arası 20 birim
# aralıkla, tamir hattın dışında, mal kabul solda.
ISTASYONLAR = [
    ("pres", 40, 0, 0.0),
    ("weld", 60, 0, 0.0),
    ("boyahane", 80, 0, 0.0),
    ("montaj", 100, 0, 0.0),
    ("kalite", 120, 0, 0.0),
]
TAMIR = ("tamir", 100, 28)
# Akış dışarıdan içeri: mal kabul → giriş kalite → depo. Karantina kalitenin
# yanında, kapıda değil. `src/factory.ts` LOCATION_POSITIONS ile aynı.
RAMPA = (0, 0)
IQC = (11, 0)
KARANTINA = (11, 20)
DEPO = (22, 0)
SEVKIYAT = (165, 0)

# Bu üç sayı `web/src/lib/scene-layout.ts` ve `factory-models.tsx` ile birebir
# aynı olmalı; ayrı düşerlerse önizleme başka bir fabrikayı gösterir.
KONUM_OLCEK = 0.35  # SCALE — plan birimini sahne birimine indirir
VARLIK_OLCEK = 1.05  # ASSET_SCALE — metre cinsinden modelleri sahneye indirir
MERKEZ_X = 82.5
HAT_Y = 8


def dunya(plan_x, plan_y):
    """Plan koordinatını sahne koordinatına çevir (toWorld ile aynı)."""
    return ((plan_x - MERKEZ_X) * KONUM_OLCEK, (plan_y - HAT_Y) * KONUM_OLCEK)


def yerlestir(klasor, ad, plan_x, plan_y, donme_z=0.0, olcek=1.0, yukseklik=0.0):
    """
    Bir varlığı içe aktar ve plan koordinatına yerleştir.

    İçe aktarılan her şey yeni bir boşluğa (empty) bağlanıp boşluk taşınıyor.
    Mesh'in kendi dönüşümüne dokunmak, glTF içe aktarımının Y-yukarı → Z-yukarı
    düzeltmesiyle çakışıyor ve nesneleri yan yatırıyordu.
    """
    onceki = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(klasor, ad + ".glb"))
    yeni = [o for o in bpy.data.objects if o not in onceki]
    if not yeni:
        return None

    bpy.ops.object.empty_add(location=(0, 0, 0))
    tasiyici = bpy.context.active_object
    tasiyici.name = f"{ad}-tasiyici"
    for o in yeni:
        if o.parent is None:
            o.parent = tasiyici

    x, y = dunya(plan_x, plan_y)
    tasiyici.location = (x, y, yukseklik)
    tasiyici.rotation_euler = (0, 0, donme_z)
    olcek_son = VARLIK_OLCEK * olcek
    tasiyici.scale = (olcek_son, olcek_son, olcek_son)
    return tasiyici


def sahne_kur(klasor):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Zemin
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.01))
    zemin = bpy.context.active_object
    mat = bpy.data.materials.new("zemin")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.055, 0.05, 0.09, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    zemin.data.materials.append(mat)

    # Konveyör hattı — istasyonlar boyunca tekrarlanan bölümler
    for plan_x in range(34, 128, 4):
        yerlestir(klasor, "konveyor", plan_x, 0)

    # İstasyon makineleri
    for ad, plan_x, plan_y, donme in ISTASYONLAR:
        if ad == "weld":
            # Kaynak hücresi: konveyörün iki yanında robot
            yerlestir(klasor, "robot", plan_x, 3.2, math.radians(180))
            yerlestir(klasor, "robot", plan_x, -3.2, 0)
            yerlestir(klasor, "operator", plan_x + 4, 4.2, math.radians(180))
        else:
            yerlestir(klasor, ad, plan_x, plan_y, donme)
            if ad == "pres":
                yerlestir(klasor, "pres-koc", plan_x, plan_y)
            if ad == "boyahane":
                yerlestir(klasor, "robot", plan_x - 1.5, 2.0, math.radians(180))
            if ad == "montaj":
                yerlestir(klasor, "robot", plan_x - 3.5, -3.1, 0)
                yerlestir(klasor, "operator", plan_x + 3.5, 3.5, math.radians(180))
            if ad == "kalite":
                yerlestir(klasor, "operator", plan_x + 3.4, 3.5, math.radians(180))

    # Tamir hücresi ve iki tamirci
    yerlestir(klasor, TAMIR[0], TAMIR[1], TAMIR[2])
    yerlestir(klasor, "operator", TAMIR[1] - 1.5, TAMIR[2] + 2.6, math.radians(180))

    # Mal kabul — en dışarıda. Cephe hatta dik duruyor, tır ona yanaşıyor.
    yerlestir(klasor, "rampa", RAMPA[0] - 2, RAMPA[1])
    yerlestir(klasor, "tir", RAMPA[0] + 8, RAMPA[1] - 4, math.radians(180))
    yerlestir(klasor, "palet", RAMPA[0] + 2, RAMPA[1] + 5)

    # Giriş kalite — mal kabulden sonra, depodan önce
    yerlestir(klasor, "iqc-masa", IQC[0], IQC[1])
    yerlestir(klasor, "operator", IQC[0], IQC[1] + 3, math.radians(180))

    # Karantina — kalitenin yanında, akışın durağı değil
    for dx, dy in ((-2, 0), (2, 0), (-2, 3)):
        yerlestir(klasor, "palet", KARANTINA[0] + dx, KARANTINA[1] + dy)

    # Hammadde deposu
    for dy in (-4, 0, 4):
        yerlestir(klasor, "raf", DEPO[0], DEPO[1] + dy, math.radians(90))

    # Sevkiyat — bitmiş araçları alan oto taşıyıcı
    tasiyici = yerlestir(klasor, "oto-tasiyici", SEVKIYAT[0], SEVKIYAT[1], math.radians(-20))
    if tasiyici is not None:
        # Kafeste dört araç: alt kat iki, üst kat iki. Sahnede bu sayı
        # sevkiyatın gerçek yük listesinden geliyor.
        for i, (dx, kat) in enumerate(((1.1, 0.98), (-2.6, 0.98), (1.1, 2.8), (-2.6, 2.8))):
            arac_ = yerlestir(
                klasor, "arac", SEVKIYAT[0], SEVKIYAT[1], math.radians(-20), olcek=0.52
            )
            if arac_ is None:
                continue
            aci = math.radians(-20)
            arac_.location = (
                arac_.location[0] + dx * VARLIK_OLCEK * math.cos(aci),
                arac_.location[1] + dx * VARLIK_OLCEK * math.sin(aci),
                kat * VARLIK_OLCEK,
            )

    # Hatta araçlar — konveyör bandının üstünde, içine gömülü değil.
    # Bant yüksekliği modelde 0.68 m; varlık ölçeğiyle çarpılıyor.
    bant = 0.68 * VARLIK_OLCEK
    for _, plan_x, plan_y, _ in ISTASYONLAR:
        yerlestir(klasor, "arac", plan_x, plan_y, 0, olcek=0.62, yukseklik=bant)
    yerlestir(klasor, "arac", 50, 0, 0, olcek=0.62, yukseklik=bant)
    yerlestir(klasor, "arac", 110, 0, 0, olcek=0.62, yukseklik=bant)
    yerlestir(klasor, "arac", TAMIR[1], TAMIR[2], 0, olcek=0.62)

    isik_kur()
    kamera_kur()


def isik_kur():
    """Tarayıcıdaki ışıklandırmanın kabaca aynısı: bir ana ışık, bir dolgu."""
    bpy.ops.object.light_add(type="SUN", location=(26, -18, 38))
    ana = bpy.context.active_object
    ana.data.energy = 3.2
    ana.rotation_euler = (math.radians(52), 0, math.radians(38))

    bpy.ops.object.light_add(type="SUN", location=(-26, 14, 16))
    dolgu = bpy.context.active_object
    dolgu.data.energy = 0.9
    dolgu.data.color = (0.56, 0.65, 1.0)
    dolgu.rotation_euler = (math.radians(64), 0, math.radians(-140))

    dunya_ = bpy.context.scene.world
    if dunya_ is None:
        dunya_ = bpy.data.worlds.new("Dunya")
        bpy.context.scene.world = dunya_
    dunya_.use_nodes = True
    dunya_.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.07, 0.12, 1)


def kamera_kur():
    """Komuta merkezindeki 'Genel' kamera açısına yakın bir bakış."""
    # Tesis yaklaşık 58 birim geniş (mal kabulden sevkiyata). Kamera bunu
    # tamamen görecek kadar geride ve hattı üçte bir yükseklikten kesecek
    # kadar yukarıda.
    bpy.ops.object.camera_add(location=(0, -40, 24))
    kamera = bpy.context.active_object
    kamera.rotation_euler = (math.radians(62), 0, 0)
    kamera.data.lens = 22
    bpy.context.scene.camera = kamera


def render(cikti):
    sahne = bpy.context.scene
    sahne.render.engine = "BLENDER_EEVEE"
    sahne.render.resolution_x = 1280
    sahne.render.resolution_y = 640
    sahne.render.film_transparent = False
    sahne.render.filepath = cikti
    sahne.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"ONIZLEME {cikti} {os.path.getsize(cikti)}")


def main():
    argumanlar = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argumanlar) < 2:
        print("HATA: model klasoru ve cikti dosyasi gerekli")
        raise SystemExit(2)
    sahne_kur(argumanlar[0])
    render(argumanlar[1])


main()
