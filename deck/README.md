# Deck R · ACCESSRANK — "The web's biggest blind spot"

Deck interactivo (V3.7, 11 escenas) para el levantamiento de fondos de Accessrank (presenta JP Lincoln). Plan, prompts y decisiones: `PLAN.md`. Procedencia de cada asset y libro de créditos: `manifest.json`. Guía del presentador: `PRESENTER.md` / `PRESENTER.pdf`.

Este repo es standalone: incluye una copia empaquetada de la librería compartida de la máquina de decks en `lib/` (normalmente vive fuera de este repo, en `../lib`, y la comparten varios decks). `vite.config.js` usa `../lib` si existe y si no cae a `./lib`, así que un clon de solo este repo funciona igual.

## Publicar hoy (contexto para JP)

- `www.accessrank.ai/deck/` — lo sirve una app en Fly.io (org `accessrank`), detrás de una contraseña en todo el dominio. El deploy ahí necesita acceso a esa app de Fly (no incluido en este repo).
- `accessrank-rust.vercel.app/deck/` — copia pública que se actualiza empujando `deck/` (el `dist/` construido) al repo `cmarruffo1982/accessrank`, que Vercel redespliega automáticamente. El deploy ahí necesita acceso a ese repo de Vercel/GitHub (tampoco incluido aquí).

Este repo (`accessrank-deck`) es la fuente editable. Para publicar un cambio hace falta, además, acceso a uno de los dos destinos de arriba — pregúntale a Carlos si aún no lo tienes.

## Comandos

```
npm i                                   # dependencias (vite, gsap, sharp, puppeteer-core, marked)
npm run dev                             # http://localhost:5178
npm run build                           # dist/ (solo entran assets/final y assets/audio)
node scripts/manifest-init.mjs          # (re)genera manifest.json con todas las filas planeadas; idempotente
node scripts/credits.mjs status         # libro de créditos: gastado / techo / balance estimado
node scripts/credits.mjs add <cr> <gens> "<nota>"
python scripts/download-batch.py scripts/batches/<lote>.json   # baja generaciones a assets/source + hojas de contacto en refs/review
node scripts/finalize-photo.mjs <id> <src>                      # foto sin recorte → AVIF/WebP + fila final
node scripts/manifest-merge.mjs assets/cutouts/manifest.json    # vuelca cut-outs (cutout-factory) al manifest del deck
node scripts/shots.mjs --slides 1,4 --w 1440 --h 900 [--keys ArrowRight,ArrowRight --after 3000]   # capturas reales + consola
node scripts/check-gate.mjs             # la puerta arranca el audio y la cama se pide a la red
node scripts/presenter-pdf.mjs          # PRESENTER.md → PRESENTER.pdf
DECK_BASE=/deck/ npm run build          # build para publicar (ver "Publicar hoy" arriba); NO usar un build relativo, Fly y Vercel sirven /deck sin barra final
```

`deploy.ps1` y `scripts/deploy-missing.ps1` suben a eureka.pe por FTP y necesitan un `ftp.config.json` local (no va en el repo). Ya no es destino de este deck — ignóralos salvo que Carlos diga lo contrario.

Navegación: flechas / espacio / click / swipe / rueda · `?slide=n` · `?presenter=1` (panel del presentador) · `?short=1` (ruta de 3 minutos: 01 → 02 → 04 → 07 → 10 → 12) · `?gate=0` (sin puerta, para capturas) · `M` silencia.

## Reglas (no se negocian)

- Style-lock R en todo prompt (ver `PLAN.md §1` y `manifest.styleLock`). Sin style-lock no se genera.
- Ninguna cara identificable: las siluetas van de espaldas. Nombre de marca solo en texto; el check amarillo está dibujado en CSS.
- Nada entra a un slide sin fila en `manifest.json`. Todo cut-out con sombra de contacto y QA de bordes.
- Copy solo en inglés. Nada que `../AccessRank-capacidades.md §13` prohíba. Los valores entre corchetes y las fichas `TBD` son datos que JP/Carlos deben rellenar en `src/copy.js` antes de la sala.
- Techo 10.000 créditos; balance inicial 23.035 (2026-09-14). `assets/source/`, `refs/`, `dont upload.txt` y `ftp.config.json` nunca al repo ni al bundle.

## Estructura

```
src/main.js · src/copy.js · src/style.css · src/slides/s01…s12
src/components/{ui,presenter,storefront,ring,typed,wall,magnetic}.js · scripts/letter-page.py (página 1 del complaint, desenfoque)
public/fonts (Inter + JetBrains Mono, variables) · assets/{source,cutouts,final,audio} · scripts/ · refs/review (hojas de contacto y capturas)
```
