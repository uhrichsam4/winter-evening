// Winter evening: a procedural, CSS-animated SVG backdrop.
//
// A drone glides forward, about nine metres up, down an endless snowy street
// between apartment blocks on a winter night. Two colourways share one drawing:
// Black, graphite like a Space Black MacBook Pro, and Blue, the steel-blue dusk
// of the first winter scene. Either way the lights are warm, and mostly on the
// two sides (the chat column covers the middle, where the street runs off into
// the fog): lit windows and shopfronts with awnings and garlands, lamps with
// soft halos and strings of bulbs, lit firs. People walk both ways on the
// pavements and in the lane; snow falls and streams past.
//
// Pure TypeScript: no imports, no DOM, no Node. The strings are built once at
// module load with a seeded PRNG (mulberry32), so every load is identical.
// Only `transform` and `opacity` are animated, all from the <style> block.
//
// World model: metres. X = right of the camera, Y = up from the snow, z = depth.
// Screen: x = HX + FOC*X/z, y = HY + FOC*(CAM-Y)/z.
//
// Forward flight ("conveyor ladders"): flying forward by d moves a point at
// depth z to z - d, which on screen is a scale about the vanishing point by
// z / (z - d). The street repeats along its depth, so each kind of thing is a
// ladder: one asset drawn at a reference depth zr, and instances at slots
// zN = z0 + i*P (i = 0 nearest). Instance i is placed at its far depth
// zF = zN + P (a fixed scale zr/zF about the vanishing point) and animated, in
// the same phase as the rest of its ladder, over T = P / speed, along the true
// curve s(τ) = zF / (zF - P τ), sampled into percent stops evenly spaced in
// log s so the speed changes by a few percent from stop to stop: at the end it
// sits where instance i-1 starts, moving as fast. The nearest instance ends
// wholly outside the frame; the farthest fades in out of the fog. Lines that
// run to the vanishing point (walls, roofline, kerbs, tyre tracks) do not move
// under forward flight and are drawn once, still.
//
// The far instances are <use>s of a still asset in <defs>. Nothing that moves
// on its own (a walker's legs, a twinkle, a flicker, smoke) lives in <defs>:
// the nearest instance or two are drawn inline with it. Every such animation
// runs on its ladder's period (a walker's stride on a whole fraction of it) and
// is back at the still asset's state at each wrap, so a still instance hands
// over to a moving one without a jump.

// ============================== tunables ===================================

const HX = 800 // vanishing point x
const HY = 360 // horizon y (the drone looks a little down)
const FOC = 1000 // focal length, px per metre at 1 m
const CAM = 9 // drone height above the snow, m
const SPEED = 2.4 // m/s, a calm glide
const WALK = 1.3 // m/s, people
const GT = 1.1 // s per two steps; people's ladder periods are whole multiples of 2 GT
const SEED = 20261114
const WALL = 9 // building fronts, m either side of the street's centre
const ROOF = 19 // their height, m
const ROAD = 3.6 // half width of the road, m
const STEP = 1.055 // the most the scale grows from one keyframe stop to the next

export type Tone = 'black' | 'blue'

type Pal = {
  skyTop: string
  skyMid: string
  haze: string
  fog: string
  fogHi: string
  snowHi: string
  snowNear: string
  path: string
  bldg: string
  shadow: string
  ink: string
  indigo: string
  flake: string
  wall: string
  roadDark: string
  glassDark: string
  door: string
  carBody: string
  carGlass: string
  carSnow: string
  fir: string
  smoke: string
  track: string
  txtFill: string
  txtEdge: string
}

/** Graphite night, close to a Space Black MacBook Pro. */
const BLACK: Pal = {
  skyTop: '#0b0b0c',
  skyMid: '#121212',
  haze: '#1d1b1a',
  fog: '#282727',
  fogHi: '#2f2e2d',
  snowHi: '#8d8984',
  snowNear: '#484644',
  path: '#242323',
  bldg: '#19191a',
  shadow: '#121213',
  ink: '#0c0c0d',
  indigo: '#040405',
  flake: '#ebe7e1',
  wall: '#1b1b1c',
  roadDark: '#141414',
  glassDark: '#0e0e0f',
  door: '#151312',
  carBody: '#1a1918',
  carGlass: '#121111',
  carSnow: '#6a6662',
  fir: '#141614',
  smoke: '#6b6763',
  track: '#0c0c0c',
  txtFill: '#a8a095',
  txtEdge: '#141312',
}

/** Steel-blue dusk: the first winter scene's colours. */
const BLUE: Pal = {
  skyTop: '#2f4c7c',
  skyMid: '#47669a',
  haze: '#5a7aa8',
  fog: '#6c8cbb',
  fogHi: '#7b99c4',
  snowHi: '#8fa9d0',
  snowNear: '#5675a9',
  path: '#47659a',
  bldg: '#2b4677',
  shadow: '#24406e',
  ink: '#1b2b51',
  indigo: '#131b40',
  flake: '#dfeaf8',
  wall: '#2a4472',
  roadDark: '#2c4676',
  glassDark: '#1a2a4c',
  door: '#1e2b4a',
  carBody: '#253a64',
  carGlass: '#162240',
  carSnow: '#7d97c0',
  fir: '#1b3040',
  smoke: '#9ab0d4',
  track: '#1f3360',
  txtFill: '#c6d4e8',
  txtEdge: '#2a4270',
}

// The warm lights are the same in both colourways.
const WARM = '#ff9a45'
const LAMP = '#ffcf96'
/** Lit-window ambers, a little different room to room. */
const AMB = ['#f3a95c', '#e89048', '#ffc47e', '#d97f3e', '#f6b76c']

// Snow layers, back to front. Tile is 1900 x 1300 (x -150..1750, y -150..1150)
// so the wind slant never uncovers a corner; fall = exactly one tile height.
const TILE_H = 1300
const SNOW = [
  { n: 300, r: [0.6, 1.1], op: [0.35, 0.6], fall: 47, ang: 5, sway: 6, sd: [17, 23, 29], bokeh: false },
  { n: 210, r: [1.2, 2.1], op: [0.42, 0.62], fall: 37, ang: 6, sway: 10, sd: [11, 13, 19], bokeh: false },
  { n: 150, r: [1.9, 3.1], op: [0.45, 0.7], fall: 23, ang: 7, sway: 16, sd: [7, 11, 13], bokeh: false },
  { n: 60, r: [3, 5], op: [0.45, 0.7], fall: 13, ang: 8, sway: 24, sd: [6.1, 8.3, 9.7], bokeh: true },
  { n: 24, r: [8, 18], op: [0.22, 0.38], fall: 7.9, ang: 9, sway: 30, sd: [5.3, 7.1, 8.9], bokeh: true },
]

// ============================== helpers ====================================

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Number to 1-decimal string, "0.5" → ".5", "-0" → "0". */
function n(v: number): string {
  let s = (Math.round(v * 10) / 10).toString()
  if (s === '-0') s = '0'
  return s.replace(/^(-?)0\./, '$1.')
}
/** Number to integer string. */
function ni(v: number): string {
  const s = Math.round(v).toString()
  return s === '-0' ? '0' : s
}
/** Number to `d` decimals, shortest form. */
function nd(v: number, d: number): string {
  const s = (Math.round(v * 10 ** d) / 10 ** d).toString()
  return s === '-0' ? '0' : s.replace(/^(-?)0\./, '$1.')
}
/** Opacity / small factor to 2 decimals, "0.45" → ".45". */
const o2 = (v: number): string => nd(v, 2)
/** Scale to 4 decimals (seams stay within a tenth of a pixel). */
const s4 = (v: number): string => nd(v, 4)
/** Join path numbers compactly (no space before a minus sign). */
const pj = (parts: string[]): string => parts.join(' ').replace(/ -/g, '-')

function rgb(c: string): number[] {
  return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
}
function mix(a: string, b: string, t: number): string {
  const A = rgb(a)
  const B = rgb(b)
  return (
    '#' +
    A.map((v, i) =>
      Math.round(v + ((B[i] ?? v) - v) * t)
        .toString(16)
        .padStart(2, '0'),
    ).join('')
  )
}

// Projection.
const sx = (X: number, z: number): number => HX + (FOC * X) / z
const sy = (Y: number, z: number): number => HY + (FOC * (CAM - Y)) / z
type P3 = [number, number, number]
type P2 = [number, number]
/** Closed polygon path from world points, whole pixels, relative steps. */
function poly(pts: P3[]): string {
  const q = pts.map(([X, Y, z]) => [Math.round(sx(X, z)), Math.round(sy(Y, z))])
  const rel = q.slice(1).map(([x = 0, y = 0], i) => pj([ni(x - (q[i]?.[0] ?? 0)), ni(y - (q[i]?.[1] ?? 0))]))
  return 'M' + pj([ni(q[0]?.[0] ?? 0), ni(q[0]?.[1] ?? 0)]) + 'l' + pj(rel) + 'Z'
}
/** A quad on the wall plane X, from depth a to b, height y0 to y1. */
const wq = (X: number, a: number, b: number, y0: number, y1: number): string =>
  poly([
    [X, y0, a],
    [X, y0, b],
    [X, y1, b],
    [X, y1, a],
  ])
/** A quad flat on the ground, X a..b, depth c..d. */
const gq = (a: number, b: number, c: number, d: number): string =>
  poly([
    [a, 0, c],
    [b, 0, c],
    [b, 0, d],
    [a, 0, d],
  ])
/** Bulbs along a sagging world-space span from A to B, one every `step` m. */
function span(A: P3, B: P3, sag: number, step: number): P3[] {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2])
  const k = Math.max(2, Math.round(len / step))
  const pts: P3[] = []
  for (let i = 0; i <= k; i++) {
    const t = i / k
    pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - 4 * t * (1 - t) * sag, A[2] + (B[2] - A[2]) * t])
  }
  return pts
}
/** Screen box of world points. */
function boxOf(pts: P3[]): [number, number, number, number] {
  const xs = pts.map(([X, , z]) => sx(X, z))
  const ys = pts.map(([, Y, z]) => sy(Y, z))
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
/** Convex hull (monotone chain) of screen points. */
function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cr = (o: P2, a: P2, b: P2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: P2[]): P2[] => {
    const h: P2[] = []
    for (const q of list) {
      while (h.length >= 2 && cr(h[h.length - 2] as P2, h[h.length - 1] as P2, q) <= 0) h.pop()
      h.push(q)
    }
    h.pop()
    return h
  }
  return [...half(p), ...half([...p].reverse())]
}
/** Closed path through `pts` with every corner rounded (k: 0 sharp .. 1 fully soft). */
function rounded(pts: P2[], k: number): string {
  const m = pts.length
  const parts: string[] = []
  let last = ''
  for (let i = 0; i <= m; i++) {
    const v = pts[i % m] as P2
    const a = pts[(i + m - 1) % m] as P2
    const b = pts[(i + 1) % m] as P2
    const la = Math.hypot(a[0] - v[0], a[1] - v[1]) || 1
    const lb = Math.hypot(b[0] - v[0], b[1] - v[1]) || 1
    const r = (k * Math.min(la, lb)) / 2
    const p1: P2 = [v[0] + ((a[0] - v[0]) * r) / la, v[1] + ((a[1] - v[1]) * r) / la]
    const p2: P2 = [v[0] + ((b[0] - v[0]) * r) / lb, v[1] + ((b[1] - v[1]) * r) / lb]
    const at = pj([ni(p1[0]), ni(p1[1])])
    if (i === 0) parts.push('M' + pj([ni(p2[0]), ni(p2[1])]))
    else parts.push((at === last ? '' : 'L' + at) + 'Q' + pj([ni(v[0]), ni(v[1]), ni(p2[0]), ni(p2[1])]))
    last = pj([ni(p2[0]), ni(p2[1])])
  }
  return parts.join('') + 'Z'
}
/** Screen silhouette of a world box, rounded. */
function blob(x0: number, x1: number, y0: number, y1: number, a: number, b: number, k: number): string {
  const pts: P2[] = []
  for (const X of [x0, x1]) for (const Y of [y0, y1]) for (const z of [a, b]) pts.push([sx(X, z), sy(Y, z)])
  return rounded(hull(pts), k)
}

/** Keyframes from [percent, css] stops. */
const stops = (s: [number, string][]): string => s.map(([p, v]) => `${n(p)}%{${v}}`).join('')
/**
 * The same cyclic stops shifted by `by` percent (for the opposite leg). The
 * list must hold a stop at 100 - by, which becomes the new 0 % and 100 %.
 */
function shift(s: [number, string][], by: number): [number, string][] {
  const out: [number, string][] = s
    .filter(([p]) => p < 100)
    .map(([p, v]): [number, string] => [(p + by) % 100, v])
    .sort((a, b) => a[0] - b[0])
  const f0 = out[0]
  if (f0) out.push([100, f0[1]])
  return out
}

/** What the build script checks for every ladder (seams, speeds, exit, fade). */
export type LadderNote = {
  name: string
  T: number
  boxes: [number, number, number, number][] // screen boxes of the asset's parts at its reference depth
  inst: { zN: number; zF: number; place: number; cls: string[] }[] // nearest first
}

// The people's walk: the leg, arm and bob loops of the first winter scene.
const legStops: [number, string][] = [
  [0, 'transform:translateY(-3px) scaleY(.95)'],
  [50, 'transform:translateY(3px) scaleY(1.03)'],
  [62, 'transform:translateY(0) scaleY(.94)'],
  [80, 'transform:translateY(-6px) scaleY(.9)'],
  [100, 'transform:translateY(-3px) scaleY(.95)'],
]
const shinStops: [number, string][] = [
  [0, 'transform:scaleY(1)'],
  [50, 'transform:scaleY(1)'],
  [60, 'transform:scaleY(.72)'],
  [75, 'transform:scaleY(.8)'],
  [90, 'transform:scaleY(.97)'],
  [100, 'transform:scaleY(1)'],
]
const soleStops: [number, string][] = [
  [0, 'opacity:0'],
  [50, 'opacity:0'],
  [58, 'opacity:1'],
  [80, 'opacity:.6'],
  [92, 'opacity:0'],
  [100, 'opacity:0'],
]
const armLStops: [number, string][] = [
  [0, 'transform:rotate(4deg) scaleY(1.03)'],
  [50, 'transform:rotate(-2deg) scaleY(.86)'],
  [100, 'transform:rotate(4deg) scaleY(1.03)'],
]
const armRStops: [number, string][] = [
  [0, 'transform:rotate(2deg) scaleY(.86)'],
  [50, 'transform:rotate(-4deg) scaleY(1.03)'],
  [100, 'transform:rotate(2deg) scaleY(.86)'],
]
const bobStops = (x: number, y: number): [number, string][] => [
  [0, 'transform:translate(0,0)'],
  [25, `transform:translate(${n(-x)}px,${n(-y)}px)`],
  [50, 'transform:translate(0,0)'],
  [75, `transform:translate(${n(x)}px,${n(-y)}px)`],
  [100, 'transform:translate(0,0)'],
]
const RC = 'stroke-linecap="round"'

// ============================== one colourway ==============================

/** The whole drawing in palette C; the two builds differ in colours only. */
function build(C: Pal): { HEAD: string; MID: string; TAIL: string; notes: LadderNote[]; textCls: string[] } {
  let R = mulberry32(SEED)
  const rnd = (a: number, b: number): number => a + (b - a) * R()

  // ---- CSS collector: short class names, deduped keyframes ------------------
  const css: string[] = []
  const kfs = new Map<string, string>()
  const LET = 'abcdefghijklmnopqrstuvwxyz'
  const letters = (i: number): string => (i < 26 ? LET.charAt(i) : LET.charAt(Math.floor(i / 26) - 1) + LET.charAt(i % 26))
  function kf(body: string): string {
    let k = kfs.get(body)
    if (k === undefined) {
      // letters only: a name like "k1s" next to "2.3s" would read as two times
      k = 'k' + letters(kfs.size)
      kfs.set(body, k)
      css.push(`@keyframes ${k}{${body}}`)
    }
    return k
  }
  let cc = 0
  const clsMap = new Map<string, string>()
  function cls(rule: string): string {
    let c = clsMap.get(rule)
    if (c === undefined) {
      c = letters(cc++)
      clsMap.set(rule, c)
      css.push(`.${c}{${rule}}`)
    }
    return c
  }
  /**
   * An animation delay that continues across reloads: the root carries --t, the
   * seconds since a fixed epoch, so every loop resumes at the phase it had.
   */
  const dl = (delay: number): string => `animation-delay:calc(${n(delay)}s - var(--t))`
  const org = (x: number, y: number): string => `transform-origin:${n(x)}px ${n(y)}px`
  /** A class running keyframes `body` forever. */
  function an(body: string, dur: number, delay = 0, tf = 'ease-in-out', alt = true, extra = ''): string {
    return cls(`animation:${kf(body)} ${nd(dur, 3)}s ${tf} infinite${alt ? ' alternate' : ''};${dl(delay)}${extra ? ';' + extra : ''}`)
  }

  const st = (o: number, c: string, op = 1): string =>
    `<stop offset="${o2(o)}" stop-color="${c}"${op < 1 ? ` stop-opacity="${o2(op)}"` : ''}/>`
  const defs = [
    `<linearGradient id="sk" x2="0" y2="1">${st(0, C.skyTop)}${st(0.6, C.skyMid)}${st(0.9, C.haze)}${st(1, C.fog)}</linearGradient>`,
    `<linearGradient id="gd" x2="0" y2="1">${st(0, C.fog)}${st(0.3, mix(C.fog, C.snowNear, 0.45))}${st(1, C.snowNear)}</linearGradient>`,
    `<radialGradient id="fo">${st(0, C.fog, 0.97)}${st(0.3, C.fog, 0.9)}${st(0.62, C.fog, 0.5)}${st(1, C.fog, 0)}</radialGradient>`,
    `<radialGradient id="fh">${st(0, C.fogHi, 0.85)}${st(0.55, C.fogHi, 0.35)}${st(1, C.fogHi, 0)}</radialGradient>`,
    `<radialGradient id="wl">${st(0, WARM, 0.4)}${st(1, WARM, 0)}</radialGradient>`,
    `<radialGradient id="lh">${st(0, LAMP, 0.6)}${st(0.25, LAMP, 0.24)}${st(1, LAMP, 0)}</radialGradient>`,
    `<radialGradient id="lg">${st(0, WARM, 0.16)}${st(0.4, WARM, 0.06)}${st(1, WARM, 0)}</radialGradient>`,
    `<radialGradient id="lp">${st(0, LAMP, 0.3)}${st(0.5, WARM, 0.1)}${st(1, WARM, 0)}</radialGradient>`,
    `<radialGradient id="wg">${st(0, WARM, 0.3)}${st(1, WARM, 0)}</radialGradient>`,
    `<radialGradient id="sm">${st(0, C.smoke, 0.75)}${st(1, C.smoke, 0)}</radialGradient>`,
    `<linearGradient id="cw" x2="0" y2="1">${st(0, '#ffd59a')}${st(0.6, '#f4a65a')}${st(1, '#d9803e')}</linearGradient>`,
    `<radialGradient id="bk">${st(0, C.flake)}${st(0.45, C.flake, 0.6)}${st(1, C.flake, 0)}</radialGradient>`,
    `<radialGradient id="vg" r=".75">${st(0.66, C.indigo, 0)}${st(1, C.indigo, 0.35)}</radialGradient>`,
    `<linearGradient id="vb" x2="0" y2="1">${st(0, C.indigo, 0)}${st(1, C.indigo, 0.28)}</linearGradient>`,
    `<linearGradient id="pg" gradientUnits="userSpaceOnUse" x1="0" y1="${HY + 8}" x2="0" y2="1000">${st(0, C.fog, 0)}${st(0.12, C.fog, 0)}${st(0.42, C.path, 0.75)}${st(1, C.path)}</linearGradient>`,
    `<linearGradient id="sb" gradientUnits="userSpaceOnUse" x1="0" y1="${HY + 8}" x2="0" y2="1000">${st(0, C.snowHi, 0)}${st(0.15, C.snowHi, 0)}${st(0.45, C.snowHi, 0.2)}${st(1, C.snowHi, 0.32)}</linearGradient>`,
    `<linearGradient id="wa" gradientUnits="userSpaceOnUse" x1="0" x2="${HX - 40}">${st(0, C.wall)}${st(0.55, mix(C.wall, C.fog, 0.6))}${st(1, C.fog)}</linearGradient>`,
    `<linearGradient id="wb" gradientUnits="userSpaceOnUse" x1="1600" x2="${HX + 40}">${st(0, C.wall)}${st(0.55, mix(C.wall, C.fog, 0.6))}${st(1, C.fog)}</linearGradient>`,
  ]
  /** A still asset in <defs> (no classes, no <use>), for ladders to instance. */
  const asset = (id: string, body: string, attrs = ''): void => {
    defs.push(`<g id="${id}"${attrs}>${body}</g>`)
  }

  // ---- ladders ---------------------------------------------------------------
  const notes: LadderNote[] = []
  /**
   * A ladder: slots zN = z0 + i*P up to zMax, moving toward the camera at
   * `speed` m/s, one class each on the true 1/z curve. The `liveN` nearest draw
   * `live` inline (what moves on its own); the rest <use> the still asset `id`.
   */
  function ladder(o: { name: string; id: string; parts: P3[][]; zr: number; P: number; speed: number; z0: number; zMax: number; delay: number; live?: string; liveN?: number }): string {
    const T = o.P / o.speed
    const note: LadderNote = { name: o.name, T, boxes: o.parts.map(boxOf), inst: [] }
    let count = 0
    while (o.z0 + count * o.P < o.zMax) count++
    const html: string[] = []
    for (let i = count - 1; i >= 0; i--) {
      const zN = o.z0 + i * o.P
      const zF = zN + o.P
      const k = zF / zN
      const fade = i === count - 1
      const N = Math.max(4, Math.ceil(Math.log(k) / Math.log(STEP)))
      const body: string[] = []
      for (let j = 0; j <= N; j++) {
        const s = j === N ? k : Math.pow(k, j / N)
        const tau = j === N ? 1 : (zF / o.P) * (1 - 1 / s)
        body.push(`${nd(tau * 100, 2)}%{transform:scale(${s4(s)})${fade ? `;opacity:${o2(tau)}` : ''}}`)
      }
      const c = cls(`animation:${kf(body.join(''))} ${nd(T, 3)}s linear infinite;${dl(o.delay)};transform-origin:${HX}px ${HY}px`)
      const place = Number(s4(o.zr / zF))
      note.inst.unshift({ zN, zF, place, cls: [c] })
      const tr = `translate(${nd(HX * (1 - place), 2)} ${nd(HY * (1 - place), 2)}) scale(${s4(place)})`
      const inner = o.live !== undefined && i < (o.liveN ?? 1) ? `<g transform="${tr}">${o.live}</g>` : `<use href="#${o.id}" transform="${tr}"/>`
      html.push(`<g class="${c}">${inner}</g>`)
    }
    notes.push(note)
    return html.join('')
  }
  /** An animation on a ladder's own period and phase: back at its 0 % state at every wrap. */
  const locked = (body: string, T: number, delay: number, extra = ''): string =>
    cls(`animation:${kf(body)} ${nd(T, 3)}s linear infinite;${dl(delay)}${extra ? ';' + extra : ''}`)

  /**
   * A lit string: its wire (optional) and its bulbs; `w` is the bulb size in px.
   * Live, every other bulb brightens and dims once a period (`tw`, a locked class).
   */
  function bulbs(pts: P3[], w: number, wire: boolean, tw: string): string {
    const all = pts.map(([X, Y, z]) => 'M' + pj([ni(sx(X, z)), ni(sy(Y, z))]) + 'h.1').join('')
    const half = pts
      .filter((_, i) => i % 2 === 1)
      .map(([X, Y, z]) => 'M' + pj([ni(sx(X, z)), ni(sy(Y, z))]) + 'h.1')
      .join('')
    const line = wire ? `<path d="M${pts.map(([X, Y, z]) => pj([ni(sx(X, z)), ni(sy(Y, z))])).join('L')}" stroke="${C.ink}" stroke-width="${n(Math.max(0.6, w * 0.3))}" opacity=".8"/>` : ''
    return (
      `<g fill="none" stroke="#ffaa58" stroke-linecap="round">${line}` +
      `<path d="${all}" stroke-width="${n(w * 5)}" opacity=".2"/><path d="${all}" stroke-width="${n(w * 2.2)}" opacity=".5"/><path d="${all}" stroke-width="${n(w)}" stroke="#fff0d4"/>` +
      (tw ? `<path class="${tw}" d="${half}" stroke-width="${n(w * 2.8)}" stroke="#ffe2b0" opacity="0"/>` : '') +
      '</g>'
    )
  }
  /** Twinkle: dark at the wrap (as the still asset is), bright twice a period. */
  const twinkle = (T: number, delay: number): string =>
    locked('0%{opacity:0}25%{opacity:.9}50%{opacity:.1}75%{opacity:.7}100%{opacity:0}', T, delay)

  const world: string[] = []
  const far = 600 // still lines are drawn out to here, deep in the fog

  // sky, the town glow on the horizon, the far fog
  world.push(
    `<rect x="-60" y="-60" width="1720" height="${HY + 100}" fill="url(#sk)"/>`,
    `<ellipse cx="${HX}" cy="${HY}" rx="520" ry="120" fill="url(#wl)" opacity=".25"/>`,
    `<ellipse cx="${HX}" cy="${HY - 30}" rx="700" ry="160" fill="url(#fh)" opacity=".8"/>`,
  )

  // the snow: ground, road, kerb banks, the parking lane, tyre tracks (all still)
  {
    const g: string[] = []
    g.push(`<rect x="-60" y="${HY - 6}" width="1720" height="${1066 - HY}" fill="url(#gd)"/>`)
    g.push(`<path d="${gq(-ROAD, ROAD, 3, far)}" fill="url(#pg)"/><path d="${gq(-ROAD + 0.4, ROAD - 0.4, 3, far)}" fill="${C.roadDark}" opacity=".55"/>`)
    g.push(`<path d="${gq(ROAD + 0.2, ROAD + 2.8, 3, far)}" fill="url(#pg)" opacity=".35"/>`) // the parking lane
    g.push(`<g fill="url(#sb)"><path d="${gq(-ROAD - 0.5, -ROAD, 3, far)}"/><path d="${gq(ROAD, ROAD + 0.25, 3, far)}"/><path d="${gq(ROAD + 2.8, ROAD + 3.3, 3, far)}"/></g>`)
    const line = (X: number): string => `M${pj([ni(sx(X, 3)), ni(sy(0, 3))])}L${pj([n(sx(X, far)), n(sy(0, far))])}`
    g.push(`<path d="${[-2.6, -1.1, 1.1, 2.6].map(line).join('')}" stroke="${C.track}" stroke-width="5" opacity=".3"/>`)
    world.push(`<g>${g.join('')}</g>`)
  }

  // building fronts both sides: still planes; the roofline snow; bays ride ladders
  {
    const front = (sg: number): string =>
      poly([
        [sg * WALL, 0, 3],
        [sg * WALL, 0, far],
        [sg * WALL, ROOF, far],
        [sg * WALL, ROOF, 3],
      ])
    const cap = (sg: number): string =>
      poly([
        [sg * WALL, ROOF, 3],
        [sg * WALL, ROOF, far],
        [sg * (WALL - 0.3), ROOF + 0.35, far],
        [sg * (WALL - 0.3), ROOF + 0.35, 3],
      ])
    world.push(`<path d="${front(-1)}" fill="url(#wa)"/><path d="${front(1)}" fill="url(#wb)"/>`, `<path d="${cap(-1)}${cap(1)}" fill="${C.snowHi}" opacity=".5"/>`)
  }

  // ---- facade bays: two kinds per side, alternating every 3.5 m --------------
  const ZB = 14 // reference depth of the bays
  const PB = 7
  const TB = PB / SPEED
  {
    /**
     * One 3.5 m bay of a building front on the wall at side `sg`, from depth z: a
     * pilaster, five floors of windows (`lit`: floor and amber; one may flicker),
     * and a ground-floor shop.
     */
    const bay = (sg: number, z: number, lit: [number, number][], shop: 'cafe' | 'door' | 'bakery', live: boolean, delay: number): string => {
      const X = sg * (WALL - 0.02)
      const u = FOC / (z + 1.6)
      const g: string[] = []
      const dark: string[] = []
      const sill: string[] = []
      g.push(`<path d="${wq(X, z, z + 0.35, 0, ROOF)}" fill="${mix(C.bldg, C.ink, 0.5)}"/>`)
      for (let f = 1; f <= 5; f++) {
        const y0 = 3.1 + (f - 1) * 3 + 0.8
        const L = lit.find(l => l[0] === f)
        const d = wq(X, z + 1, z + 2.4, y0, y0 + 1.6)
        sill.push(wq(X, z + 0.92, z + 2.48, y0 - 0.12, y0))
        if (!L) {
          dark.push(d)
          continue
        }
        const c = AMB[L[1]] ?? AMB[0]
        // a TV or a fire: the window dims and brightens, back as it was at every wrap
        const flick =
          live && f === 2
            ? ` class="${locked('0%{opacity:.85}12%{opacity:.6}27%{opacity:.8}41%{opacity:.55}58%{opacity:.78}73%{opacity:.6}88%{opacity:.82}100%{opacity:.85}', TB, delay)}"`
            : ''
        g.push(`<path${flick} d="${d}" fill="${c}" opacity=".85"/>`)
        g.push(`<path d="${wq(X, z + 1, z + 1.35, y0, y0 + 1.6)}${wq(X, z + 1.7, z + 1.78, y0, y0 + 1.6)}" fill="${C.ink}" opacity=".45"/>`)
        g.push(`<circle cx="${ni(sx(X, z + 1.7))}" cy="${ni(sy(y0 + 0.8, z + 1.7))}" r="${ni(1.7 * u)}" fill="url(#wg)"/>`)
      }
      g.push(`<path d="${dark.join('')}" fill="${C.glassDark}"/><path d="${sill.join('')}" fill="${C.snowHi}" opacity=".55"/>`)
      const ax = sg * (WALL - 0.9)
      if (shop === 'door') {
        g.push(
          `<path d="${wq(X, z + 0.8, z + 2.6, 0.5, 2.5)}" fill="${C.door}"/>`,
          `<path d="${wq(X, z + 1.3, z + 1.5, 0.6, 2.4)}${wq(X, z + 2.0, z + 2.2, 0.6, 2.4)}" fill="${AMB[3]}" opacity=".35"/>`,
          `<path d="${wq(X, z + 2.75, z + 3.25, 0, 2.3)}" fill="${AMB[1]}" opacity=".7"/>`,
          `<circle cx="${ni(sx(X, z + 3))}" cy="${ni(sy(2.6, z + 3))}" r="${ni(0.7 * u)}" fill="url(#lh)"/>`,
        )
      } else {
        // a lit shop window under a snow-topped awning with a garland on its hem
        const zA = z + 0.3
        const zB = z + 3.2
        g.push(
          `<ellipse cx="${ni(sx(sg * (WALL - 1.3), z + 1.7))}" cy="${ni(sy(0, z + 1.7))}" rx="${ni(1.8 * u)}" ry="${ni(0.35 * u)}" fill="url(#lp)" opacity="${shop === 'cafe' ? '.7' : '.45'}"/>`,
          `<path d="${wq(X, z + 0.5, z + 3, 0.5, 2.5)}" fill="url(#cw)"${shop === 'bakery' ? ' opacity=".8"' : ''}/>`,
          `<path d="M${pj([ni(sx(X, z + 1.35)), ni(sy(2.5, z + 1.35))])}V${ni(sy(0.5, z + 1.35))}M${pj([ni(sx(X, z + 2.2)), ni(sy(2.5, z + 2.2))])}V${ni(sy(0.5, z + 2.2))}" stroke="${C.ink}" stroke-width="${n(0.06 * u)}" opacity=".7"/>`,
          `<ellipse cx="${ni(sx(X, z + 1.75))}" cy="${ni(sy(1.5, z + 1.75))}" rx="${ni(2.4 * u)}" ry="${ni(1.6 * u)}" fill="url(#wg)" opacity=".8"/>`,
          `<path d="${poly([
            [X, 3.05, zA],
            [X, 3.05, zB],
            [ax, 2.6, zB],
            [ax, 2.6, zA],
          ])}" fill="${C.snowHi}" opacity=".55"/>`,
          `<path d="${poly([
            [ax, 2.6, zA],
            [ax, 2.6, zB],
            [ax, 2.25, zB],
            [ax, 2.25, zA],
          ])}" fill="${shop === 'cafe' ? '#5a2620' : '#2e3a2c'}"/>`,
        )
        g.push(bulbs(span([ax, 2.22, zA], [ax, 2.22, zB], 0.08, 0.36), Math.max(1.4, 0.06 * u), false, live ? twinkle(TB, delay) : ''))
      }
      return g.join('')
    }
    // parts: the wall strip, the awning, the light on the snow
    const box = (sg: number): P3[][] => [
      [
        [sg * WALL, 0, ZB],
        [sg * WALL, ROOF + 2.5, ZB + 3.5],
      ],
      [
        [sg * WALL, 2.2, ZB + 0.3],
        [sg * (WALL - 0.9), 3.05, ZB + 3.2],
      ],
      [
        [sg * WALL, 0, ZB + 0.5],
        [sg * (WALL - 3.1), 0, ZB + 3],
      ],
    ]
    const kinds: [string, number, [number, number][], 'cafe' | 'door' | 'bakery', number, number][] = [
      ['bays left A', -1, [[1, 0], [2, 2], [4, 4]], 'cafe', 8, 0],
      ['bays left B', -1, [[2, 2], [5, 1]], 'door', 4.5, 0],
      ['bays right C', 1, [[1, 4], [2, 1], [5, 2]], 'bakery', 8, -0.6],
      ['bays right D', 1, [[2, 2], [3, 0], [4, 3]], 'door', 4.5, -0.6],
    ]
    kinds.forEach(([name, sg, lit, shop, z0, delay], i) => {
      const id = 'b' + 'abcd'.charAt(i)
      asset(id, bay(sg, ZB, lit, shop, false, delay))
      world.push(ladder({ name, id, parts: box(sg), zr: ZB, P: PB, speed: SPEED, z0, zMax: 48, delay, live: bay(sg, ZB, lit, shop, true, delay), liveN: 1 }))
    })
    // smoke from the café blocks' chimneys, seen only far off (nearer, the roofs
    // are above the frame): every instance live, each puff unseen at the wrap
    const cx = sx(-WALL + 1.2, ZB + 1.5)
    const cy = sy(ROOF + 1.2, ZB + 1.5)
    const puff = locked(
      `0%{transform:translate(0,0) scale(.5);opacity:0}18%{transform:translate(-4px,-14px) scale(.75);opacity:.8}100%{transform:translate(-22px,-96px) scale(1.9);opacity:0}`,
      TB,
      0,
      org(cx, cy),
    )
    world.push(
      ladder({
        name: 'chimney smoke left',
        id: '',
        parts: [[[-WALL + 0.4, ROOF + 0.8, ZB + 1.5], [-WALL + 2.2, ROOF + 4.5, ZB + 1.5]]],
        zr: ZB,
        P: PB,
        speed: SPEED,
        z0: 8 + 2 * PB,
        zMax: 57,
        delay: 0,
        live: `<ellipse class="${puff}" cx="${n(cx)}" cy="${n(cy)}" rx="16" ry="12" fill="url(#sm)"/>`,
        liveN: 9,
      }),
    )
  }

  // ---- the lamps (both sides at the same depths), their pools on the snow, and
  // marks in the snow streaming toward the camera ----------------------------
  const PL = 8
  const TL = PL / SPEED
  const ZL = 12 // reference depth of the lamps and the marks
  const LAMP_L = -4.9
  const LAMP_R = 6.6
  {
    const g: string[] = []
    for (const X of [LAMP_L, LAMP_R]) {
      const hx = sx(X + (X < 0 ? 0.65 : -0.65), ZL)
      g.push(`<ellipse cx="${ni(hx)}" cy="${ni(sy(0, ZL))}" rx="${ni((2.6 * FOC) / ZL)}" ry="${ni((0.5 * FOC) / ZL)}" fill="url(#lp)"/>`)
    }
    g.push(`<path d="${gq(-0.1, 0.1, ZL + 1, ZL + 3)}${gq(-0.1, 0.1, ZL + 5, ZL + 7)}" fill="${C.snowHi}" opacity=".1"/>`)
    for (const [X, z, r] of [
      [-3.3, ZL + 2.5, 0.35],
      [3.4, ZL + 0.6, 0.3],
      [-2.0, ZL + 6.2, 0.3],
    ] as const) {
      g.push(`<ellipse cx="${n(sx(X, z))}" cy="${n(sy(0, z))}" rx="${n((r * FOC) / z)}" ry="${n((r * FOC) / z / 3.5)}" fill="${C.snowHi}" opacity=".14"/>`)
    }
    asset('gm', g.join(''))
    world.push(
      ladder({ name: 'lamp pools and snow marks', id: 'gm', parts: [[[-7.6, 0, ZL - 0.5], [9.3, 0, ZL + 8]]], zr: ZL, P: PL, speed: SPEED, z0: 3.2, zMax: 60, delay: 0 }),
    )
  }

  // ---- parked cars on the right, snowed in -----------------------------------
  const ZC = 18
  const CAR_X = ROAD + 0.8
  const car = (() => {
    const T = { L: 4.5, W: 1.8, hb: 0.86, c0: 1.05, c1: 3.05, top: 1.42, inset: 0.16 }
    const X0 = CAR_X
    const x1 = X0 + T.W
    const z0 = ZC
    const z1 = z0 + T.L
    const u = FOC / (z0 + 1.5)
    const cs = z0 + T.c0
    const ce = z0 + T.c1
    const ci0 = X0 + T.inset
    const ci1 = x1 - T.inset
    const sp: string[] = []
    sp.push(`<path d="${blob(X0 - 0.25, x1 + 0.15, 0, 0, z0 - 0.3, z1 + 0.25, 1)}" fill="${C.shadow}" opacity=".35"/>`)
    sp.push(`<path d="${blob(X0, x1, 0.2, T.hb, z0, z1, 0.55)}" fill="${C.carBody}"/>`)
    for (const zw of [z0 + 0.8, z1 - 0.85]) {
      const rx = (sx(X0, zw - 0.36) - sx(X0, zw + 0.36)) / 2
      sp.push(`<ellipse cx="${ni(sx(X0, zw))}" cy="${ni(sy(0.3, zw))}" rx="${ni(Math.abs(rx))}" ry="${ni(0.3 * u)}" fill="${C.glassDark}"/>`)
    }
    for (const [a, b] of [
      [X0 + 0.12, X0 + 0.42],
      [x1 - 0.42, x1 - 0.12],
    ] as const) {
      sp.push(`<path d="${blob(a, b, 0.6, 0.74, z0 - 0.02, z0 - 0.01, 0.6)}" fill="#d4432f" opacity=".8"/>`)
    }
    sp.push(`<path d="${blob(X0 + 0.04, x1 - 0.04, T.hb - 0.02, T.hb + 0.12, ce - 0.1, z1 - 0.06, 1)}" fill="${C.carSnow}"/>`)
    sp.push(`<path d="${blob(ci0, ci1, T.hb - 0.05, T.top, cs, ce, 0.5)}" fill="${mix(C.carBody, C.carGlass, 0.5)}"/>`)
    // the side and rear windows, dark glass: what makes it read as a car
    sp.push(`<path d="${blob(ci0 - 0.01, ci0, T.hb + 0.1, T.top - 0.1, cs + 0.25, ce - 0.3, 0.5)}" fill="${C.carGlass}"/>`)
    sp.push(`<path d="${blob(ci0 + 0.1, ci1 - 0.1, T.hb + 0.07, T.top - 0.08, cs - 0.02, cs - 0.01, 0.5)}" fill="${C.carGlass}"/>`)
    sp.push(`<path d="${blob(ci0 + 0.05, ci1 - 0.05, T.top - 0.04, T.top + 0.16, cs + 0.05, ce - 0.05, 1)}" fill="${C.carSnow}"/>`)
    sp.push(`<path d="${blob(X0 + 0.04, x1 - 0.04, T.hb - 0.02, T.hb + 0.11, z0 + 0.05, cs + 0.05, 1)}" fill="${C.carSnow}"/>`)
    return { body: sp.join(''), box: [[X0 - 0.25, 0, z0 - 0.3], [x1 + 0.15, T.top + 0.2, z1 + 0.25]] as P3[] }
  })()
  asset('car', car.body)

  // ---- street trees on the left, small lit firs on the right ------------------
  const ZT = 12
  const PT = 8
  const TT = PT / SPEED
  const tree = (live: boolean): string => {
    R = mulberry32(SEED + 3)
    type Acc = { lv: string[][]; snow: string[][]; w0: number }
    const X = -6.8
    const z = ZT
    const hM = 11
    const depth = 4
    const bias = -0.12 // leaning out, away from the middle of the picture
    const u = FOC / z
    const bx = sx(X, z)
    const by = sy(0, z)
    const w0 = 0.3 * u * rnd(0.85, 1.15)
    const acc: Acc = { lv: [[], [], [], [], [], [], []], snow: [[], [], []], w0 }
    const branch = (x: number, y: number, ang: number, len: number, lev: number): void => {
      const ex = x + Math.sin(ang) * len
      const ey = y - Math.cos(ang) * len
      const bend = rnd(-0.14, 0.14)
      const cx = (x + ex) / 2 + Math.cos(ang) * len * bend
      const cy = (y + ey) / 2 + Math.sin(ang) * len * bend
      const q = 'q' + pj([ni(cx - x), ni(cy - y), ni(ex - x), ni(ey - y)])
      acc.lv[lev]?.push('M' + pj([ni(x), ni(y)]) + q)
      if (lev <= 2 && Math.abs(ang) > 0.4) {
        const o = acc.w0 * Math.pow(0.58, lev) * 0.32
        const nx = ang > 0 ? -Math.cos(ang) : Math.cos(ang)
        const ny = ang > 0 ? -Math.sin(ang) : Math.sin(ang)
        acc.snow[lev]?.push('M' + pj([ni(x + nx * o), ni(y + ny * o)]) + q)
      }
      if (lev >= depth) return
      const k = lev === 1 ? 2 + (R() < 0.6 ? 1 : 0) : 2 + (R() < 0.35 ? 1 : 0)
      const spread = lev === 1 ? 0.55 : 0.48
      for (let i = 0; i < k; i++) {
        const t = k === 1 ? 0 : (i / (k - 1) - 0.5) * 2
        let na = ang * 0.88 + t * spread * rnd(0.6, 1.15) + rnd(-0.12, 0.12) + bias * 0.3
        na = Math.max(-1.35, Math.min(1.35, na))
        const at = rnd(0.55, 1)
        branch(x + (ex - x) * at, y + (ey - y) * at, na, len * rnd(0.6, 0.78), lev + 1)
      }
    }
    const forkF = rnd(0.3, 0.45)
    const trunkH = hM * forkF * u
    const fx = bx + bias * 0.22 * trunkH
    const fy = by - trunkH
    const L = hM * u * rnd(0.26, 0.3) * (1.2 - forkF * 0.6)
    for (let i = 0; i < 3; i++) {
      const t = (i / 2 - 0.5) * 2
      branch(fx, fy + rnd(0, 0.2) * trunkH, t * rnd(0.3, 0.5) + bias, L * rnd(0.85, 1.1), 1)
    }
    const parts: string[] = []
    acc.lv.forEach((segs, lev) => {
      if (lev === 0 || segs.length === 0) return
      parts.push(`<path d="${segs.join('')}" stroke-width="${n(Math.max(0.5, w0 * Math.pow(0.58, lev)))}"${lev === depth ? ' opacity=".7"' : ''}/>`)
    })
    acc.snow.forEach((segs, lev) => {
      if (!segs.length) return
      const d = u * Math.pow(0.7, lev - 1)
      parts.push(
        `<path d="${segs.join('')}" stroke="${C.snowHi}" stroke-width="${n(w0 * Math.pow(0.58, lev) * 0.3)}" stroke-dasharray="${[0.9, 0.5, 0.5, 0.7].map(v => n(v * d)).join(' ')}" opacity=".45"/>`,
      )
    })
    // the crown stirs once a period and is still at every wrap
    const sw = live ? ` class="${locked('0%{transform:rotate(0)}25%{transform:rotate(.6deg)}75%{transform:rotate(-.6deg)}100%{transform:rotate(0)}', TT, 0, org(fx, fy))}"` : ''
    return (
      `<g fill="none" stroke-linecap="round" stroke="${mix(C.ink, C.fog, 0.12)}"><path d="M${pj([ni(bx), ni(by)])}Q${pj([ni(bx), ni(by - trunkH * 0.5), ni(fx), ni(fy)])}" stroke-width="${n(w0)}"/>` +
      `<g${sw}>${parts.join('')}</g></g>`
    )
  }
  const FIR_X = 8.6
  const fir = (live: boolean): string => {
    const X = FIR_X
    const z = ZT
    const fu = (FOC / z) * 0.68
    const bx = sx(X, z)
    const by = sy(0, z)
    const tiers: string[] = []
    const snow: string[] = []
    for (let i = 0; i < 4; i++) {
      const top = by - (1.1 + i * 0.62) * fu - 0.55 * fu
      const bot = by - (0.25 + i * 0.6) * fu
      const half = (1.05 - i * 0.2) * fu
      tiers.push(`M${ni(bx)} ${ni(top)}L${ni(bx + half)} ${ni(bot)}q-${ni(half)} ${ni(0.18 * fu)}-${ni(2 * half)} 0z`)
      snow.push(`M${ni(bx - half * 0.8)} ${ni(bot - 0.12 * fu)}q${ni(half * 0.8)}-${ni(0.12 * fu)} ${ni(half * 1.6)} 0`)
    }
    const helix: P3[] = []
    for (let t = 0.04; t < 0.96; t += 0.03) {
      const a = t * 4.6 * Math.PI * 2
      const r = (1 - t * 0.92) * 0.68
      if (Math.cos(a) < -0.1) continue // the far side is hidden by the tree
      helix.push([X + r * Math.sin(a), (0.35 + t * 2.75) * 0.68, z - r * Math.cos(a) * 0.4])
    }
    return (
      `<path d="M${ni(bx)} ${ni(by)}v-${ni(0.4 * fu)}" stroke="${C.ink}" stroke-width="${ni(0.16 * fu)}"/>` +
      `<path d="${tiers.join('')}" fill="${C.fir}"/>` +
      `<path d="${snow.join('')}" stroke="${C.snowHi}" stroke-width="${n(0.07 * fu)}" fill="none" stroke-linecap="round" opacity=".7"/>` +
      bulbs(helix, Math.max(1.3, 0.06 * fu), false, live ? twinkle(TT, -0.8) : '') +
      `<circle cx="${ni(bx)}" cy="${ni(by - 3.25 * fu)}" r="${ni(0.8 * fu)}" fill="url(#lh)"/><circle cx="${ni(bx)}" cy="${ni(by - 3.25 * fu)}" r="${n(0.1 * fu)}" fill="#ffe2b0"/>`
    )
  }
  /** A street lamp at X (arm toward the road), its halo, a garland to the wall. */
  const lamp = (X: number, live: boolean): string => {
    const z = ZL
    const u = FOC / z
    const s = X < 0 ? 1 : -1
    const hx = sx(X + 0.65 * s, z)
    const hy = sy(5.5, z)
    const wallX = X < 0 ? -WALL : WALL
    return (
      `<path d="M${pj([ni(sx(X, z)), ni(sy(0, z))])}V${ni(sy(5.7, z))}q${pj([ni(s * 0.05 * u), ni(-0.35 * u), ni(s * 0.65 * u), ni(0.15 * u)])}" stroke="${C.ink}" stroke-width="${n(0.13 * u)}" fill="none"/>` +
      bulbs(span([X, 5.75, z], [wallX, 6.6, z], 0.5, 0.32), Math.max(1.2, 0.06 * u), true, live ? twinkle(TL, 0) : '') +
      `<circle cx="${ni(hx)}" cy="${ni(hy)}" r="${ni(1.6 * u)}" fill="url(#lg)"/>` +
      `<ellipse cx="${ni(hx)}" cy="${ni(hy - 0.05 * u)}" rx="${n(0.22 * u)}" ry="${n(0.09 * u)}" fill="${LAMP}"/>` +
      `<circle cx="${ni(hx)}" cy="${ni(hy)}" r="${ni(0.75 * u)}" fill="url(#lh)"/>`
    )
  }
  // parts of a lamp: post and garland to the wall, the halo round the head
  const lampParts = (X: number): P3[][] => {
    const s = X < 0 ? 1 : -1
    const h = X + 0.65 * s
    return [
      [
        [X, 0, ZL],
        [X < 0 ? -WALL : WALL, 6.6, ZL],
      ],
      [
        [h - 1.6, 5.5 - 1.6, ZL],
        [h + 1.6, 5.5 + 1.6, ZL],
      ],
    ]
  }
  asset('tl', tree(false))
  asset('fr', fir(false))
  asset('ll', lamp(LAMP_L, false))
  asset('lr', lamp(LAMP_R, false))

  // ---- people: each walker a ladder of their own, overtaken (speed - walk) or
  // coming past (speed + walk); a ladder's period is a whole number of strides
  const G = (() => {
    const lin = (s: [number, string][], extra: string): string => an(stops(s), GT, 0, 'linear', false, extra)
    return {
      bob: lin(bobStops(2, 2.5), ''),
      legA: lin(legStops, org(-7, -84)),
      legB: lin(shift(legStops, 50), org(7, -84)),
      shA: lin(shinStops, org(-7, -46)),
      shB: lin(shift(shinStops, 50), org(7, -46)),
      soA: lin(soleStops, ''),
      soB: lin(shift(soleStops, 50), ''),
      torso: lin(
        [
          [0, 'transform:rotate(0)'],
          [25, 'transform:rotate(1.2deg)'],
          [50, 'transform:rotate(0)'],
          [75, 'transform:rotate(-1.2deg)'],
          [100, 'transform:rotate(0)'],
        ],
        org(0, -84),
      ),
      hem: an('from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}', GT / 2, 0, 'ease-in-out', true, org(0, -100)),
      armL: lin(armLStops, org(-15, -137)),
      armR: lin(armRStops, org(15, -137)),
      scarf: an(
        stops([
          [0, 'transform:rotate(-4deg)'],
          [30, 'transform:rotate(6deg)'],
          [55, 'transform:rotate(-1deg)'],
          [80, 'transform:rotate(7deg)'],
          [100, 'transform:rotate(-4deg)'],
        ]),
        2 * GT,
        0,
        'linear',
        false,
        org(-5, -141),
      ),
      wLegA: lin(legStops, org(-6, -84)),
      wLegB: lin(shift(legStops, 50), org(6, -84)),
      wArmL: lin(armLStops, org(-14, -136)),
      wArmR: lin(armRStops, org(14, -136)),
    }
  })()
  const girlRig = (live: boolean): string => {
    const k = (c: string): string => (live ? ` class="${c}"` : '')
    const c = {
      coat: '#4e4740',
      coatSh: '#3d3732',
      belt: '#2a2521',
      tights: '#1f1d1c',
      boot: '#171514',
      sole: '#4a443f',
      hair: '#2a2420',
      hat: '#8a8178',
      brim: '#7a7268',
      pom: '#a39a8e',
      scarf: '#7a3329',
      bag: '#2a2420',
      mitt: '#6e2f28',
      rim: '#9a8a76',
    }
    const leg = (x: number, L: string, Sh: string, So: string): string =>
      `<g${k(L)}><path d="M${x}-84v40" stroke="${c.tights}" stroke-width="9" ${RC}/>` +
      `<g${k(Sh)}><path d="M${x}-46v8" stroke="${c.tights}" stroke-width="8"/>` +
      `<path d="M${x - 5}-41h10v37q0 4-5 4t-5-4z" fill="${c.boot}"/>` +
      `<ellipse${k(So)} cx="${x}" cy="-1.5" rx="5" ry="2" fill="${c.sole}"${live ? '' : ' opacity="0"'}/></g></g>`
    const arm = (s: number, A: string): string =>
      `<g${k(A)}><path d="M${15 * s}-137q${5 * s} 18 ${3 * s} 38" stroke="${c.coatSh}" stroke-width="8" fill="none" ${RC}/>` +
      `<circle cx="${18 * s}" cy="-97" r="3.6" fill="${c.mitt}"/></g>`
    return (
      `<ellipse rx="30" ry="6" fill="${C.shadow}" opacity=".4"/>` +
      `<g${k(G.bob)}>` +
      leg(-7, G.legA, G.shA, G.soA) +
      leg(7, G.legB, G.shB, G.soB) +
      `<g${k(G.torso)}>` +
      `<g${k(G.hem)}><path d="M-14-101h28l8 45q-22 5-44 0z" fill="${c.coat}"/><path d="M4-98l2 40" stroke="${c.coatSh}" stroke-width="1.5"/></g>` +
      `<path d="M-16-141q16-5 32 0l-2 42h-28z" fill="${c.coat}"/>` +
      `<path d="M-14-101h28" stroke="${c.belt}" stroke-width="3.5"/>` +
      arm(-1, G.armL) +
      arm(1, G.armR) +
      `<path d="M-11-141L15-100" stroke="${c.bag}" stroke-width="2"/>` +
      `<rect x="11" y="-101" width="13" height="11" rx="2.5" fill="${c.bag}"/>` +
      `<path d="M-16-139l-2 38-7 44" stroke="${c.rim}" stroke-width="1.2" fill="none" opacity=".45"/>` +
      `<ellipse cy="-142" rx="11" ry="4.5" fill="${c.scarf}"/>` +
      `<path d="M-11-150q0 18 2 19h18q2-1 2-19z" fill="${c.hair}"/>` +
      `<g${k(G.scarf)}><path d="M-6-141q-2 14 1 28l5-1q-2-13 0-27z" fill="${c.scarf}"/></g>` +
      `<path d="M-10.5-154q0-16 10.5-16t10.5 16z" fill="${c.hat}"/>` +
      `<rect x="-11" y="-157" width="22" height="5" rx="2.5" fill="${c.brim}"/>` +
      `<circle cy="-171" r="5" fill="${c.pom}"/>` +
      `</g></g>`
    )
  }
  /** A walker (back or front view: the same at this size): coat, hat, scarf. */
  const walkerRig = (col: string, hat: string, scarf: string, live: boolean): string => {
    const k = (c: string): string => (live ? ` class="${c}"` : '')
    const dk = mix(col, C.ink, 0.45)
    return (
      `<ellipse rx="26" ry="5" fill="${C.shadow}" opacity=".4"/>` +
      `<g${k(G.bob)}>` +
      `<g stroke="${C.ink}" stroke-width="10" ${RC}><path${k(G.wLegA)} d="M-6-84v80"/><path${k(G.wLegB)} d="M6-84v80"/></g>` +
      `<path d="M-15-141q15-5 30 0l6 80h-42z" fill="${col}"/>` +
      `<g stroke="${dk}" stroke-width="8" fill="none" ${RC}><path${k(G.wArmL)} d="M-14-136q-5 18-3 38"/><path${k(G.wArmR)} d="M14-136q5 18 3 38"/></g>` +
      (scarf ? `<ellipse cy="-141" rx="11" ry="4.5" fill="${scarf}"/>` : '') +
      `<circle cy="-152" r="10" fill="#2a2420"/><path d="M-10.5-154q0-15 10.5-15t10.5 15z" fill="${hat}"/>` +
      `</g>`
    )
  }
  const ZP = 14
  const people: { id: string; name: string; X: number; rig: (live: boolean) => string; toward: boolean; strides: number; delay: number; liveN: number; side: -1 | 0 | 1 }[] = [
    { id: 'pa', name: 'girl, lane, walking away', X: -1.3, rig: girlRig, toward: false, strides: 6, delay: -2.2, liveN: 2, side: 0 },
    { id: 'pb', name: 'left pavement, walking away', X: -6.55, rig: l => walkerRig('#4a3a2c', '#2a2420', '#8a3a30', l), toward: false, strides: 5, delay: -4.4, liveN: 2, side: -1 },
    { id: 'pc', name: 'right pavement, coming past', X: 7.2, rig: l => walkerRig('#5b2b25', '#cfc4b4', '', l), toward: true, strides: 3, delay: -1.1, liveN: 2, side: 1 },
    {
      id: 'pd',
      name: 'left pavement pair, coming past',
      X: -6.1,
      rig: l => walkerRig('#2c2b2a', '#7a2f28', '#c9bfb1', l) + `<g transform="translate(75 0) scale(.95)">${walkerRig('#5d5248', '#2a2420', '', l)}</g>`,
      toward: true,
      strides: 3,
      delay: -3.3,
      liveN: 2,
      side: -1,
    },
    { id: 'pe', name: 'right pavement, walking away', X: 7.6, rig: l => walkerRig('#3a3533', '#b3a898', '#6e2f28', l), toward: false, strides: 6, delay: -6.6, liveN: 2, side: 1 },
    { id: 'pf', name: 'lane, coming past', X: 1.6, rig: l => walkerRig('#4e4740', '#2a2420', '#7a3329', l), toward: true, strides: 4, delay: -4.4, liveN: 2, side: 0 },
  ]
  const placeP = (X: number, body: string): string => `<g transform="translate(${n(sx(X, ZP))} ${n(sy(0, ZP))}) scale(${nd(FOC / (100 * ZP), 3)})">${body}</g>`
  for (const p of people) asset(p.id, placeP(p.X, p.rig(false)))
  const walkers = (side: -1 | 0 | 1): string =>
    people
      .filter(p => p.side === side)
      // outermost first: where two walkers on a pavement overlap, the outer one is the farther
      .sort((a, b) => Math.abs(b.X) - Math.abs(a.X))
      .map(p => {
        const rel = p.toward ? SPEED + WALK : SPEED - WALK
        // a whole number of two-stride loops per period: the legs are in step at every wrap
        const T = p.strides * 2 * GT
        return ladder({
          name: p.name,
          id: p.id,
          parts: [
            [
              [p.X - 0.4, 0, ZP],
              [p.X + 1.2, 1.85, ZP],
            ],
          ],
          zr: ZP,
          P: T * rel,
          speed: rel,
          z0: 11,
          zMax: 60,
          delay: p.delay,
          live: placeP(p.X, p.rig(true)),
          liveN: p.liveN,
        })
      })
      .join('')

  // ---- assemble, far things and low things first; where two ladders can
  // overlap, the one whose overlaps are always the nearer is drawn later
  world.push(
    ladder({
      name: 'trees left',
      id: 'tl',
      parts: [
        [
          [-WALL, 0.5, ZT],
          [-4.2, 13, ZT],
        ],
      ],
      zr: ZT,
      P: PT,
      speed: SPEED,
      z0: 4.3,
      zMax: 54,
      delay: 0,
      live: tree(true),
      liveN: 1,
    }),
    ladder({
      name: 'lit firs right',
      id: 'fr',
      parts: [
        [
          [FIR_X - 0.8, 0, ZT],
          [FIR_X + 0.8, 2.6, ZT],
        ],
      ],
      zr: ZT,
      P: PT,
      speed: SPEED,
      z0: 9.5,
      zMax: 54,
      delay: -0.8,
      live: fir(true),
      liveN: 1,
    }),
    walkers(-1),
    walkers(1),
    ladder({ name: 'lamps left', id: 'll', parts: lampParts(LAMP_L), zr: ZL, P: PL, speed: SPEED, z0: 3.2, zMax: 60, delay: 0, live: lamp(LAMP_L, true), liveN: 1 }),
    ladder({ name: 'lamps right', id: 'lr', parts: lampParts(LAMP_R), zr: ZL, P: PL, speed: SPEED, z0: 3.2, zMax: 60, delay: 0, live: lamp(LAMP_R, true), liveN: 1 }),
    ladder({ name: 'parked cars', id: 'car', parts: [car.box], zr: ZC, P: 9, speed: SPEED, z0: 8.6, zMax: 52, delay: -0.9 }),
    walkers(0),
  )

  // the fog over the far street (still: things brighten as they come out of it)
  world.push(`<ellipse cx="${HX}" cy="${HY + 12}" rx="600" ry="300" fill="url(#fo)"/>`)
  // the reply text layer is spliced in here by sceneWith (in front of the fog)
  world.push(TEXT_MARK)

  // snow streaming past: flake fields riding a ladder, out from the vanishing point
  {
    const ZS = 8
    R = mulberry32(SEED + 11)
    const d: string[] = []
    const flakes: P3[][] = []
    for (let i = 0; i < 70; i++) {
      const X = rnd(-14, 14)
      const Y = rnd(0, 18)
      if (Math.abs(X) < 2.4 && Y > 7 && Y < 10.4) continue // these would not leave the frame
      d.push('M' + pj([ni(sx(X, ZS)), ni(sy(Y, ZS))]) + 'h.1')
      flakes.push([[X, Y, ZS]])
    }
    asset('sf', `<path d="${d.join('')}"/>`, ` fill="none" stroke="${C.flake}" stroke-linecap="round" stroke-width="3" opacity=".5"`)
    world.push(ladder({ name: 'snow streaming past', id: 'sf', parts: flakes, zr: ZS, P: 6, speed: SPEED, z0: 2.4, zMax: 30, delay: 0 }))
  }

  // falling snow, five depths
  for (let i = 0; i < SNOW.length; i++) {
    const L = SNOW[i]
    if (!L) continue
    R = mulberry32(SEED + 101 * (i + 1))
    const subs: string[] = []
    for (let k = 0; k < 3; k++) {
      const id = `s${i}${k}`
      const cnt = Math.round(L.n / 3)
      const [r0 = 1, r1 = 2] = L.r
      const [o0 = 0.4, o1 = 0.6] = L.op
      let content = ''
      if (!L.bokeh) {
        const buckets: number[][][] = [[], [], []]
        for (let j = 0; j < cnt; j++) {
          const b = Math.floor(R() * 3)
          buckets[b]?.push([Math.round(rnd(-150, 1750)), Math.round(rnd(-150, 1150))])
        }
        // relative moves from dot to dot, left to right (each h.1 drifts a dot .1 px: harmless)
        content = buckets
          .map(list => {
            let px = 0
            let py = 0
            return list
              .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
              .map(([x = 0, y = 0], j) => {
                const m = j ? 'm' + pj([ni(x - px), ni(y - py)]) : 'M' + pj([ni(x), ni(y)])
                px = x
                py = y
                return m + 'h.1'
              })
          })
          .map((dd, b) => {
            const r = r0 + ((r1 - r0) * (b + 0.5)) / 3
            const o = o0 + (o1 - o0) * (b === 1 ? 0.8 : b === 0 ? 0.2 : 0.5)
            return `<path d="${dd.join('')}" stroke-width="${n(2 * r)}" opacity="${o2(o)}"/>`
          })
          .join('')
      } else {
        const buckets: string[][] = [[], []]
        for (let j = 0; j < cnt; j++) {
          buckets[j % 2]?.push(`<circle cx="${ni(rnd(-150, 1750))}" cy="${ni(rnd(-150, 1150))}" r="${n(rnd(r0, r1))}"/>`)
        }
        content = buckets.map((c, b) => `<g opacity="${o2(b ? o1 : o0)}">${c.join('')}</g>`).join('')
      }
      const sd = L.sd[k] ?? 9
      const sway = an(`from{transform:translateX(${-L.sway}px)}to{transform:translateX(${L.sway}px)}`, sd, -rnd(0, sd))
      const fall = an(`to{transform:translateY(${TILE_H}px)}`, L.fall, -rnd(0, L.fall), 'linear', false)
      subs.push(`<g class="${sway}"><g class="${fall}"><g id="${id}">${content}</g><use href="#${id}" y="-${TILE_H}"/></g></g>`)
    }
    const paint = L.bokeh ? 'fill="url(#bk)"' : `fill="none" stroke="${C.flake}" stroke-linecap="round"`
    world.push(`<g transform="rotate(${L.ang} 800 500)" ${paint}>${subs.join('')}</g>`)
  }

  // The reply's rows sway on their wires (classes made here, used by textLayer).
  R = mulberry32(SEED + 17)
  const textCls = TXT_ROWS_GEO.map((r, i) => {
    const dur = 7 + ((i * 1.7) % 5) + rnd(0, 0.6)
    return an(
      'from{transform:translateY(-1.5px) rotate(-.5deg)}to{transform:translateY(1.5px) rotate(.5deg)}',
      dur,
      -rnd(0, dur),
      'ease-in-out',
      true,
      org((r.x0 + r.x1) / 2, r.y0 + (TXT_SAG * FOC) / r.z),
    )
  })

  // The whole street sways a little, like a drone holding its line in the wind.
  const sway = an('from{transform:translate(-5px,2px) rotate(-.12deg)}to{transform:translate(5px,-2px) rotate(.12deg)}', 11, -3, 'ease-in-out', true, org(800, 500))
  const out = `<g class="${sway}">${world.join('')}</g><rect width="1600" height="1000" fill="url(#vg)"/><rect y="800" width="1600" height="200" fill="url(#vb)"/>`

  css.push('@media (prefers-reduced-motion:reduce){*{animation-play-state:paused!important}}')
  const STATIC =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style="--t:${T_MARK}s">` +
    `<style>${css.join('')}</style>` +
    `<defs>${defs.join('')}</defs>` +
    out +
    '</svg>'
  const [HEAD = '', REST = ''] = STATIC.split(T_MARK)
  const [MID = '', TAIL = ''] = REST.split(TEXT_MARK)
  return { HEAD, MID, TAIL, notes, textCls }
}

// ============================== reply text layer ===========================
// The latest reply hangs over the street as rows of pale letters strung on thin
// wires between the building fronts, each row deeper than the last. The rows
// keep their distance ahead of the drone (they fly with it), and their wires
// end on the still wall planes.

const TEXT_MARK = '%%TEXT%%'
const T_MARK = '%%T%%'
const TXT_ROWS = 6
const TXT_COLS = 34
const TXT_Z = [14, 17, 21, 26, 33, 42] // row depths, m
const TXT_TOP_Y = 80 // screen y of row 1's wire ends
const TXT_Y = CAM + ((HY - TXT_TOP_Y) * (TXT_Z[0] ?? 16)) / FOC // world height of every wire
const TXT_SAG = 0.5 // wire sag at mid-span, m
const TXT_OP = [0.55, 0.5, 0.47, 0.44, 0.41, 0.38]

type TxtRow = { z: number; x0: number; x1: number; y0: number; cy: number; cx: number; f: number; op: number }

/** Row geometry, solved once: the largest font ∝ 1/√z (far rows stay legible) whose rows don't overlap. */
const TXT_ROWS_GEO: TxtRow[] = (() => {
  const base = TXT_Z.map(z => {
    const x0 = sx(-WALL, z)
    const x1 = sx(WALL, z)
    const y0 = sy(TXT_Y, z)
    const sag = (TXT_SAG * FOC) / z
    const cx = sx(0, z)
    return { z, x0, x1, y0, cy: y0 + 2 * sag, cx, wy: y0 + sag }
  })
  // a row spans [wy + .15f, wy + 1.12f] (threads, then cap height to descender)
  let K = 200
  for (; K > 10; K -= 0.5) {
    let ok = true
    for (let i = 0; i + 1 < base.length; i++) {
      const a = base[i]
      const b = base[i + 1]
      if (a && b && a.wy + (1.12 * K) / Math.sqrt(a.z) > b.wy + (0.15 * K) / Math.sqrt(b.z) - 2) ok = false
    }
    if (ok) break
  }
  return base.map((r, i) => ({ z: r.z, x0: r.x0, x1: r.x1, y0: r.y0, cy: r.cy, cx: r.cx, f: K / Math.sqrt(r.z), op: TXT_OP[i] ?? 0.4 }))
})()

/** Plain text from a markdown-ish reply: no code, links, URLs, markers, controls or emoji. */
function cleanText(raw: string): string {
  let t = String(raw).normalize('NFC')
  t = t.replace(/(```|~~~)[\s\S]*?(\1|$)/g, ' ') // fenced code blocks
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images: keep the label
  t = t.replace(/\b(?:https?|ftp|file|mailto):\/*[^\s)]+/gi, ' ') // URLs
  t = t.replace(/\bwww\.[^\s)]+/gi, ' ')
  t = t.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '') // list bullets
  t = t.replace(/[`#*_>|~]/g, '') // inline code ticks and markdown markers
  t = t.replace(/[\uD800-\uDFFF]/g, '') // non-BMP (emoji) and stray surrogates
  t = t.replace(/[\u2600-\u27BF\u2B00-\u2BFF\uFE00-\uFE0F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF0-\uFFFF]/g, '') // emoji-ish symbols, invisible and bidi controls
  t = t.replace(/[\u0300-\u036F\u061C\u20D0-\u20FF]/g, '') // loose combining marks, which stack, and a bidi mark
  t = t.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // controls (newlines become spaces)
  return t.replace(/\s+/g, ' ').trim()
}

/** Word-wrap into at most TXT_ROWS rows of TXT_COLS; "…" ends the last row if cut. */
function wrapRows(t: string): string[] {
  const words: string[] = []
  for (const w of t.split(' ')) {
    if (!w) continue
    for (let i = 0; i < w.length; i += TXT_COLS) words.push(w.slice(i, i + TXT_COLS))
  }
  const rows: string[] = []
  let cur = ''
  let cut = false
  for (const w of words) {
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= TXT_COLS) cur += ' ' + w
    else {
      rows.push(cur)
      cur = w
      if (rows.length === TXT_ROWS) {
        cut = true
        break
      }
    }
  }
  if (!cut && cur) rows.push(cur)
  if (cut) {
    const last = (rows[TXT_ROWS - 1] ?? '').slice(0, TXT_COLS - 1).replace(/ $/, '')
    rows[TXT_ROWS - 1] = last + '…'
  }
  return rows.slice(0, TXT_ROWS)
}

const xmlEsc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function textLayer(text: string, C: Pal, rowCls: string[]): string {
  const rows = wrapRows(cleanText(text))
  if (!rows.length) return ''
  const wireCol = mix(C.ink, C.shadow, 0.3)
  const parts: string[] = []
  // far rows first, so nearer rows sit in front
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = TXT_ROWS_GEO[i]
    const row = rows[i]
    if (!r || row === undefined) continue
    const wy = (x: number): number => {
      const t = (x - r.x0) / (r.x1 - r.x0)
      return r.y0 + 2 * t * (1 - t) * (r.cy - r.y0)
    }
    const top = wy(r.cx) + 0.15 * r.f
    const base = top + 0.75 * r.f
    const half = row.length * 0.31 * r.f // ~.58em per glyph + .04em spacing
    const tx = row.length > 14 ? [-0.8, 0, 0.8] : [-0.7, 0.7]
    const threads = tx.map(k => 'M' + pj([n(r.cx + k * half), n(wy(r.cx + k * half))]) + 'V' + n(top + 0.05 * r.f)).join('')
    const e = xmlEsc(row)
    const d = 0.015 * r.f
    parts.push(
      `<g class="${rowCls[i] ?? ''}" opacity="${o2(r.op)}">` +
        `<path d="M${pj([n(r.x0), n(r.y0)])}Q${pj([n((r.x0 + r.x1) / 2), n(r.cy), n(r.x1), n(r.y0)])}${threads}" stroke="${wireCol}" stroke-width="${n(Math.max(0.6, 19 / r.z))}" fill="none" opacity=".45"/>` +
        `<text x="${n(r.cx + d)}" y="${n(base + d)}" font-size="${n(r.f)}" fill="${C.txtEdge}" opacity=".4">${e}</text>` +
        `<text x="${n(r.cx)}" y="${n(base)}" font-size="${n(r.f)}">${e}</text></g>`,
    )
  }
  return (
    `<g id="txt" font-family="-apple-system,'Helvetica Neue',Arial,sans-serif" font-weight="600" letter-spacing=".04em" text-anchor="middle" fill="${C.txtFill}">` +
    parts.join('') +
    '</g>'
  )
}

// The two colourways, built once.
const BUILT = { black: build(BLACK), blue: build(BLUE) }
const PALS = { black: BLACK, blue: BLUE }

/**
 * The whole scene in the colourway `tone` (Black unless 'blue'), with the reply
 * hung over the street. `elapsed` is seconds since a fixed epoch: every
 * animation's delay subtracts it, so phases carry on across redraws. Cheap:
 * string joins plus the small text layer.
 */
export function sceneWith(opts: { elapsed: number; text: string; tone?: Tone }): string {
  const tone: Tone = opts.tone === 'blue' ? 'blue' : 'black'
  const b = BUILT[tone]
  const e = Number.isFinite(opts.elapsed) ? opts.elapsed : 0
  return b.HEAD + e.toFixed(2) + b.MID + textLayer(typeof opts.text === 'string' ? opts.text : '', PALS[tone], b.textCls) + b.TAIL
}

/** Every ladder, for the build script's checks (the same in both colourways). */
export const LADDER_NOTES: LadderNote[] = BUILT.black.notes

/** Text-layer geometry, for the preview build's notes. */
export const TEXT_NOTES: string[] = TXT_ROWS_GEO.map((r, i) => `row ${i + 1}: z=${r.z} wire y=${n(r.y0)} font=${n(r.f)}px opacity=${o2(r.op)}`)

export const SCENE: string = sceneWith({ elapsed: 0, text: '' })

/** Notes for the preview build (not part of the drawing). */
export const SCENE_NOTES: string[] = LADDER_NOTES.map(
  L => `ladder ${L.name}: ${L.inst.length} instances, period ${nd(L.T, 2)} s, slots ${L.inst.map(i => nd(i.zN, 1)).join(', ')} m`,
)
