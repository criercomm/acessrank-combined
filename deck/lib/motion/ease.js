// /decks/lib/motion/ease.js — tokens de tiempo y easing (decks-brief-v2 §1.2)
import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
gsap.registerPlugin(CustomEase)
export const T = { 1: 120, 2: 240, 3: 480, 4: 800, 5: 1200, 6: 1600 }
export const EASE = {
  'out-expo': CustomEase.create('out-expo', '.16,1,.3,1'),
  'in-out-quart': CustomEase.create('in-out-quart', '.76,0,.24,1'),
  'out-back': CustomEase.create('out-back', '.34,1.56,.64,1'),
  linear: 'none',
}
export const ease = (k) => EASE[k] || k
export const sec = (ms) => ms / 1000
export { gsap }
