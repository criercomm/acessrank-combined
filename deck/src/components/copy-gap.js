// Publishes each slide's copy-block height as --copy-h-<slide> on :root, so content positioned under the copy
// (src/style.css) sits the same --copy-gap below it on every slide, whatever the headline wraps to.
export function trackCopyHeights(root = document) {
  const targets = ['s02', 's04', 's06', 's12']
  const root$ = document.documentElement
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const id = e.target.dataset.copyFor
      root$.style.setProperty('--copy-h-' + id, Math.round(e.target.offsetHeight) + 'px')
    }
  })
  for (const id of targets) {
    const node = root.querySelector('.' + id + '-copy')
    if (!node) continue
    node.dataset.copyFor = id
    ro.observe(node)
  }
}
