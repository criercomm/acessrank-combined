#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""letter-page.py — renderiza la página 1 del complaint (refs/martinez-v-ecofish-complaint.pdf) a PNG y desenfoca
la información sensible (personas, direcciones, teléfono, email, número de índice, bufete y cliente).
Salida: assets/source/letter/dR-s02-letter-page.png (≈ 1700 px de ancho) + refs/review/letter-page-check.jpg
Uso: python scripts/letter-page.py
"""
import sys, os
import fitz  # PyMuPDF
from PIL import Image, ImageFilter, ImageDraw

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "refs", "martinez-v-ecofish-complaint.pdf")
OUT = os.path.join(ROOT, "assets", "source", "letter", "dR-s02-letter-page.png")
CHECK = os.path.join(ROOT, "refs", "review", "letter-page-check.jpg")
ZOOM = 2.8  # 612 pt → ~1714 px

# Todo lo que identifica a personas, empresas y contacto. El tribunal, "Summons", las fechas y el cuerpo quedan legibles.
SENSITIVE = [
    "PEDRO MARTINEZ", "Pedro Martinez", "Martinez",
    "ECOFISH, INC.", "Ecofish, Inc.", "Ecofish",
    "Henry W. Lovejoy", "340 Central Avenue, S305", "Dover, NH 03820",
    "75 Wilson Street, Brooklyn, NY", "11249",
    "SHAKED LAW GROUP, P.C.", "Dan Shaked, Esq.", "Dan Shaked", "/s/Dan Shaked",
    "14 Harwood Court, Suite 415", "Scarsdale, NY 10583",
    "(917) 373-9128", "ShakedLawGroup@gmail.com",
    "509692/2026",
]

doc = fitz.open(PDF)
page = doc[0]
rects = []
for s in SENSITIVE:
    for r in page.search_for(s):
        rects.append(r)
print(f"regiones sensibles encontradas: {len(rects)}")

pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

# desenfoque fuerte + un velo del color del papel para que no se pueda "des-desenfocar" a ojo
for r in rects:
    x0, y0, x1, y1 = [int(v * ZOOM) for v in (r.x0 - 2, r.y0 - 2, r.x1 + 2, r.y1 + 2)]
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(img.width, x1), min(img.height, y1)
    if x1 <= x0 or y1 <= y0:
        continue
    region = img.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius=14))
    veil = Image.new("RGB", region.size, (250, 250, 250))
    region = Image.blend(region, veil, 0.35)
    img.paste(region, (x0, y0))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT, optimize=True)
print(f"→ {OUT} {img.width}x{img.height}")

# hoja de revisión con las cajas marcadas
chk = img.copy().resize((img.width // 2, img.height // 2))
d = ImageDraw.Draw(chk)
for r in rects:
    d.rectangle([r.x0 * ZOOM / 2, r.y0 * ZOOM / 2, r.x1 * ZOOM / 2, r.y1 * ZOOM / 2], outline=(220, 40, 40), width=2)
os.makedirs(os.path.dirname(CHECK), exist_ok=True)
chk.save(CHECK, quality=80)
print(f"→ {CHECK}")
