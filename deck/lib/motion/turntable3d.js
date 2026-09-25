// Turntable3D(container, {url, dracoPath, autoRpm, fov, elevation, tickEvery, sound}) — giratorio 3D REAL.
// Sustituye al Flipbook de 24 fotogramas en el turntable de un producto: el coche gira a cualquier ángulo,
// refleja un entorno de estudio y no salta entre fotogramas. Arrastre con inercia; giro automático lento que
// se reanuda 2,5 s después de soltar. Si no hay WebGL devuelve {supported:false} y el slide cae al Flipbook.
// `three` se resuelve en el node_modules del deck (alias regex en vite.config.js, igual que gsap).
// Materiales: si la malla trae materiales llamados paint / glass / trim / lamp / pixel (los que exporta
// scripts/car3d.py del deck), aquí se les da acabado físico sobre la textura (barniz, vidrio oscuro, trim
// satinado, piloto y lámparas de píxeles emisivas).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { clamp, prefersReduced } from '../util/dom.js'

const TAU = Math.PI * 2

function contactShadowDisc() {
  // disco con gradiente radial pintado en canvas: misma idea que la sombra de contacto de los cut-outs
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d'); const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128)
  grd.addColorStop(0, 'rgba(0,0,0,.62)'); grd.addColorStop(.55, 'rgba(0,0,0,.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = .002; mesh.renderOrder = -1
  return mesh
}

function dressMaterials(root) {
  // La textura de Tripo (albedo con sombreado horneado) se conserva como mapa base en TODAS las clases: es la
  // que trae las lámparas de píxeles, las manijas y la línea de carácter. Cada clase le pone encima su acabado;
  // el `color` multiplica al mapa (tinte), y en lamp/pixel el propio mapa hace de máscara emisiva.
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = false; o.receiveShadow = false
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    mats.forEach((m, i) => {
      const name = (m.name || '').toLowerCase(), map = m.map ?? null
      let next = m
      if (name.includes('paint') || name.includes('body')) {
        next = new THREE.MeshPhysicalMaterial({ map, color: new THREE.Color('#f6f4f0'), metalness: .22, roughness: .36, clearcoat: 1, clearcoatRoughness: .09, envMapIntensity: 1.2 })
      } else if (name.includes('glass')) {
        // sin mapa: vidrio, tomas de aire y huecos de rueda como un negro pulido limpio (la textura ahí solo trae ruido)
        next = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#0b0e14'), metalness: .15, roughness: .05, envMapIntensity: 1.8 })
      } else if (name.includes('trim') || name.includes('graphite')) {
        next = new THREE.MeshStandardMaterial({ map, color: new THREE.Color('#9a9ea6'), metalness: .3, roughness: .5, envMapIntensity: .9 })
      } else if (name.includes('lamp')) {
        next = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ff3a24'), emissiveIntensity: 1.1, roughness: .3, metalness: 0 })
      } else if (name.includes('pixel')) {
        next = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.5, roughness: .3, metalness: 0 })
      } else {
        // malla de un solo material con textura (sin clasificar): acabado de pintura genérico sobre la textura
        m.metalness = Math.max(m.metalness ?? 0, .15); m.roughness = Math.min(m.roughness ?? 1, .4); m.envMapIntensity = 1.1
      }
      if (next !== m) { next.name = m.name; mats[i] = next }
    })
    o.material = Array.isArray(o.material) ? mats : mats[0]
  })
}

export function Turntable3D(container, { url, dracoPath = './draco/', autoRpm = 3.5, fov = 24, elevation = .11, tickEvery = 15, sound = null, dpr = Math.min(window.devicePixelRatio || 1, 2), onReady } = {}) {
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2') || probe.getContext('webgl')
  if (!gl) return { supported: false }
  const reduced = prefersReduced()

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(dpr)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.className = 'turntable3d'
  canvas.setAttribute('aria-hidden', 'true')
  container.append(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(fov, 1, .05, 100)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture
  pmrem.dispose()
  // estudio: key alta y suave + rim frío desde atrás; el entorno pone los reflejos
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 6, 4); scene.add(key)
  const rim = new THREE.DirectionalLight(0xc9d1d9, 1.1); rim.position.set(-4, 3, -6); scene.add(rim)
  scene.add(new THREE.AmbientLight(0xffffff, .08))

  const pivot = new THREE.Group(); scene.add(pivot)
  const shadow = contactShadowDisc(); scene.add(shadow)

  let model = null, radius = 1, sizeY = 1, loading = null, ready = false
  let angle = 0, vel = 0, dragging = false, lastX = 0, lastT = 0, idleAt = 0
  let playing = false, raf = 0, lastTickStep = 0, w = 0, h = 0

  function fit() {
    const r = container.getBoundingClientRect()
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // distancia para que el coche llene ~85 % del encuadre en el eje más restrictivo (el lado cercano está más
    // cerca que el pivote y se ve más grande: con 1.1 medía 97 % del ancho; 1.24 lo deja en ~85 %). El ajuste horizontal
    // usa el radio (medio largo del coche, que es lo que barre al girar); el vertical usa la ALTURA real,
    // no el radio: con el radio, un coche de 4,2 m y 1,4 m de alto quedaba al 39 % del ancho de la caja.
    const vFov = THREE.MathUtils.degToRad(camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
    const dist = Math.max(radius / Math.tan(hFov / 2), (sizeY * .62) / Math.tan(vFov / 2)) * 1.24
    camera.position.set(0, dist * Math.sin(elevation) + sizeY * .35, dist * Math.cos(elevation))
    camera.lookAt(0, sizeY * .42, 0)
    camera.updateProjectionMatrix()
    render()
  }

  function render() { renderer.render(scene, camera) }

  function preload() {
    if (loading) return loading
    loading = new Promise((resolve, reject) => {
      const draco = new DRACOLoader(); draco.setDecoderPath(dracoPath)
      const loader = new GLTFLoader(); loader.setDRACOLoader(draco)
      loader.load(url, (gltf) => {
        model = gltf.scene
        dressMaterials(model)
        // centrar en x/z y apoyar en y=0; el radio manda el encuadre y la sombra
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
        model.position.set(-center.x, -box.min.y, -center.z)
        radius = Math.max(size.x, size.z) * .5; sizeY = size.y
        pivot.add(model)
        shadow.scale.set(size.x * 1.25, size.z * 1.35, 1)
        ready = true
        fit()
        onReady?.()
        resolve()
      }, undefined, reject)
    })
    return loading
  }

  function tick(now) {
    if (!playing) return
    const dt = Math.min(.05, (now - (lastT || now)) / 1000); lastT = now
    if (!dragging) {
      if (Math.abs(vel) > .0005) { angle += vel; vel *= Math.pow(.06, dt) } // inercia: decae a 6 % por segundo
      else if (!reduced && now - idleAt > 2500) angle += (autoRpm / 60) * TAU * dt
    }
    pivot.rotation.y = angle
    const step = Math.floor(((angle % TAU) + TAU) % TAU / THREE.MathUtils.degToRad(tickEvery))
    if (step !== lastTickStep) { lastTickStep = step; sound?.play('tick', { throttle: 40 }) }
    render()
    raf = requestAnimationFrame(tick)
  }

  function play() { if (playing) return; playing = true; lastT = 0; raf = requestAnimationFrame(tick) }
  function pause() { playing = false; cancelAnimationFrame(raf) }

  // arrastre horizontal → ángulo; la velocidad al soltar sigue como inercia
  const onDown = (e) => { dragging = true; lastX = e.clientX; vel = 0; try { canvas.setPointerCapture(e.pointerId) } catch {} canvas.classList.add('is-dragging') }
  const onMove = (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX; lastX = e.clientX
    const d = dx * (TAU / Math.max(320, w * .9)) // un ancho de canvas ≈ 1 vuelta
    angle += d; vel = clamp(d, -.12, .12)
    if (!playing) { pivot.rotation.y = angle; render() }
  }
  const onUp = () => { dragging = false; idleAt = performance.now(); canvas.classList.remove('is-dragging') }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  const ro = new ResizeObserver(() => { if (ready) fit() })
  ro.observe(container)

  function destroy() {
    pause(); ro.disconnect()
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp)
    renderer.dispose(); canvas.remove()
  }

  return {
    supported: true, canvas, preload, play, pause, destroy,
    seek(deg) { angle = THREE.MathUtils.degToRad(deg); pivot.rotation.y = angle; render() },
    get angle() { return THREE.MathUtils.radToDeg(angle) }, get ready() { return ready }, get playing() { return playing },
  }
}
