// stage-scale.js — fills large windows by scaling the whole deck stage, instead of leaving a 1280px column in the middle.
//
// The slides are composed against a ~1440 x 820 stage (absolute blocks, px offsets, a 1280px column). Rather than
// re-tune every slide for each window size, the stage is scaled as one unit with CSS `zoom` (see "Large windows: scale
// the stage" at the end of style.css). This sets --k, the scale factor:
//   - 1 up to a 1440 x 820 window, so laptops look exactly as before;
//   - above that, the smaller of width/1440 and height/820, so nothing is cropped on short, wide windows;
//   - capped at 2.25 so a 5K or ultrawide window still has quiet margins instead of billboard-sized type;
//   - 1 for the compact layouts (phones, short windows, anything taller than wide), which flow and scroll instead.
// `zoom` rather than `transform: scale()`: text stays sharp, layout and hit areas follow, and browser zoom still
// works (zooming in shrinks innerWidth, so k falls back toward 1) — which matters on an accessibility site.
const BASE_W = 1440
const BASE_H = 820
const MAX = 2.25

export function StageScale(root = document.documentElement) {
  const apply = () => {
    const w = window.innerWidth, h = window.innerHeight
    const compact = w < 768 || h < 621 || w <= h
    const k = compact ? 1 : Math.max(1, Math.min(w / BASE_W, h / BASE_H, MAX))
    root.style.setProperty('--k', k.toFixed(3))
  }
  apply()
  window.addEventListener('resize', apply)
  return { apply }
}
