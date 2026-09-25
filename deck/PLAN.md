# PLAN.md — Deck R · AccessRank · "THE WEB'S BIGGEST BLIND SPOT" (V2)

Borrador v0 · 2026-09-14 · Deck de levantamiento de fondos que presenta **JP Lincoln** ante inversionistas en **Dallas**. Sin contexto adicional de la reunión (monto, formato, fecha, tipo de ronda): el deck se diseña para funcionar en 8–10 minutos con una ruta corta de 3 minutos. Fuente de verdad del producto: `../AccessRank-capacidades.md`. Sistema: `../lib` + skill `deck-motion`. Copy en inglés; todo lo demás en español. Copy = borrador hasta el gate de Carlos.

**Balance Magnific al arrancar: 23.035 créditos** (2026-09-14). Techo del deck: 10.000. Aviso a 8.000.

**Estado al 2026-09-14 (tarde): deck construido y publicado en privado** en `https://eureka.pe/decks/accessrank/` (noindex, sin enlace público). 10 escenas, copy solo en inglés, ruta corta `?short=1`, presenter `?presenter=1`. Créditos gastados 1.160 (11 generaciones: 5 prompts × 2 candidatos + cama Lyria). Guía de JP: `PRESENTER.md` + `PRESENTER.pdf`. Build: 3 MB totales (1,5 MB imágenes AVIF/WebP, 1,2 MB audio, 157 KB JS, 37 KB CSS), consola limpia, puerta de sonido verificada. Pendiente de Carlos/JP (§5): monto de la ronda, tracción, roles/bios, capturas reales del producto (opcional), formato de la sala, email de JP. Todo eso vive en `src/copy.js` y se ve en pantalla como `[…]` o `TBD` a propósito.

**Despliegue oficial (2026-09-15, regla de Carlos):** `https://www.accessrank.ai/deck/`. El dominio lo sirve una app Node en **Fly.io** (cuenta aws@crierpr.com), no Vercel; el deck se añade como capa sobre la imagen de producción (`C:/Developer/accessrank-fly-deck`, build con `DECK_BASE=/deck/`). Al desplegar salió a la luz que la Postgres de la app (Supabase `tbqrhtgnjopylnsslrjr`) ya no existe y el servidor en `production` sale al arrancar: el sitio quedó en crash-loop unos 15 minutos y se estabilizó con `NODE_ENV=staging` (release v11) hasta que Carlos restaure la BD. Copias del deck: GitHub→Vercel (`accessrank-rust.vercel.app/deck/`) y eureka.pe. Sobre esa copia: el `synchronize` de WinSCP falló 8 veces seguidas el 2026-09-14 (el servidor cerraba las conexiones de datos de los listados; el deck Miami no tuvo ni un timeout el 6-7 de septiembre). Se subió con `scripts/deploy-missing.ps1` (put individual + verificación HTTP por tamaño): 60/60 archivos en el servidor.

**V2 · 2026-09-15 (notas de JP Lincoln + complaint Martinez v. Ecofish):** portada sin nombre, Dallas ni fechas; titular "The web's biggest blind spot" con el copy de JP (95 % con WebAIM Million 2025 en vez del 98 % de 2020; "fail accessibility standards" en vez de "aren't ADA compliant"); mockup 3D de la home generado con gpt-2 (fondo transparente, 600 cr. × 2) en lugar de los productos; escena 2 con la página 1 del complaint real renderizada y 24 regiones desenfocadas (personas, direcciones, teléfono, email, bufete, cliente, índice) saliendo del sobre; escena 3 "Accessibility plug-ins don't just fail. They trigger lawsuits." + copy de JP; escena 5 "No site downtime. Every fix documented to keep the lawyers at bay." con la explicación centrada bajo el botón activo; escena 6 "…enable accessibility raise the rankings too"; escena 8 nacional: dos listas rankeadas del reporte anual 2025 de EcomBack (demandas por estado y por mercado/industria; interpretación de "top 10 US markets", solo hay 7 estados con dato + resto); escena 10 cierra con "Fixing the web's biggest blind spot"; escena 11 nueva de contacto con placeholders. Créditos totales 2.560. **V2.1 (mismo día):** Carlos pidió esconder el sobre en la escena 2; queda oculto tras la bandera `SHOW_ENVELOPE` en `s02-letter.js` (asset y coreografía de caída conservados).

**V3 · 2026-09-15 (segunda tanda de notas de JP):** portada con la home sola (gpt-2, 600 cr.) un 12 % más grande; escena 3 "Simply adding an accessibility plug-in isn't a fix. It can trigger a lawsuit."; escena 4 "Document it." en vez de "Prove it."; guardarraíles 2, 3, 5 reescritos y el 6 con saltos de línea; escena 6 con lede sobre lectores de pantalla, buscadores y agentes y cuatro datos que sí sostienen el titular (54.5 % sin alt, 73 % / +12 %, +23 %, 26 % CDC) en vez de los contadores del motor; escena 7 Growth 11–50 SKUs y Enterprise 50+; escena 8 "Top eight ADA lawsuits by state and by industry." con leyendas "Most active lawsuits by state / by industry"; nueva escena 11 teaser "Accessrank for Libraries" con datos de criercomm.github.io/accessrankforlibraries (96 % WebAIM, Title II 2027/2028, 26 % CDC, planes Branch/System/Metropolitan, plataformas) y un catálogo dibujado en código; contacto pasa a escena 12. Se dejaron fuera del teaser el "+34 % catalog use", los "21 days" y el testimonio de esa página por no ser verificables. Créditos totales 3.160.

**V3.1 · 2026-09-15 (contacto real, pedido de Carlos):** escena 12 con los dos contactos: Co-founder and CEO · jp@accessrank.ai · +1 310 408 1881 y Co-founder and CTO · carlos@accessrank.ai · +51 958 967 616. Sin nombres en pantalla (regla vigente): el cargo ocupa el titular de cada tarjeta. Teléfonos en un solo formato internacional (E.123) y enlazados con `tel:` (E.164); emails con `mailto:`. Queda el placeholder `[City, State]`. Destinos: **accessrank.ai/deck/ (Fly) es el oficial y el único que importa (Carlos, 2026-09-15: "should be in accessrank.ai/deck, not in eureka")**; copia GitHub→Vercel publicada (commit b184259). El `flyctl deploy` lo bloquea el clasificador de auto mode; Carlos lo ejecutó a mano: **release v14 en vivo en accessrank.ai/deck/** (verificado por HTTP y captura de la escena 12). eureka.pe deja de ser destino; esa copia quedó en V3 y el hosting devolvió "Disk quota exceeded" (ni put ni rm). Si se reutiliza `deploy-missing.ps1` en otro deck: compara por tamaño y un `index.html` del mismo peso (solo cambian los hashes) no se vuelve a subir; subirlo al final.

Decisiones tomadas sin esperar (revertibles): D1 amarillo + azul de segunda línea como el sitio · D2 recreación estilizada del producto (tienda ficticia "Northline Goods") · cursor custom encendido y chrome completo (puntos de capítulo) · cama musical con Lyria en vez de Suno · siluetas aceptadas con halo de rim light (QA revisado a 200 %).

---

## 0. Lo que este deck tiene que lograr (y lo que sabemos del cuarto)

- **Quién escucha.** Dallas es un ecosistema de capital corporativo, family offices y PE, más que de venture institucional: gente pragmática, orientada a ingresos y a riesgo concreto, no a visión abstracta. DFW es además la mayor concentración de sedes de retail del país (Neiman Marcus, JCPenney, Fossil, Michaels, GameStop, Sally Beauty, At Home…). **Texas es el 4.º estado con más demandas ADA por sitios web.** El deck habla de dólares, riesgo y ejecución, no de "IA".
- **Qué vende.** AccessRank no es un widget: escanea, **arregla el código real** (en borrador, con aprobación humana), **re-escanea hasta 0 problemas** y deja **prueba defendible** con rollback de un clic. Ese ciclo es el diferencial y el efecto WOW.
- **Regla de oro:** nada que el doc de capacidades §13 prohíba. Alpha funcional; servicio operado; sin billing en código (los precios del sitio son la oferta comercial, se muestran como tal); coberturas son estimaciones; solo WCAG 2.2 AA; sin garantías legales.
- **Espina (propuesta):** *"Widgets hide the problem. AccessRank fixes the code — and proves it."* Versión corta para el título: **FIX THE CODE. PROVE IT.**

## 1. Diseño heredado de accessrank.ai

| Token | Valor | Origen |
|---|---|---|
| `--bg` | `#14142A` | fondo del sitio |
| `--surface` | `#101838` · `--surface-2 #0C1330` | tarjetas de estadísticas |
| `--fg` | `#FFFFFF` · soft `#D4D0C5` · muted `#B5B0A4` | texto |
| `--accent` | `#FFD23F` (amarillo marca) | CTAs, cifras, eyebrows |
| `--signal` | `#3B82F6` (azul) | **solo** glow de fondo y segunda línea de titulares, como en el sitio |
| `--aurora` | `#7C3AED` @ .42 | resplandor radial violeta/azul detrás del hero |
| estados | ok `#4ADE80` · warn `#FB923C` · bad `#F87171` | anillo de score del sitio |
| Display / datos | **Inter** (variable, 300→800 para KineticType) / **JetBrains Mono** | las dos del sitio; cumple "máximo 2" |

Marca solo en texto ("Accessrank" + el check en cuadrado amarillo dibujado en CSS, sin importar el logo). Grano .05. Cursor custom con lag (sí, a diferencia del deck Miami: aquí es un producto de software y el cursor forma parte del lenguaje).

**Decisión D1 (Carlos):** la regla de casa es UN acento. Propuesta: amarillo es el acento; el azul queda como glow y como color de segunda línea de titular, igual que en el sitio. Si quiere purismo, el azul se va y todo es amarillo.

### STYLE-LOCK R (sufijo fijo de TODO prompt)
```
dark studio product photography, deep navy seamless background, single cool key light from top-left, warm amber rim light, 85mm lens, matte surfaces, subtle floor reflection, clean silhouette edges for cut-out
```
Negativos globales: `no logos, no text, no watermark, no visible faces, no brand names, no screens with UI`.
Silhouettes: `seen from behind, backlit, no visible face`. Productos: diseños originales de una marca DTC ficticia ("Northline Goods"), nunca recreaciones.

## 2. Estructura: 10 escenas (~8–10 min) + ruta corta

Ruta corta `?short=1` (3 min): 01 → 02 → 04 → 07 → 10. El presenter view marca cuáles saltar.

| # | Escena | Plantilla | Qué se ve | Copy (borrador EN) | Motion / efecto |
|---|---|---|---|---|---|
| 01 | **Cover** | T-Cover | Aurora respirando; 6–8 productos DTC (cut-outs) flotando en parallax; título 200 px | `FIX THE CODE. PROVE IT.` / sub `Accessrank · Accessibility remediation for ecommerce, with proof.` / `Dallas · September 2026 · JP Lincoln` | KineticType por letra; Stagger productos; cama entra al primer avance |
| 02 | **The letter** (problema) | T-Statement | Un sobre de demanda (cut-out) cae y aterriza con sombra; 4 flap-digits | `Every online store in America is one envelope away from a $30,000 problem.` · `5,114` lawsuits in 2025 · `~6,176` on pace for 2026 (+20%) · `79%` hit ecommerce · `#4` Texas among states | Drop con out-back micro + `thud`; clacks en cascada; fuente en pie: UsableNet 2025 year-end / 2026 midyear |
| 03 | **The widget lie** (why now) | T-Signature (menor) | Pared de 400 mini "badges" de widget que se arma (semilla fija) y luego se apaga en gris | `The industry sold a sticker. The courts stopped accepting it.` · `38.5%` of sued businesses already had an accessibility widget installed · `$1M` FTC fine against accessiBe (2025) · `EAA` in force in the EU since June 2025 | Pared que se arma (patrón Deck A, 400 tiles CSS, sin imágenes) → crossfade a UNA frase; 36 ticks |
| 04 | **The store that fixes itself** · EFECTO FIRMA | T-Signature | Tienda "Northline Goods" dibujada en código con los cut-outs de S01; barrido de escáner; marcadores rojos; panel de diff real; re-escaneo; anillo de score | `Scan. Fix in the code. Re-scan. Prove it. Undo in one click.` · contador `47 → 0 remaining` · score `41 → 96` · botón `Rollback` | Ver §3. Cuatro avances internos: scan → findings → fix (diff tipeado) → validate. Hover en Rollback revierte todo en t-3 y vuelve |
| 05 | **Safe enough for a live store** (confianza/moat) | T-Scene | Riel de 6 hotspots; una "tarjeta de evidencia" con regla, criterio WCAG, selector, ratio de contraste medido, captura con el elemento resaltado, grado `behavior_verified` | `Safe enough for a live store. Documented enough for a lawyer.` · hotspots: `Draft, never live` · `Approval per change` · `Write verified` · `0 remaining` · `Evidence pack` · `One-click rollback` | Hover 1.04 + label; cada hotspot ilumina la parte del flujo; tarjeta con Stagger |
| 06 | **One engine, four standards** (amplitud) | T-Proof | 2×2 flap-digits + franja de plataformas | `The same structural fixes that beat the lawsuit raise the rankings.` · `35` detectors · `114` signals · `35` remediators · `55` WCAG 2.2 AA criteria live · franja: `Accessibility · Core Web Vitals · SEO / AI search · Security` · `Shopify (deep) · WordPress · GitHub · Bitbucket · Cloudflare` | Clacks; franja Stagger; nota al pie: Semrush 847-site study, +23% organic traffic (tercero, citado como tal) |
| 07 | **Pay for results, not promises** (modelo) | T-Proof | 3 tarjetas de precio del sitio + carril express; una línea de "hoy → siguiente" | `Starter $1,500 + $79/mo` · `Growth $3,500 + $249/mo` · `Enterprise custom` · `Lawsuit response from $5,900, 7 days` · `Today: operated service. Next: self-serve + agencies.` | Flap-digits en precios; tarjeta Growth con keyline amarillo (como el sitio). Transparente: billing automatizado = roadmap |
| 08 | **Start where the lawsuits are** (mercado / Dallas) | T-Statement | Skyline de Dallas al anochecer (plate, sin logos) con parallax; mapa de cuña → expansión | `Start where the lawsuits are. Expand where the code is.` · `Shopify → WordPress → code repos` · `Accessibility → performance → search → security` · `DFW: the largest retail HQ cluster in the U.S.` | KineticType; líneas de expansión dibujadas (stroke-dashoffset); cifra Texas #4 |
| 09 | **Real, today** (tracción + equipo) | T-Proof | 2×2 flap-digits (tracción, **datos de JP**) + tres bloques de equipo sin fotos | `Functional alpha, end to end.` · `[sites audited]` · `[findings fixed]` · `[paying customers / pipeline]` · `[revenue]` · engineering: `~120k lines` · `~1,200 tests` · `149 test files` · team: JP Lincoln (rol), Carlos Marruffo (rol), engineering | Placeholders marcados `illustrative` hasta recibir cifras reales; nunca se presenta con placeholders |
| 10 | **The ask** | T-Close | Título + uso de fondos como 4 barras que se llenan + footer | `We are raising $[X] to take Accessrank from operated alpha to general availability.` · uso: `Cloud + sandbox for GA` · `Mobile performance + field data` · `Integrations + billing` · `Team` · cierre: `FIX THE CODE. PROVE IT.` · `jp@… · accessrank.ai` | Barras t-5; título vuelve; el escáner de S04 corre al fondo al 15 % |

Footer en toda slide: `Accessrank · Investor presentation · September 2026 · Not legal advice · Statistics cited from third-party sources · Confidential`.

## 3. Efecto firma · "The store that fixes itself" (S04)

Todo en código (HTML/CSS/canvas); las únicas imágenes son los cut-outs de producto. Es el momento "¿cuánto tiempo les tomó esto?".

1. **La tienda.** Un storefront de "Northline Goods" a pantalla completa, con navegación, grilla de 6 productos (cut-outs con sombra), precio, botón de carrito, un modal de tallas. Fiel a un tema Shopify genérico; sin marca real.
2. **Scan (avance 1).** Un haz (Streaks horizontal, color `--signal`) barre de arriba abajo en t-6. A su paso, aparecen marcadores rojos numerados sobre los fallos reales que el producto detecta: `Missing alt`, `Contrast 2.9:1`, `Cart update not announced`, `Focus trap in modal`, `Unlabeled form field`, `Sale price by color only`, `Tap target 28px`. FlapDigits `0 → 47 findings` en cascada; tick por marcador. Anillo de score dibuja `41` en rojo (estilo `score-ring` del sitio).
3. **Findings (avance 2).** La tienda se desplaza a la izquierda (in-out-quart); a la derecha entra la tarjeta de un hallazgo con evidencia (selector, HTML que falla, ratio medido, captura con highlight, grado `behavior_verified`). Etiqueta `Draft theme · never the live theme`.
4. **Fix (avance 3).** La tarjeta cambia a un **diff real** de Liquid/HTML (líneas rojas → verdes, tipeado a 24 ms/char con cursor mono), con `Approve` que se pulsa solo. Cada marcador rojo de la tienda pasa a amarillo (`approved`) en secuencia, 60 ms.
5. **Validate (avance 4).** El haz barre otra vez; cada marcador pasa a verde y se disuelve; FlapDigits `47 → 0 remaining`; anillo `41 → 96` en amarillo. Aparece el botón `Rollback`: en hover, todo vuelve al estado rojo en t-3 y regresa al soltar (demuestra que el rollback existe sin decir una palabra). Copy entra con KineticType.

Sonido: ticks en el barrido (máx. 8/s), 3 clacks, `whoosh` en el diff, un `chime-soft` al llegar a 0. Móvil: 4 productos, 5 marcadores. Reduced-motion: estado final con 0 remaining.

**Decisión D2 (Carlos):** capturas reales del producto. Si Carlos entrega 6–10 capturas (lista de hallazgos, visor de diff, validación, pestaña Changes & rollback, PDF), S05 muestra el producto real en un flipbook (más convincente para due diligence). Si no, S04/S05 son recreaciones estilizadas etiquetadas `product view, stylized` en las notas.

## 4. Assets (estimación ≈ 1.800–2.600 créditos; muy por debajo del techo)

| Grupo | Cant. | Prompt (sujeto) + STYLE-LOCK R | Uso |
|---|---|---|---|
| product | 8 (2 hojas de 4 + candidatos) | `a {running sneaker / skincare bottle / ceramic candle / over-ear headphones / folded knit sweater / leather wallet / water bottle / desk lamp}, original design, no brand` | S01, S04 |
| letter | 1 (+1 candidato) | `a closed cream envelope with a red wax seal and a folded legal letter, isolated` | S02 |
| silhouette | 3 (hoja de 3) | `a person seen from behind using a laptop at a desk / holding a phone / in a wheelchair at a desk, backlit` | S05, S08 textura |
| plate | 1 (+1) | `Dallas skyline at dusk, wide, no signage, cinematic, 24mm` | S08 |
| audio | 1 cama + SFX | cama: `quiet confident electronic pulse, warm pads, 96 bpm, instrumental, narrow stereo` (Magnific `audio_music_generate` o Suno); SFX Freesound CC0 | SoundBus |

Pipeline: 2 candidatos por asset → curaduría → `cutout-factory` (QA de bordes + sombra) → AVIF/WebP → fila en `manifest.json`. Nada entra sin fila. Todo cut-out con sombra de contacto.

## 5. Lo que necesito de Carlos / JP antes del gate (en orden)

1. **La ronda:** monto, instrumento (SAFE / pre-seed / seed), uso de fondos en 4 partidas, hitos a 12–18 meses. Sin esto S10 sale con `$[X]`.
2. **Tracción real:** sitios auditados, hallazgos arreglados, clientes que pagan o pipeline, ingresos, pilotos. Sin esto S09 sale marcada `illustrative` y JP **no debe presentarla** hasta reemplazarla.
3. **Equipo:** rol y una línea de bio de JP; rol de Carlos; tamaño de ingeniería; asesores.
4. **Capturas reales del producto** (D2) o luz verde para recrear estilizado.
5. **Formato:** minutos disponibles, proyector o laptop, si hay demo en vivo (recomiendo NO: el efecto firma es la demo). Si es pitch de 5 min, se usa `?short=1`.
6. **D1:** amarillo único o amarillo + azul de segunda línea.
7. Contacto que va en el cierre (email de JP) y si el deck se publica en `eureka.pe/decks/accessrank/` privado con `noindex`.

## 6. Plan de producción (tardes)

| Día | Qué | Gate |
|---|---|---|
| 1 | Scaffold (copia del patrón deck-miami), tokens, tipografía, 10 escenas con placeholders, presenter view, `?short=1` | navegación y chrome |
| 2 | Efecto firma S04 completo en código; S02 y S03 | "¿cuánto tiempo les tomó?" |
| 3 | Assets (Magnific → cutout-factory → manifest); S01, S05, S06, S08 | style-lock, sombras, QA |
| 4 | S07, S09, S10 con datos reales; sonido; checklist completa; medición (fps, KB, consola); pase de teléfono | checklist + gate de Carlos |
| 5 | PRESENTER.md + PDF para JP (qué decir, clicks por escena, respuestas a preguntas duras); deploy privado | JP ensaya |

## 7. Preguntas duras que JP va a recibir (para PRESENTER.md)

- *"¿Esto es un widget?"* No: modifica el tema/código real; el overlay existe solo como último recurso y el catálogo prohíbe usarlo para fingir arreglos.
- *"¿Qué pasa si rompen la tienda?"* Nunca escribe en el tema publicado; borrador → aprobación por cambio → verificación de escritura → validación con 0 restantes → publicación explícita → rollback de un clic.
- *"¿Cuánto cubren automáticamente?"* Estimación de ingeniería, no métrica medida: alrededor de la mitad de WCAG 2.2 AA es detectable y cerca de un tercio arreglable con acceso al repo. Lo que necesita personas se convierte en ticket con checklist.
- *"¿Es SaaS?"* Hoy servicio operado con portal de cliente; el billing self-serve es parte del uso de fondos.
- *"¿Garantizan que no los demanden?"* No, y nadie honesto lo hace. Entregan evidencia defendible y un paquete de prueba para abogados.
- *"¿Por qué ustedes?"* Profundidad en Shopify + motor único para accesibilidad, rendimiento, búsqueda con IA y seguridad, con ~1.200 tests y evidencia por hallazgo.

## 8. Fuentes de las cifras (verificar antes del gate)

- UsableNet 2025 year-end report: 5,114 demandas en 2025; 70 % ecommerce (año completo). UsableNet 2026 midyear: ritmo de ~6,176 en 2026 (+~20 %), 79 % ecommerce, ~1,400 demandados en 2025 tenían widget.
- AudioEye 2026: 38.5 % de los demandados ya tenían una "solución" de accesibilidad instalada.
- ADA Title III blog (Seyfarth) 2026: demandas federales por sitios web +27 % en 2025 (3,117).
- Texas 4.º estado (224 demandas web en 2024, fuente secundaria; verificar en UsableNet). Promedio de acuerdo en Texas $52K citado por adaquickscan.com: **fuente débil, no usar sin confirmar**.
- FTC vs. accessiBe, multa de $1M (2025). WebAIM Million 2025: 95.9 % fallan WCAG. CDC: 1 de cada 4 adultos en EE. UU. con discapacidad. Semrush 847 sitios: +23 % tráfico orgánico (estudio de tercero citado en accessrank.ai).
- Cifras de producto: `../AccessRank-capacidades.md` (35 detectores, 114 señales, 35 remediadores, 55 criterios activos, ~1,200 tests, ~99k + ~53k líneas).

## 9. Checklist de detalle (deck-motion) · estado 2026-09-14

- [x] Cursor custom con lag y estado hover (lib `Cursor`, crece en hotspots, botones y Rollback)
- [x] Toda cifra en flap-digits (tiles S02/S03/S06/S09, precios S07, contador y score S04, porcentajes S10, contador NN/10)
- [x] Títulos con animación por letra (`heading()` → `KineticType` per char, peso 300→800, 2.ª línea azul/amarilla)
- [x] Toda transición con sonido (whoosh de la lib) · ticks en barridos, pared y riel · clacks en flaps · blip en aprobaciones · braam suave al caer el sobre
- [x] Sombra de contacto bajo cada cut-out (horneada por cutout-factory; 12 cut-outs, QA pass/review, 2 halos de rim light aceptados a 200 %)
- [x] Grilla 8 pt en layout (márgenes 64/24, gutters 24/16, paddings 24/16/8); micro-elementos de la tienda ficticia usan 4/6 px por escala
- [x] Máximo 2 tipografías (Inter + JetBrains Mono), 1 acento (amarillo; azul solo como color de 2.ª línea y aurora, decisión D1)
- [x] Coreografía de carga: nada aparece sin entrada (Stagger/KineticType en cada escena, chrome con Stagger de la lib)
- [x] Marcadores de capítulo (10 puntos) + contador `NN / 10` en flap
- [x] Hover en hotspots: escala 1.04 + label (S05 riel; S06 estándares; S07 planes)
- [x] Grano fílmico .05
- [x] `prefers-reduced-motion`: entradas instantáneas (lib), pared ensamblada, barrido sin animación, diff completo, barras y líneas en estado final, aurora quieta
- [x] Footer legal diseñado (mono, fuentes citadas, "Not legal advice", degradado en móvil)
- [x] Manifest completo (17 filas: 14 final, 3 hojas fuente) · créditos 1.160 / 10.000 · balance inicial 23.035
- [x] Métricas: bundle 157 KB JS (58 KB gz) + 37 KB CSS (9 KB gz) + 88 KB fuentes · ruta crítica S01 ≈ 350 KB (≤ 600 KB) · total dist 3 MB (≤ 4 MB) · consola limpia en las 10 escenas (Chrome headless) · puerta de sonido verificada (`check-gate.mjs`) · fps no medido en dispositivo: pase de teléfono pendiente de Carlos

Gate de Carlos pendiente: ¿la espina se entiende sola? · ¿S04 provoca "¿cuánto tiempo les tomó?"? · checklist ↑ · pase de teléfono.

## 10. V3.2 · Responsive (2026-09-16)

Pedido de Carlos: deck responsive, footer mucho más pequeño o autooculto en móvil, navegación secundaria abajo.

- **Modo compacto** (`src/style.css`): entra por ancho ≤767 px, **alto ≤620 px** o viewport más alto que ancho. El disparador de alto es el que faltaba: un teléfono apaisado mide 812 × 310 y, siendo más ancho que el corte de 767, recibía la composición de escritorio (bloques absolutos contra un escenario 16:9) apilada sobre sí misma. En compacto todo vuelve al flujo y la escena scrollea.
- **S11 (Libraries) y S12 (Contact) no tenían reglas móviles**: el bloque reseteaba `.s11-cards`, una clase que no existe, así que la ficha del catálogo (`.lib`) y el riel inferior seguían absolutos sobre el copy; en S12 el footer era el único bloque en flujo y subía sobre el título. Las dos escenas llegaron en V3, después de escribirse el bloque móvil.
- **Footer**: en compacto el footer legal de la lib se oculta y su texto reaparece como una línea de 9,5 px dentro de la barra inferior (2 líneas en vertical, 1 en apaisado). La barra entera mide 94 px en vertical y 80 en apaisado, frente a los ~100 px que ocupaba solo el footer.
- **Barra inferior** (`src/components/navbar.js`): anterior · 12 puntos de capítulo · siguiente, con el punto activo como píldora amarilla. `aria-current` en el punto actual, flechas de 40 px (34 por debajo de 400 px de ancho), separación entre puntos 24,5 px (mínimo 24 de la WCAG 2.5.8) y foco visible. Oculta en escritorio, donde sigue mandando el chrome de arriba.
- **`lib/deck.js`**: una escena que scrollea se queda con el gesto vertical (rueda y swipe arriba/abajo); antes cualquier arrastre vertical >64 px cambiaba de escena mientras el contenido scrolleaba. El guard exige `overflow-y: auto|scroll` real, así que en escritorio (`overflow: hidden`) la rueda sigue pasando escenas.
- **QA** (`node scripts/responsive-check.mjs`, nuevo): 390×660, 812×310, 768×1024 y 1440×900 — barra visible y navegable (flecha → escena 2, punto 7 → escena 7), 12 puntos, separación 24,5 px, footer de escritorio oculto, escena con `overflow-y: auto`; en escritorio barra oculta, footer visible, 12 puntos de capítulo y `overflow: hidden`. Consola sin errores, también contra el build. Capturas en `refs/review/resp-before|after|nav|dist|live`.
- **Publicado**: Fly release **v15** → https://www.accessrank.ai/deck/ (bundle `index-CH1zusze.js` + `style-DiFxd_nU.css`); GitHub `cc690c1` → https://accessrank-rust.vercel.app/deck/. Raíz del sitio intacta (home, `/about` y `/api/health` en 200, `env: staging` como estaba). Esta vez `flyctl deploy` sí corrió desde la sesión, sin bloqueo del clasificador.
- Sin generaciones: 0 créditos de Magnific en esta sesión.
- Pendiente: pase de teléfono real de Carlos (el checklist de deck-motion lo exige; aquí solo hay Chrome headless) y decidir si la barra inferior sube a `lib/` para el resto de decks.

## 11. V3.3 · Correcciones de Carlos tras verlo en su iPhone (2026-09-16)

- **Imágenes y audio rotos "en móvil".** La causa no era el móvil sino la URL: `https://www.accessrank.ai/deck` (sin barra final) responde 200 sin redirigir, y las rutas del manifest son relativas (`assets/final/…`, `assets/audio/…`), así que el navegador las pedía en `/assets/…` → 404. Reproducido en headless contra v15: S01 1/1 imágenes rotas, S04 4/4, **41 peticiones de media fallidas** (el audio también); con barra final, 0. En la copia de Vercel, construida con base relativa, a `/deck` le fallaban hasta el JS y las fuentes: página en blanco. Las "líneas raras" de S04 eran esas `<img>` rotas dibujadas como cajas de alt text.
  - Arreglo: `lib/assets.js` une el prefijo del despliegue a las rutas relativas (sin `base` no cambia nada para los otros decks); `main.js` pasa `import.meta.env.BASE_URL` a `createAssets` y al audio. **Un solo build `DECK_BASE=/deck/` para Fly y Vercel** (el relativo existía por eureka.pe).
  - QA nueva `scripts/image-check.mjs`: falla si el deck no arranca, si un `<img>` no carga o si alguna petición da error; `--serve dist --prefix /deck` sirve el artefacto como Fly (con y sin barra) antes de publicar; `--shot` guarda la captura de la URL exacta.
- **S05 sin *One-click rollback*** (las pymes no hacen la remediación). *Evidence pack*: "Each finding comes with the rule, the WCAG criterion, the selector and the measurements. Before-and-after screenshots show what was fixed and why — remediation evidence that can help support a legal defense." (redacción de Carlos; la cautela "can help support" se mantiene por las reglas de honestidad). Ese texto más largo pisaba la silueta de Shopper a 1280×720: caja de 760 px en un solo párrafo (3 líneas), el JS centra con su ancho real y, en pantallas de 621–820 px de alto, siluetas de 120 px. Medido: 19 px de holgura a 1280×720, 0 choques, dentro del riel de 1280 a 1920.
- **S04:** titular "Document it. Prove it." (antes "Undo in one click."). El botón Rollback y su demo se quedan, presentados como red de seguridad del operador (notas de S04 y PRESENTER.md, que pasa a versión 3; también se quitó el enlace de respaldo a eureka.pe, que seguía en V3).
- **Solapes de escritorio** (S02, S06, S09, S11): los bloques de izquierda y derecha sumaban 92 % + 128 px de márgenes. Medido antes: S09 −13 px a 1440, −26 a 1280, −46 a 1024 (9 fallos). Ahora se reparten `--span` (viewport − 2 márgenes − 1 gutter): 24 px exactos de 1024 a 1920.
- **S12:** fuera `[City, State]`.
- **Publicado:** Fly **v16** y GitHub `ab11b98` (Vercel: success). En producción, `image-check` con y sin barra en los dos hosts: todo arranca y carga; `responsive-check` contra producción: TODO OK. Raíz del sitio intacta.
- **Pendiente:** `AccessRank-capacidades.md` no documenta las capturas antes/después: confirmar con Carlos que el producto las genera hoy (si es roadmap, reformular S05).

## 12. V3.4 · Contraseña en todo el sitio y S10 con el plan real (2026-09-16)

- **GA** = *general availability* (lanzamiento general). Estaba abreviado en la primera barra de fondos y en el primer hito; ahora va escrito ("Infrastructure for general availability…").
- **S10 · uso de fondos.** El reparto de 4 barras era ilustrativo y no tenía marketing. Carlos pasó el plan real (8 líneas que suman exactamente $600K) y eligió agruparlo en 5 cubetas con el detalle debajo: Product and infrastructure 36 % · $216K (cloud y sandbox 16 · mobile field data 11 · integraciones y billing 9) · Team 22 % · $132K · Go-to-market 18 % · $108K (marketing y conferencias + apoyo en especie de CrierPR.com: contenido, posicionamiento, prensa) · Company and legal 17 % · $102K (legal y constitución 10 · seguros, herramientas y oficina 7) · Working capital and contingency 7 % · $42K. La nota al pie de CrierPR pasó a la línea de detalle de Go-to-market. Titular: "Raising $600K for the next 18 months." Los trimestres de hitos siguen siendo ilustrativos.
  - Diseño (skill dataviz): una medida partida en partes de 100 % → un solo tono (el acento), ordenado por tamaño, cada valor como texto junto a su barra (la barra es decoración, `aria-hidden`), lista semántica. Sin tooltips a propósito: todos los valores están en pantalla y es una presentación.
  - El cierre "FIXING THE WEB'S BIGGEST BLIND SPOT." va en una sola línea en escritorio para que las 5 cubetas quepan a 1280×720 (medido: 12 px de aire con el cierre; 56 a 1366×768, 138 a 1440×900). En móvil sigue en dos líneas. Nueva comprobación en `responsive-check.mjs`.
  - "7%" con `digits: 3` dibujaba una ficha vacía delante: fuera el relleno.
- **Contraseña en todo accessrank.ai** (pedido explícito de Carlos; el código y el contenido del sitio siguen sin tocarse): `C:/Developer/accessrank-fly-deck/gate/gate.mjs`, una puerta Node sin dependencias delante de la app en el mismo contenedor (escucha en 3000 y arranca el CMD original en 3001). Contraseña en el secreto de Fly `SITE_PASSWORD` (y en `dont upload.txt`, `ACCESSRANK_SITE_PASSWORD`, para la QA); cookie firmada de 30 días; `/api/health` abierto para los health checks; 10 fallos por IP → 429; página de acceso propia, accesible y con `noindex`. Probada en local con `scripts/gate-test.mjs` (27 comprobaciones, incluido el recorrido en Chrome) y en producción: sin contraseña todo da 401 salvo el health (el JS del deck devuelve 18 bytes); con contraseña, home, `/about` y `/deck/` en 200. La copia de Vercel queda pública por decisión de Carlos.
  - Las pruebas contra producción (`image-check`, `responsive-check`, `shots`) cruzan la puerta con `GATE_PASSWORD` en el entorno.
  - A vigilar: el sitio saldrá de Google con el tiempo; el embudo de auditoría gratuita solo lo ve quien tenga la contraseña; cualquier llamada a la API desde fuera de un navegador (hay un `ADMIN_TOKEN` entre los secretos) recibe 401.
- **Publicado:** Fly **v17** y GitHub `6e54002` (Vercel: success). QA en producción a través de la puerta: `image-check` con y sin barra, todo cargó; `responsive-check`, TODO OK.
- PRESENTER.md (y su PDF): el enlace avisa de la contraseña sin escribirla, la ronda es $600K, guion nuevo de S10 y qué hacer si aparece la página de acceso.
- Carlos tiene recursos sobre cómo presentar a VCs: pedirlos antes de volver a tocar S10.

## 12b. V3.5 · Solo efectos de sonido (2026-09-18)

- **Pedido de Carlos:** sin la opción de sonido; solo efectos, sin cama musical.
- **Fuera la puerta de entrada** ("Enter with sound / Enter in silence"): el deck abre directo en la escena 1. `index.html` sin la puerta; `src/main.js` crea el deck al cargar; las reglas `.gate` salieron de `style.css`.
- **Sin cama:** `audio.bed: false` en `manifest.json` y en `main.js`; la fila `dR-bed` queda `retired` y el archivo pasa a `assets/source/audio/dr-bed.opus`, fuera del bundle (1,1 MB menos por visita).
- **Efectos:** los navegadores solo dejan sonar audio tras un gesto, así que despiertan con el primer clic, tecla o toque (`SoundBus.start()` en el primer gesto). La portada entra en silencio; desde el primer avance suena todo. El interruptor "Sound on / off" de la esquina y la tecla M siguen para salas sin parlantes.
- **Visitantes antiguos:** quien eligió "Enter in silence" antes tenía la cookie `deck_mute=1`. La primera visita a V3.5 la borra una sola vez (marca `ar-sfx-only` en `localStorage`); después, el interruptor vuelve a recordar la elección.
- **QA:** `scripts/check-sound.mjs` (nuevo; reemplaza a `check-gate.mjs`, retirado a `assets/source/`) comprueba que no hay puerta, que tras el primer clic cargan los 10 efectos, que la cama no se pide y que la cookie antigua se borra. Local y producción: TODO OK. `responsive-check` TODO OK; `image-check` del artefacto y de producción, con y sin barra final: todo cargó.
- **PRESENTER.md** y su PDF: paso 3 sin la puerta; "No sound" y "browser chrome" sin la elección de sonido.
- **Publicado:** Fly **v18**; GitHub `c6b6cfa` (+ commits vacíos `f11cb20` y `ca06c00` para volver a disparar). Vercel no creó ningún despliegue: incidencia suya "Elevated Errors Triggering Deployments" (resuelta 21:22 UTC del 2026-09-18) y, ya resuelta, tampoco reaccionó al push de `ca06c00`. Diagnóstico (21:53 UTC): la integración con GitHub funciona; Vercel creó los tres despliegues al resolver la primera incidencia (21:28 y 21:43 UTC), pero `f11cb20` quedó atascado en Initializing por una segunda incidencia ("Deployment stuck in initializing state", abierta 21:36 UTC) y `ca06c00` y `c6b6cfa` esperan en cola detrás. Los tres llevan el mismo deck. El proyecto es `vercel.com/accessrank/accessrank`, visible por CLI con `--scope accessrank` (cuenta hello-40633109). **Resuelto:** Vercel cerró la incidencia a las 22:31 UTC; `f11cb20` y `c6b6cfa` desplegaron (success) y `ca06c00` se canceló desde el panel (su estado en GitHub dice failure, sin efecto). La copia pública sirve `index-Dp5iFrMu.js`; `check-sound` TODO OK e `image-check` con y sin barra: todo cargó.

## 13. Pendientes al cierre (2026-09-16)

1. **Recursos de Carlos para presentar a VCs** → revisar S10 y el arco del deck con ellos.
2. **Capturas antes/después** (S05, *Evidence pack*): confirmar que el producto las genera hoy y añadirlas a `AccessRank-capacidades.md`; si es roadmap, reformular S05.
3. Tracción `TBD` ×4 (S09) y trimestres de hitos (S10, ilustrativos): los rellena JP/Carlos.
4. Pase de teléfono real de Carlos sobre V3.4.
5. Titular de S04 "Document it. Prove it." (redacción de Claude): confirmar o cambiar.
6. Decidir si la barra inferior (`src/components/navbar.js`) sube a `lib/` para el resto de decks.
7. Contraseña en todo el dominio: vigilar SEO, embudo de auditoría y llamadas externas a la API; `NODE_ENV` sigue en `staging` aunque `/api/health` ya reporta `database: true`.

Estado de publicación (2026-09-18): Fly v18 (`https://www.accessrank.ai/deck/`, con contraseña) y GitHub `c6b6cfa` (`https://accessrank-rust.vercel.app/deck/`, pública; ver §12b por el despliegue de Vercel). Nada sin commitear; ningún servidor local corriendo. QA: `scripts/responsive-check.mjs`, `scripts/image-check.mjs`, `scripts/gate-test.mjs`, `scripts/shots.mjs` (contra producción, con `GATE_PASSWORD`).

## 14. S02 · el escaneo no cabía en la banda de contenido (2026-09-21) — publicado en V3.6 (2026-09-23)

Carlos vio el complaint de S02 pisando la zona del pie. Causa: el escaneo se dimensionaba por ancho (`width: 100 %`) y la
página mide 1714 × 2218, así que en ventanas anchas y bajas su alto se salía de la banda. Medido a 1920 × 900: caja del
escaneo 95 → 955 px contra una banda de 88 → 812 y una regla de pie en 827 — 143 px de desbordamiento.

Dos cosas tenían que cambiar, y la segunda es la que no se ve:
- `lib/assets.js` → `img()` envuelve la imagen en un **`<picture>`** (es también el elemento que anima la línea de tiempo),
  así que un `max-height` en porcentaje sobre el `<img>` se resuelve contra un padre de alto automático y el navegador lo
  ignora. Con él ignorado y `width: auto`, el `<img>` cae a su tamaño intrínseco: 150 px de ancho en un teléfono.
- Solución en `src/style.css`: el `<picture>` llena la banda menos 20 px de padding arriba y abajo (absorben la
  inclinación de −2,5° en reposo, ≈ 12 px por esquina, más el parallax) y el `<img>` se encaja con `object-fit: contain`.

Medido en reposo, con la inclinación aplicada: 1920×900 escaneo 529×684 (holgura 9/8 px, 23 px sobre la regla del pie,
119 px de las cubetas) · 1600×900 igual (48 px de las cubetas) · 1280×720 389×504 (12/12 px) · 500×844 apilado 386×500
(12/12 px, 20 px sobre la barra inferior). La entrada sigue igual (sube desde +274 px y asienta en −2,5°).
`node scripts/responsive-check.mjs` → TODO OK, consola sin errores. Ninguna otra lámina tenía el patrón sin tope
(`.s01-mock img` y `.s05-person img` ya llevan `max-height`; `.s02-env` es el sobre oculto).

**Estado: `dist/` reconstruido con `DECK_BASE=/deck/` y verificado, pero NO desplegado.** Fly sigue en v18 y Vercel en
`ca06c00`. Para publicar, pasos 2–5 del runbook.

(Nota 2026-09-23: la sección 14 se publicó con V3.6, Fly v24 y Vercel `75e07f8`.)

## 15. V3.6 · Cifras de discapacidad y WCAG actualizadas; S06 en ventanas bajas (2026-09-23) — PUBLICADO

Carlos pidió incluir tres cifras con la fuente del CDC. Verificadas contra cada fuente antes de tocar nada:
- "1 in 5 adults (70M+)" → el comunicado del CDC (2024-07-16, datos BRFSS 2022) dice **"more than 1 in 4 — over 70 million"**. Se usa esa.
- "27% abandon purchases" → no es del CDC: es la encuesta de **Fable** (makeitfable.com, "Insights: the state of online
  shopping for people with disabilities"): 27 % abandona una compra **al menos una vez al mes** por barreras de accesibilidad
  (8 % cada semana). Panel propio de Fable, no muestra nacional.
- "95.9%" → **WebAIM Million 2026** (subió desde 94,8 % en 2025).

Cambios: S01 fuente → WebAIM Million 2026 (el "95 %" del sub se queda). S05 Shopper → "More than 1 in 4 U.S. adults (70M+)".
S06: tile "26 % … shop with assistive technology · CDC" (el CDC no dice lo de la tecnología asistiva) → "70M+ · CDC, 2024
(2022 data)"; tile "+23 % Semrush 2025" (repetía la de 73 %) → "27 % · Fable survey". S11: tile 26 % → la misma del CDC 2024.
Notas de S06 y PRESENTER.md (tabla y dos respuestas de "What is true") al día; PDF regenerado.

S06 en escritorio bajo (arrastrado, no causado por las cifras): la rejilla estaba clavada a `top: 46 %` y el lede de 4 líneas
la invadía a 1280×720 (−17 px) y 1366×768 (−4 px); a 1024×768 y 1280×720 las tiles pisaban la regla del pie. Ahora
`s06-engine.js` → `place()` baja rejilla y columna derecha bajo el copy (o las sube si al 46 % se comen el pie), y un bloque
`@media (max-height: 820px)` aprieta las tiles. `scripts/probe-s06.mjs` (nuevo) mide 10 tamaños de 1024×768 a 2560×1440:
TODO OK. `responsive-check` TODO OK en local y en vivo.

## 16. V3.7 · Fuera la lámina del ask (2026-09-23) — PUBLICADO (Fly v25, Vercel `5c4971b`)

Carlos: la ronda probablemente será mayor que $600K y el uso de fondos irá en hojas de cálculo aparte; el deck no lleva el
detalle de lo que se pide. Se retiró S10 entera (cifra, 5 cubetas, hitos y el cierre "FIXING THE WEB'S BIGGEST BLIND SPOT").
El deck queda en 11 escenas (Libraries = 10, Contact = 11); `?short=1` = portada → carta → fix → modelo → contacto.
- Copy y lámina guardadas fuera del bundle en `archive/s10-copy.js` y `archive/s10-ask.js` (instrucciones para volver dentro);
  el CSS `.s10-*` sigue en `src/style.css`, sin uso. Comprobado: ningún texto de la ronda en `dist/assets`.
- Notas de S07 y PRESENTER.md: "billing automation / self-serve billing is on the roadmap" en lugar de "in the use of funds".
- `responsive-check.mjs`: sin el bloque de S10, espera 11 puntos, Libraries en `slide=10`. TODO OK en local y en vivo.
