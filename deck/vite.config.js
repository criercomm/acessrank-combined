// vite.config.js — Deck R · Accessrank. Librería compartida en ../lib (alias @lib).
// Solo /assets/final y /assets/audio entran al bundle; /assets/source, /assets/cutouts y /refs nunca.
import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const SHARED_LIB = path.resolve(root, '../lib')
const VENDORED_LIB = path.resolve(root, './lib')
// En la máquina de decks (varios decks junto a lib/) usa la copia compartida y viva;
// en un clon standalone (p.ej. accessrank-deck para JP) cae a la copia empaquetada en este repo.
const LIB = fs.existsSync(SHARED_LIB) ? SHARED_LIB : VENDORED_LIB
const SERVE = ['assets/final', 'assets/audio']
const TYPES = { avif: 'image/avif', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4' }

// El manifest completo (prompts, candidatos, libro de créditos) es documentación interna: al bundle viaja solo lo que usa el runtime.
const RUNTIME_KEYS = ['id', 'slide', 'group', 'kind', 'status', 'file', 'files', 'w', 'h', 'anchor', 'z', 'shadow', 'contactY', 'ratio']
function manifestForRuntime(full, strip) {
  if (!strip) return full
  return { deck: full.deck, name: full.name, audio: full.audio, assets: full.assets.map((a) => Object.fromEntries(RUNTIME_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]))) }
}
function deckAssets() {
  let strip = false
  return {
    name: 'deck-assets',
    configResolved(c) { strip = c.command === 'build' },
    resolveId(id) { if (id === 'virtual:manifest') return ' virtual:manifest' },
    load(id) {
      if (id !== ' virtual:manifest') return null
      const full = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
      return 'export default ' + JSON.stringify(manifestForRuntime(full, strip))
    },
    configureServer(server) {
      // manifest.json is not an import: watch it by hand so a merge/finalize shows up without restarting the server
      const manifestPath = path.join(root, 'manifest.json')
      server.watcher.add(manifestPath)
      server.watcher.on('change', (f) => { if (path.normalize(f) !== path.normalize(manifestPath)) return; const mod = server.moduleGraph.getModuleById(' virtual:manifest'); if (mod) server.moduleGraph.invalidateModule(mod); server.ws.send({ type: 'full-reload' }) })
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0])
        const hit = SERVE.find((d) => url.startsWith('/' + d + '/'))
        if (!hit) return next()
        const file = path.normalize(path.join(root, url))
        const base = path.normalize(path.join(root, hit))
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end() }
        res.setHeader('Content-Type', TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const d of SERVE) {
        const src = path.join(root, d)
        if (!fs.existsSync(src)) continue
        fs.cpSync(src, path.join(root, 'dist', d), { recursive: true, filter: (s) => !s.endsWith('.gitkeep') && !s.endsWith('.md') })
      }
    },
  }
}

export default defineConfig({
  base: process.env.DECK_BASE || './', // DECK_BASE=/deck/ para la copia en accessrank.ai (rutas absolutas: sirve con y sin barra final)
  publicDir: 'public',
  resolve: {
    alias: [
      { find: '@lib', replacement: LIB },
      { find: /^gsap(\/.*)?$/, replacement: path.resolve(root, 'node_modules/gsap') + '$1' },
    ],
  },
  optimizeDeps: { include: ['gsap', 'gsap/CustomEase'] },
  server: { port: 5178, strictPort: false, fs: { allow: [root, LIB] } },
  build: { target: 'es2022', assetsInlineLimit: 0, cssCodeSplit: false, sourcemap: false },
  plugins: [deckAssets()],
})
