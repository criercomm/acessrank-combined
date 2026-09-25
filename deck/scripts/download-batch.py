#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""download-batch.py — baja las generaciones de Magnific a assets/source/<grupo>/ y arma hojas de contacto
etiquetadas en refs/review/ para curar. Fuente de verdad de los lotes: scripts/batches/*.json
  { "<creationId>": ["<grupo>", "<nombre>", "<url>"], ... }
Uso: python scripts/download-batch.py scripts/batches/lote1.json [más.json ...]
"""
import sys, os, json, urllib.request, collections
import concurrent.futures as cf
from PIL import Image, ImageDraw

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ITEMS = {}
for p in sys.argv[1:]:
    with open(p, encoding="utf-8") as fh:
        ITEMS.update(json.load(fh))

def dl(item):
    cid, (group, name, url) = item
    ext = ".jpg" if "/render.jpg" in url else ".png"
    os.makedirs(f"assets/source/{group}", exist_ok=True)
    out = f"assets/source/{group}/{name}-{cid}{ext}"
    if not os.path.exists(out) or os.path.getsize(out) < 1000:
        urllib.request.urlretrieve(url, out)
    return out

with cf.ThreadPoolExecutor(8) as ex:
    outs = list(ex.map(dl, ITEMS.items()))
print(len(outs), "descargadas", sum(os.path.getsize(o) for o in outs) // 1_000_000, "MB")

# hojas de contacto: una por grupo-nombre (p. ej. tile-living-B), con todos los archivos que ya existan de ese nombre
groups = collections.defaultdict(set)
for f in outs:
    group = f.split("/")[2]
    base = os.path.basename(f)
    name = base.rsplit("-", 1)[0]
    d = f"assets/source/{group}"
    for g in os.listdir(d):
        if g.startswith(name + "-") and g.lower().endswith((".png", ".jpg", ".jpeg")):
            groups[f"{group}-{name}"].add(os.path.join(d, g))
os.makedirs("refs/review", exist_ok=True)
for key, files in sorted(groups.items()):
    files = sorted(files)
    W, H = 720, 405
    cols = min(4, len(files)) if len(files) > 2 else len(files)
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, (H + 28) * rows), (0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB").resize((W, H))
        x, y = (i % cols) * W, (i // cols) * (H + 28)
        sheet.paste(im, (x, y + 28))
        d.text((x + 8, y + 8), f"{i + 1}  {os.path.basename(f)}", fill=(232, 228, 220))
    out = f"refs/review/{key}.jpg"
    sheet.save(out, quality=82)
    print(out, len(files))
