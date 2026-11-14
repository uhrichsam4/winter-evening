// Winter evening: a procedural, CSS-animated SVG backdrop.
//
// A foggy, snowy courtyard lane between Soviet apartment blocks at dusk, seen
// from a low (about third-floor) window. Everything is one steel/cobalt-blue
// family; a girl walks away up the lane, small figures cross far off, snow falls
// in five depth layers.
//
// Pure TypeScript: no imports, no DOM, no Node. The string is built once at
// module load with a seeded PRNG (mulberry32), so every load is identical.
// Only `transform` and `opacity` are animated, all from the <style> block.
//
// World model: metres. X = right of the camera, Y = up from the snow, z = depth.
// Screen: x = HX + FOC*X/z, y = HY + FOC*(CAM-Y)/z. A 1.7 m person drawn in the
// 170-unit figure rigs therefore has scale s = FOC/(100 z).

// ============================== tunables ===================================

const HX = 820 // vanishing point x
const HY = 400 // horizon y
const FOC = 1000 // focal length, px per metre at 1 m
const CAM = 6 // eye height above the snow, m
const FOGD = 17.3 // aerial perspective: fog mix = 1 - exp(-(z / FOGD) ^ FOGP)
const FOGP = 2.3 // steepness: near things keep contrast, beyond ~25 m within ~12 % of the fog
const SEED = 20261114

const C = {
  skyTop: '#2f4c7c',
  skyMid: '#47669a',
  haze: '#5a7aa8',
  fog: '#6c8cbb', // the fog / horizon color everything fades toward
  fogHi: '#7b99c4',
  snowHi: '#8fa9d0', // snow caps, ledges, banks
  snowNear: '#5675a9', // the snow plane nearest the camera
  path: '#47659a', // trampled lane
  bldg: '#2b4677',
  bldgDark: '#223b69',
  shadow: '#24406e',
  ink: '#1b2b51', // darkest tone used (bare branches, figures); never black
  indigo: '#131b40', // vignette
  warm: '#ffb060', // distant sodium lights
  win: '#e9b872', // lit windows
  lamp: '#ffe2b2', // lamp halos
  flake: '#dfeaf8',
  figure: '#24365c',
}

/** Centre line of the lane (world X at depth z): a gentle meander. */
const pathX = (z: number): number => -0.5 + 0.35 * Math.sin(z / 22)
const PATH_HALF = 1.8 // half width of the trampled lane, m

// Girl (hero) loop.
const GIRL_LOOP = 96 // s, whole loop
const GIRL_WALK = 0.85 // fraction of the loop spent walking (rest: invisible)
const GIRL_Z0 = 6.6 // start depth (fully below the frame)
const GIRL_Z1 = 62.5 // end depth (lost in fog)
const GIRL_STRIDE = 1.15 // s per two steps

// Snow layers, back to front. Tile is 1900 x 1300 (x -150..1750, y -150..1150)
// so the wind slant never uncovers a corner; fall = exactly one tile height.
const TILE_H = 1300
const SNOW = [
  { n: 320, r: [0.6, 1.1], op: [0.35, 0.6], fall: 47, ang: 5, sway: 6, sd: [17, 23, 29], bokeh: false },
  { n: 246, r: [1, 1.7], op: [0.42, 0.62], fall: 37, ang: 6, sway: 10, sd: [11, 13, 19], bokeh: false },
  { n: 160, r: [1.6, 2.6], op: [0.45, 0.7], fall: 23, ang: 7, sway: 16, sd: [7, 11, 13], bokeh: false },
  { n: 72, r: [3, 5], op: [0.45, 0.7], fall: 13, ang: 8, sway: 24, sd: [6.1, 8.3, 9.7], bokeh: true },
  { n: 20, r: [8, 16], op: [0.25, 0.4], fall: 7.9, ang: 9, sway: 30, sd: [5.3, 7.1, 8.9], bokeh: true },
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
let R = mulberry32(SEED)
const rnd = (a: number, b: number): number => a + (b - a) * R()

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
const fogK = (z: number): number => 1 - Math.exp(-Math.pow(Math.max(0, z) / FOGD, FOGP))
/** A color as seen through fog at depth z. */
const atm = (c: string, z: number): string => mix(c, C.fog, fogK(z))

// Projection.
const sx = (X: number, z: number): number => HX + (FOC * X) / z
const sy = (Y: number, z: number): number => HY + (FOC * (CAM - Y)) / z
type P3 = [number, number, number]
/** Closed polygon path from world points. */
function poly(pts: P3[], f: (v: number) => string = n): string {
  return 'M' + pts.map(([X, Y, z]) => pj([f(sx(X, z)), f(sy(Y, z))])).join('L') + 'Z'
}

// ---- CSS collector: short class names, deduped keyframes --------------------
const css: string[] = []
const kfs = new Map<string, string>()
function kf(body: string): string {
  let k = kfs.get(body)
  if (k === undefined) {
    k = 'k' + kfs.size.toString(36)
    kfs.set(body, k)
    css.push(`@keyframes ${k}{${body}}`)
  }
  return k
}
const LET = 'abcdefghijklmnopqrstuvwxyz'
let cc = 0
function cname(): string {
  const i = cc++
  return i < 26 ? LET.charAt(i) : LET.charAt(Math.floor(i / 26) - 1) + LET.charAt(i % 26)
}
const clsMap = new Map<string, string>()
function cls(rule: string): string {
  let c = clsMap.get(rule)
  if (c === undefined) {
    c = cname()
    clsMap.set(rule, c)
    css.push(`.${c}{${rule}}`)
  }
  return c
}
/** A class running keyframes `body` forever. */
function an(body: string, dur: number, delay = 0, tf = 'ease-in-out', alt = true, extra = ''): string {
  return cls(
    `animation:${kf(body)} ${n(dur)}s ${tf} infinite${alt ? ' alternate' : ''};${dl(delay)}${extra ? ';' + extra : ''}`,
  )
}
/**
 * An animation delay that continues across reloads: the root carries --t, the
 * seconds since a fixed epoch, so every loop resumes at the phase it had.
 */
function dl(delay: number): string {
  return `animation-delay:calc(${n(delay)}s - var(--t))`
}
/** A class whose rule applies to every descendant (per-figure phase). */
function descCls(rule: string): string {
  const c = cname()
  css.push(`.${c} *{${rule}}`)
  return c
}
const org = (x: number, y: number): string => `transform-origin:${n(x)}px ${n(y)}px`

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

/** Opacity / small factor to 2 decimals, "0.45" → ".45". */
function o2(v: number): string {
  const s = (Math.round(v * 100) / 100).toString()
  return s === '-0' ? '0' : s.replace(/^(-?)0\./, '$1.')
}
/** Scale to 3 decimals. */
function s3(v: number): string {
  return (Math.round(v * 1000) / 1000).toString().replace(/^0\./, '.')
}

// ============================== defs =======================================

const st = (o: number, c: string, op = 1): string =>
  `<stop offset="${o2(o)}" stop-color="${c}"${op < 1 ? ` stop-opacity="${o2(op)}"` : ''}/>`

const defs = [
  `<linearGradient id="sk" x2="0" y2="1">${st(0, C.skyTop)}${st(0.5, C.skyMid)}${st(0.88, C.haze)}${st(1, C.fog)}</linearGradient>`,
  `<linearGradient id="gd" x2="0" y2="1">${st(0, C.fog)}${st(0.3, '#6182b4')}${st(1, C.snowNear)}</linearGradient>`,
  `<radialGradient id="fg">${st(0, C.fog, 0.9)}${st(0.5, C.fog, 0.45)}${st(1, C.fog, 0)}</radialGradient>`,
  `<radialGradient id="fh">${st(0, C.fogHi, 0.85)}${st(0.55, C.fogHi, 0.35)}${st(1, C.fogHi, 0)}</radialGradient>`,
  `<radialGradient id="wl">${st(0, C.warm, 0.5)}${st(1, C.warm, 0)}</radialGradient>`,
  `<radialGradient id="lh">${st(0, C.lamp, 0.55)}${st(0.3, C.lamp, 0.2)}${st(1, C.lamp, 0)}</radialGradient>`,
  `<radialGradient id="lp">${st(0, C.lamp, 0.22)}${st(1, C.lamp, 0)}</radialGradient>`,
  `<radialGradient id="bk">${st(0, C.flake)}${st(0.45, C.flake, 0.6)}${st(1, C.flake, 0)}</radialGradient>`,
  `<radialGradient id="bl">${st(0, C.snowHi, 0.3)}${st(1, C.snowHi, 0)}</radialGradient>`,
  `<radialGradient id="bd">${st(0, C.shadow, 0.22)}${st(1, C.shadow, 0)}</radialGradient>`,
  `<radialGradient id="vg" r=".75">${st(0.66, C.indigo, 0)}${st(1, C.indigo, 0.35)}</radialGradient>`,
  `<linearGradient id="vb" x2="0" y2="1">${st(0, C.indigo, 0)}${st(1, C.indigo, 0.28)}</linearGradient>`,
  `<linearGradient id="pg" gradientUnits="userSpaceOnUse" x1="0" y1="${HY + 8}" x2="0" y2="1000">${st(0, C.fog, 0)}${st(0.12, C.fog, 0)}${st(0.42, C.path, 0.75)}${st(1, C.path)}</linearGradient>`,
  `<linearGradient id="sb" gradientUnits="userSpaceOnUse" x1="0" y1="${HY + 8}" x2="0" y2="1000">${st(0, C.snowHi, 0)}${st(0.15, C.snowHi, 0)}${st(0.45, C.snowHi, 0.4)}${st(1, C.snowHi, 0.55)}</linearGradient>`,
  `<linearGradient id="hz" x2="0" y2="1">${st(0, C.fog, 0)}${st(0.45, C.fog, 0.62)}${st(1, C.fog, 0)}</linearGradient>`,
  `<linearGradient id="lf" x2="0" y2="1">${st(0, C.fog, 0)}${st(0.55, C.fog, 0.35)}${st(1, C.fog, 0.85)}</linearGradient>`,
  `<pattern id="wp" width="21" height="25" patternUnits="userSpaceOnUse"><rect x="6" y="8" width="9" height="11" fill="${C.bldgDark}"/></pattern>`,
  `<pattern id="wq" width="15" height="18" patternUnits="userSpaceOnUse"><rect x="4" y="6" width="7" height="8" fill="${C.bldgDark}"/></pattern>`,
]

const out: string[] = []

// ============================== 1. sky / fog ===============================

out.push(`<rect width="1600" height="${HY + 30}" fill="url(#sk)"/>`)

// ============================== 2. ghost skyline ===========================

{
  const g: string[] = []
  // [x, y, w, h, darkness]: 2-6 % toward the building color
  const blocks: number[][] = [
    [250, 252, 170, 175, 0.05],
    [402, 286, 128, 140, 0.04],
    [560, 302, 112, 124, 0.035],
    [770, 140, 64, 290, 0.065], // the central tower
    [784, 126, 36, 16, 0.06],
    [958, 272, 150, 156, 0.05],
    [1118, 300, 112, 128, 0.04],
  ]
  for (const [x = 0, y = 0, w = 0, h = 0, t = 0] of blocks) {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" opacity="${o2(t)}"/>`)
  }
  // distant warm lights, one flickering a touch
  const lights: number[][] = [
    [598, 396],
    [905, 404],
    [1188, 387],
  ]
  const fl = an('from{opacity:.7}to{opacity:1}', 9, -3.1)
  lights.forEach(([x = 0, y = 0], i) => {
    g.push(
      `<g${i === 1 ? ` class="${fl}"` : ''}><circle cx="${x}" cy="${y}" r="10" fill="url(#wl)"/><circle cx="${x}" cy="${y}" r="1.3" fill="${C.warm}" opacity=".85"/></g>`,
    )
  })
  out.push(`<g fill="${C.bldg}">${g.join('')}</g>`)
}

// ============================== 3/5. fog banks =============================

/** Soft fog ellipses drifting sideways, breathing a little. */
function fogBank(list: number[][], dir: number, grad: string): string {
  return list
    .map(([cx = 0, cy = 0, rx = 0, ry = 0, a = 0, d = 0, o = 0]) => {
      const c = an(
        `from{transform:translateX(${n(-a * dir)}px);opacity:.75}to{transform:translateX(${n(a * dir)}px);opacity:1}`,
        d,
        -rnd(0, d),
      )
      return `<ellipse class="${c}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${grad})" fill-opacity="${o2(o)}"/>`
    })
    .join('')
}

const farFog = fogBank(
  [
    [820, 330, 640, 125, 70, 131, 0.85],
    [400, 382, 520, 95, 90, 97, 0.7],
    [1230, 362, 560, 110, 60, 157, 0.7],
    [720, 245, 720, 135, 50, 113, 0.45],
  ],
  1,
  'fh',
)
out.push(farFog)

// ============================== ground base =================================

out.push(`<rect y="${HY - 6}" width="1600" height="${1006 - HY}" fill="url(#gd)"/>`)

// ============================== 4. mid buildings ===========================

// Left panel blocks: only a slightly darker band in the fog.
{
  const g: string[] = []
  const blocks: [number, number, number, number, number, string][] = [
    [-30, 212, 300, 310, 0.24, 'wp'],
    [248, 262, 236, 250, 0.16, 'wq'],
    [470, 300, 150, 196, 0.1, 'wq'],
  ]
  for (const [x, y, w, h, t, p] of blocks) {
    const r = `x="${x}" y="${y}" width="${w}" height="${h}"`
    g.push(
      `<rect ${r} fill="${C.bldg}" opacity="${o2(t * 1.6)}"/><rect ${r} fill="url(#${p})" opacity="${o2(t * 0.9)}"/>` +
        `<rect x="${x}" y="${y - 2}" width="${w}" height="3" fill="${C.snowHi}" opacity="${o2(t * 1.4)}"/>` +
        `<rect ${r} fill="url(#lf)"/>`,
    )
  }
  out.push(`<g>${g.join('')}</g>`)
}

// Right 9-storey block: long facade receding along the lane, balcony stacks.
{
  const BX = 13.6 // facade plane, m right of camera
  const BD = 12 // block depth
  const Z0 = 23 // nearest end
  const Z1 = 100 // far end (lost in fog)
  const FH = 2.8 // storey height
  const FL = 9
  const BH = FL * FH + 0.6
  const g: string[] = []
  const xa = sx(BX, Z0)
  const xb = sx(BX, Z1)
  // facade, with a horizontal fade toward fog
  g.push(
    `<linearGradient id="bf" gradientUnits="userSpaceOnUse" x1="${ni(xa)}" x2="${ni(xb)}">${st(0, atm(C.bldgDark, 7))}${st(1, atm(C.bldg, 70))}</linearGradient>`,
  )
  const facade = poly([
    [BX, 0, Z0],
    [BX, 0, Z1],
    [BX, BH, Z1],
    [BX, BH, Z0],
  ])
  const endFace = poly([
    [BX, 0, Z0],
    [BX + BD, 0, Z0],
    [BX + BD, BH, Z0],
    [BX, BH, Z0],
  ])
  g.push(`<path d="${facade}" fill="url(#bf)"/><path d="${endFace}" fill="${atm(C.ink, 9)}"/>`)
  // end face window grid (flat facing the viewer: a pattern)
  {
    const u = FOC / Z0
    const ww = 3 * u
    g.push(
      `<pattern id="we" width="${n(ww)}" height="${n(FH * u)}" patternUnits="userSpaceOnUse" x="${n(xa)}" y="${n(sy(BH, Z0))}"><rect x="${n(0.8 * u)}" y="${n(0.9 * u)}" width="${n(1.4 * u)}" height="${n(1.4 * u)}" fill="${C.ink}"/></pattern>`,
      `<path d="${endFace}" fill="url(#we)" opacity=".35"/>`,
    )
  }
  // windows on the receding facade
  const cols: number[] = []
  for (let z = Z0 + 1.2; z < 64; z += 3.1) cols.push(z) // beyond ~64 m the fog has them
  const win: string[] = []
  const lit: { d: string; z: number; f: number }[] = []
  const balF: string[] = []
  const balS: string[] = []
  const balSnow: string[] = []
  cols.forEach((zc, ci) => {
    for (let f = 0; f < FL; f++) {
      const y0 = f * FH + 0.9
      win.push(
        poly(
          [
            [BX, y0, zc],
            [BX, y0, zc + 1.5],
            [BX, y0 + 1.4, zc + 1.5],
            [BX, y0 + 1.4, zc],
          ],
          ni,
        ),
      )
      // a lit window is a smaller warm pane inside the frame (curtained, fogged)
      if (zc < 56 && f >= 2) {
        lit.push({
          d: poly([
            [BX - 0.02, y0 + 0.3, zc + 0.35],
            [BX - 0.02, y0 + 0.3, zc + 1.1],
            [BX - 0.02, y0 + 1.15, zc + 1.1],
            [BX - 0.02, y0 + 1.15, zc + 0.35],
          ]),
          z: zc,
          f,
        })
      }
      if (ci % 4 === 1) {
        // balcony: parapet front, near side, snow on the rail
        const a = zc - 0.5
        const b = zc + 2
        const Y0 = f * FH + 0.05
        const Y1 = Y0 + 1.05
        const BXo = BX - 1.1
        balF.push(
          poly([
            [BXo, Y0, a],
            [BXo, Y0, b],
            [BXo, Y1, b],
            [BXo, Y1, a],
          ], ni),
        )
        balS.push(
          poly([
            [BXo, Y0, a],
            [BX, Y0, a],
            [BX, Y1, a],
            [BXo, Y1, a],
          ], ni),
        )
        balSnow.push(
          poly([
            [BXo - 0.04, Y1, a],
            [BXo - 0.04, Y1, b],
            [BXo - 0.04, Y1 + 0.16, b],
            [BXo - 0.04, Y1 + 0.16, a],
          ], ni),
        )
      }
    }
  })
  g.push(`<path d="${win.join('')}" fill="${C.bldgDark}" opacity=".7"/>`)
  // 8 dim warm windows, 2 with a slow TV flicker
  const tv1 = an(
    stops([
      [0, 'opacity:.55'],
      [9, 'opacity:.75'],
      [14, 'opacity:.5'],
      [31, 'opacity:.7'],
      [47, 'opacity:.6'],
      [52, 'opacity:.85'],
      [70, 'opacity:.5'],
      [84, 'opacity:.72'],
      [100, 'opacity:.55'],
    ]),
    4.3,
    -1.2,
    'linear',
    false,
  )
  const tv2 = an(
    stops([
      [0, 'opacity:.6'],
      [12, 'opacity:.45'],
      [27, 'opacity:.8'],
      [40, 'opacity:.55'],
      [58, 'opacity:.7'],
      [66, 'opacity:.48'],
      [83, 'opacity:.78'],
      [100, 'opacity:.6'],
    ]),
    5.9,
    -2.7,
    'linear',
    false,
  )
  // 8 lit panes spread over different floors and depths
  const byFloor = new Map<number, { d: string; z: number }[]>()
  for (const w of lit) byFloor.set(w.f, [...(byFloor.get(w.f) ?? []), w])
  const chosen: { d: string; z: number }[] = []
  for (const [, ws] of byFloor) {
    const w = ws[Math.floor(rnd(0, ws.length))]
    if (w && chosen.length < 8) chosen.push(w)
  }
  chosen.forEach((w, k) => {
    const o = o2(0.42 - ((w.z - Z0) / 33) * 0.2)
    const tv = k === 1 ? tv1 : k === 4 ? tv2 : ''
    g.push(
      tv
        ? `<g opacity="${o}"><path class="${tv}" d="${w.d}" fill="${C.win}"/></g>`
        : `<path d="${w.d}" fill="${C.win}" opacity="${o}"/>`,
    )
  })
  g.push(
    `<path d="${balS.join('')}" fill="${mix(C.bldgDark, C.ink, 0.3)}"/>`,
    `<path d="${balF.join('')}" fill="${mix(C.bldg, C.fog, 0.18)}"/>`,
    `<path d="${balSnow.join('')}" fill="${C.snowHi}" opacity=".8"/>`,
  )
  // roof: parapet snow cap along the edge and across the near end
  g.push(
    `<path d="${poly([
      [BX - 0.05, BH, Z0],
      [BX - 0.05, BH, Z1],
      [BX - 0.05, BH + 0.35, Z1],
      [BX - 0.05, BH + 0.35, Z0],
    ])}${poly([
      [BX, BH, Z0],
      [BX + BD, BH, Z0],
      [BX + BD, BH + 0.35, Z0],
      [BX, BH + 0.35, Z0],
    ])}" fill="${C.snowHi}" opacity=".85"/>`,
  )
  // rooftop antennas
  const ant: string[] = []
  for (const az of [54, 63, 77]) {
    const X = BX + 2.5
    ant.push(
      'M' + pj([n(sx(X, az)), n(sy(BH, az))]) + 'V' + n(sy(BH + 3.2, az)),
      'M' + pj([n(sx(X - 0.8, az)), n(sy(BH + 2.6, az))]) + 'H' + n(sx(X + 0.8, az)),
      'M' + pj([n(sx(X - 0.5, az)), n(sy(BH + 1.9, az))]) + 'H' + n(sx(X + 0.5, az)),
    )
  }
  g.push(`<path d="${ant.join('')}" stroke="${atm(C.ink, 50)}" stroke-width="1.6" fill="none"/>`)
  // fog: the lower half sinks into it, the far end dissolves leftward
  const bbox = facade + endFace
  g.push(
    `<linearGradient id="fv" gradientUnits="userSpaceOnUse" x1="0" y1="150" x2="0" y2="${ni(sy(0, Z0))}">${st(0, C.fog, 0)}${st(0.25, C.fog, 0.2)}${st(0.45, C.fog, 0.7)}${st(1, C.fog, 0.96)}</linearGradient>`,
    `<linearGradient id="fz" gradientUnits="userSpaceOnUse" x1="${ni(xa)}" x2="${ni(xb)}">${st(0, C.fog, 0)}${st(0.5, C.fog, 0.55)}${st(1, C.fog, 0.92)}</linearGradient>`,
    `<path d="${bbox}" fill="url(#fz)"/><path d="${bbox}" fill="url(#fv)"/>`,
  )
  out.push(`<g>${g.join('')}</g>`)
}

// mid fog, drifting the other way
out.push(
  fogBank(
    [
      [860, 432, 760, 100, 80, 89, 0.95],
      [290, 470, 520, 90, 60, 121, 0.8],
      [1310, 470, 560, 120, 70, 103, 0.85],
      [790, 515, 560, 80, 40, 149, 0.6],
    ],
    -1,
    'fg',
  ),
)
// the reply text layer is spliced in here by sceneWith (in front of the fog, behind trees)
const TEXT_MARK = '%%TEXT%%'
const T_MARK = '%%T%%'
out.push(TEXT_MARK)

// ============================== 6. ground ==================================

{
  const g: string[] = []
  // soft tonal variation of the snow
  const blobs: [number, number, number, number, string][] = [
    [240, 760, 380, 120, 'bl'],
    [1380, 820, 360, 110, 'bl'],
    [560, 930, 420, 90, 'bd'],
    [1180, 640, 300, 60, 'bd'],
    [380, 590, 320, 55, 'bl'],
    [1050, 960, 380, 80, 'bl'],
  ]
  for (const [cx, cy, rx, ry, gr] of blobs) {
    g.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${gr})"/>`)
  }
  // far cross-path (where the side-view walkers go)
  g.push(
    `<path d="${poly([
      [-80, 0, 82],
      [80, 0, 82],
      [80, 0, 75],
      [-80, 0, 75],
    ])}" fill="${C.path}" opacity=".3"/>`,
  )
  // the lane: three nested strips for soft edges
  const zs: number[] = []
  for (let z = 4.5; z < 120; z *= 1.2) zs.push(z)
  zs.push(130)
  const strip = (h0: number, h1: number): string => {
    const L: P3[] = zs.map((z): P3 => [pathX(z) + h0, 0, z])
    const Rr: P3[] = zs.map((z): P3 => [pathX(z) + h1, 0, z]).reverse()
    return poly([...L, ...Rr])
  }
  g.push(
    `<g fill="url(#pg)"><path d="${strip(-PATH_HALF * 1.3, PATH_HALF * 1.3)}" opacity=".3"/><path d="${strip(-PATH_HALF, PATH_HALF)}" opacity=".45"/><path d="${strip(-PATH_HALF * 0.72, PATH_HALF * 0.72)}" opacity=".45"/></g>`,
  )
  // snowbanks along both sides
  g.push(
    `<g fill="url(#sb)"><path d="${strip(-PATH_HALF * 1.32 - 0.6, -PATH_HALF * 1.32)}"/><path d="${strip(PATH_HALF * 1.32, PATH_HALF * 1.32 + 0.6)}"/></g>`,
  )
  // sled tracks
  const track = (off: number): string =>
    'M' +
    zs
      .filter(z => z > 5 && z < 75)
      .map(z => pj([n(sx(pathX(z) + off, z)), n(sy(0, z))]))
      .join('L')
  g.push(`<path d="${track(0.35)}${track(0.85)}" stroke="${C.shadow}" stroke-width="1.3" fill="none" opacity=".25"/>`)
  // footprints, banded by depth so each band shares a stroke width
  const bands: [number, number][] = [
    [6, 10],
    [10, 15],
    [15, 23],
    [23, 34],
    [34, 50],
  ]
  const prints: string[] = []
  for (const [za, zb] of bands) {
    const zm = (za + zb) / 2
    const d: string[] = []
    let side = 1
    for (let z = za; z < zb; z += 0.42) {
      side = -side
      for (const base of [-0.3, 0.55]) {
        if (base > 0 && R() < 0.35) continue
        const X = pathX(z) + base + side * 0.11 + rnd(-0.05, 0.05)
        const zz = z + rnd(-0.1, 0.1)
        const len = sy(0, zz) - sy(0, zz + 0.26)
        d.push('M' + pj([n(sx(X, zz)), n(sy(0, zz))]) + 'v' + n(-len))
      }
    }
    prints.push(`<path d="${d.join('')}" stroke-width="${n((0.1 * FOC) / zm)}"/>`)
  }
  g.push(`<g stroke="${C.shadow}" stroke-linecap="round" fill="none" opacity=".22">${prints.join('')}</g>`)
  // kerb on the car side
  g.push(
    `<path d="M${pj([n(sx(4.15, 6)), n(sy(0, 6))])}L${pj([n(sx(4.15, 95)), n(sy(0, 95))])}" stroke="${C.shadow}" stroke-width="1.6" opacity=".3"/>`,
  )
  // low fence on the left beyond the footpath
  {
    const FX = -6.7
    const posts: string[][] = [[], [], []]
    for (let z = 6; z < 70; z += 2.4) {
      const b = z < 12 ? 0 : z < 25 ? 1 : 2
      posts[b]?.push('M' + pj([n(sx(FX, z)), n(sy(0, z))]) + 'V' + n(sy(1.05, z)))
    }
    const rail = (Y: number): string =>
      'M' + pj([n(sx(FX, 6)), n(sy(Y, 6))]) + 'L' + pj([n(sx(FX, 70)), n(sy(Y, 70))])
    g.push(
      `<g stroke="${atm(C.ink, 18)}" fill="none" opacity=".7"><path d="${posts[0]?.join('')}" stroke-width="7"/><path d="${posts[1]?.join('')}" stroke-width="4"/><path d="${posts[2]?.join('')}" stroke-width="2"/><path d="${rail(0.95)}${rail(0.45)}" stroke-width="2.2"/></g>`,
      `<path d="${rail(1.04)}" stroke="${C.snowHi}" stroke-width="2.5" opacity=".6"/>`,
    )
  }
  out.push(`<g>${g.join('')}</g>`)
}

// lamp posts: light pools first (on the snow), posts and halos later
const LAMPS = [16, 31, 55]
const LAMP_X = -2.75
{
  const g: string[] = []
  for (const z of LAMPS) {
    const cx = sx(LAMP_X + 0.55, z)
    const cy = sy(0, z)
    const rx = (2.6 * FOC) / z
    const ry = (sy(0, z - 2.6) - sy(0, z + 2.6)) / 2
    g.push(`<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#lp)"/>`)
  }
  out.push(`<g>${g.join('')}</g>`)
}

// parked cars: snow-covered, seen from above-behind, far to near
type P2 = [number, number]
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
function rounded(pts: P2[], k: number, f: (v: number) => string): string {
  const m = pts.length
  const parts: string[] = []
  for (let i = 0; i <= m; i++) {
    const v = pts[i % m] as P2
    const a = pts[(i + m - 1) % m] as P2
    const b = pts[(i + 1) % m] as P2
    const la = Math.hypot(a[0] - v[0], a[1] - v[1]) || 1
    const lb = Math.hypot(b[0] - v[0], b[1] - v[1]) || 1
    const r = (k * Math.min(la, lb)) / 2
    const p1: P2 = [v[0] + ((a[0] - v[0]) * r) / la, v[1] + ((a[1] - v[1]) * r) / la]
    const p2: P2 = [v[0] + ((b[0] - v[0]) * r) / lb, v[1] + ((b[1] - v[1]) * r) / lb]
    if (i === 0) parts.push('M' + pj([f(p2[0]), f(p2[1])]))
    else parts.push('L' + pj([f(p1[0]), f(p1[1])]) + 'Q' + pj([f(v[0]), f(v[1]), f(p2[0]), f(p2[1])]))
  }
  return parts.join('') + 'Z'
}
/** Screen silhouette of a world box, rounded. */
function blob(x0: number, x1: number, y0: number, y1: number, a: number, b: number, k: number, f: (v: number) => string): string {
  const pts: P2[] = []
  for (const X of [x0, x1]) for (const Y of [y0, y1]) for (const z of [a, b]) pts.push([sx(X, z), sy(Y, z)])
  return rounded(hull(pts), k, f)
}
/** A flat quad on a world face, rounded. */
const pane = (q: P3[], k: number, f: (v: number) => string): string =>
  rounded(
    q.map(([X, Y, z]): P2 => [sx(X, z), sy(Y, z)]),
    k,
    f,
  )

// car types: length, width, body top, cabin start/end (from the rear), roof, cabin inset
const CAR_TYPES = {
  sedan: { L: 4.5, W: 1.8, hb: 0.86, c0: 1.05, c1: 3.05, top: 1.42, inset: 0.16 },
  hatch: { L: 4.0, W: 1.75, hb: 0.86, c0: 0.3, c1: 2.75, top: 1.47, inset: 0.15 },
  van: { L: 4.8, W: 1.9, hb: 1.0, c0: 0.1, c1: 3.9, top: 1.95, inset: 0.06 },
}
{
  const g: string[] = []
  const cars: [number, keyof typeof CAR_TYPES][] = [
    [42, 'sedan'],
    [33.5, 'hatch'],
    [26.5, 'van'],
    [20.5, 'sedan'],
    [15, 'hatch'],
    [9.5, 'sedan'],
  ]
  for (const [z0, type] of cars) {
    const T = CAR_TYPES[type]
    const X0 = 4.4 + rnd(-0.12, 0.12)
    const x1 = X0 + T.W
    const z1 = z0 + T.L
    const zm = z0 + 1.5
    const u = FOC / zm
    const f = z0 < 22 ? n : ni
    const body = atm(mix(C.ink, C.bldg, rnd(0, 0.55)), zm)
    const glass = atm('#162240', zm)
    const snow = atm(C.snowHi, zm)
    const dark = atm('#151f3a', zm)
    const cs = z0 + T.c0
    const ce = z0 + T.c1
    const ci0 = X0 + T.inset
    const ci1 = x1 - T.inset
    const sp: string[] = []
    // soft ground shadow
    sp.push(`<path d="${blob(X0 - 0.25, x1 + 0.15, 0, 0, z0 - 0.3, z1 + 0.25, 1, f)}" fill="${C.shadow}" opacity=".28"/>`)
    // body, rounded
    sp.push(`<path d="${blob(X0, x1, 0.2, T.hb, z0, z1, 0.55, f)}" fill="${body}"/>`)
    // wheel arches on the visible (lane) side
    for (const zw of [z0 + 0.8, z1 - 0.85]) {
      const rx = (sx(X0, zw - 0.36) - sx(X0, zw + 0.36)) / 2
      sp.push(`<ellipse cx="${f(sx(X0, zw))}" cy="${f(sy(0.3, zw))}" rx="${f(rx)}" ry="${f(0.3 * u)}" fill="${dark}"/>`)
    }
    // dim tail-light pair on the nearest two
    if (z0 < 16) {
      for (const [a, b] of [
        [X0 + 0.12, X0 + 0.42],
        [x1 - 0.42, x1 - 0.12],
      ] as const) {
        sp.push(
          `<path d="${pane(
            [
              [a, 0.6, z0 - 0.01],
              [b, 0.6, z0 - 0.01],
              [b, 0.74, z0 - 0.01],
              [a, 0.74, z0 - 0.01],
            ],
            0.8,
            f,
          )}" fill="${mix('#c25a58', C.fog, 0.3)}" opacity=".55"/>`,
        )
      }
    }
    // bonnet snow (beyond the cabin, so the cabin hides its near edge)
    if (z1 - ce > 0.4) sp.push(`<path d="${blob(X0 + 0.04, x1 - 0.04, T.hb - 0.02, T.hb + 0.14, ce - 0.1, z1 - 0.06, 1, f)}" fill="${snow}"/>`)
    // cabin with fogged windows, then its thick soft roof of snow
    sp.push(`<path d="${blob(ci0, ci1, T.hb - 0.05, T.top, cs, ce, 0.5, f)}" fill="${mix(body, glass, 0.35)}"/>`)
    sp.push(
      `<path d="${pane(
        [
          [ci0 - 0.01, T.hb + 0.07, cs + 0.2],
          [ci0 - 0.01, T.hb + 0.07, ce - 0.25],
          [ci0 - 0.01, T.top - 0.08, ce - 0.4],
          [ci0 - 0.01, T.top - 0.08, cs + 0.35],
        ],
        0.7,
        f,
      )}" fill="${glass}"/>`,
      `<path d="${pane(
        [
          [ci0 + 0.12, T.hb + 0.07, cs - 0.01],
          [ci1 - 0.12, T.hb + 0.07, cs - 0.01],
          [ci1 - 0.16, T.top - 0.08, cs - 0.01],
          [ci0 + 0.16, T.top - 0.08, cs - 0.01],
        ],
        0.7,
        f,
      )}" fill="${glass}"/>`,
      `<path d="${blob(ci0 - 0.05, ci1 + 0.05, T.top - 0.04, T.top + 0.2, cs - 0.05, ce + 0.05, 1, f)}" fill="${snow}"/>`,
    )
    // boot snow (in front of the cabin)
    if (cs - z0 > 0.4) sp.push(`<path d="${blob(X0 + 0.04, x1 - 0.04, T.hb - 0.02, T.hb + 0.13, z0 + 0.05, cs + 0.05, 1, f)}" fill="${snow}"/>`)
    // drifts piled against the wheels
    for (const zw of [z0 + 0.8, z1 - 0.85]) {
      sp.push(`<ellipse cx="${f(sx(X0 - 0.12, zw))}" cy="${f(sy(0.05, zw))}" rx="${f(0.36 * u)}" ry="${f(0.08 * u)}" fill="${snow}" opacity="${o2(0.75 * (1 - fogK(zm)))}"/>`)
    }
    g.push(sp.join(''))
  }
  out.push(`<g>${g.join('')}</g>`)
}

// lamp posts and halos
{
  const g: string[] = []
  const pulse = an('from{opacity:.86}to{opacity:1}', 6.7, -2)
  LAMPS.forEach((z, i) => {
    const u = FOC / z
    const bx = sx(LAMP_X, z)
    const by = sy(0, z)
    const ty = sy(4.4, z)
    const hx = sx(LAMP_X + 0.6, z)
    const hy = sy(4.25, z)
    const col = atm(C.ink, z)
    g.push(
      `<path d="M${pj([n(bx), n(by)])}V${n(ty)}q${pj([n(0.05 * u), n(-0.35 * u), n(0.6 * u), n(0.15 * u)])}" stroke="${col}" stroke-width="${n(Math.max(1, 0.12 * u))}" fill="none"/>`,
      `<ellipse cx="${n(hx)}" cy="${n(hy)}" rx="${n(0.22 * u)}" ry="${n(0.09 * u)}" fill="${mix(C.lamp, C.fog, fogK(z) * 0.5)}"/>`,
      `<circle${i === 0 ? ` class="${pulse}"` : ''} cx="${n(hx)}" cy="${n(hy + 0.1 * u)}" r="${n(1.5 * u)}" fill="url(#lh)"/>`,
    )
  })
  out.push(`<g>${g.join('')}</g>`)
}

// ============================== trees ======================================

type Acc = { lv: string[][]; snow: string[][]; twig: string[]; w0: number; snowOn: boolean; twigs: boolean }
const mkAcc = (w0: number, snowOn: boolean, twigs: boolean): Acc => ({
  lv: [[], [], [], [], [], [], []],
  snow: [[], [], []],
  twig: [],
  w0,
  snowOn,
  twigs,
})

/** One branch segment, then its children (recursive, seeded). */
function branch(
  x: number,
  y: number,
  ang: number,
  len: number,
  lev: number,
  max: number,
  acc: Acc,
  f: (v: number) => string,
  bias: number,
): void {
  const ex = x + Math.sin(ang) * len
  const ey = y - Math.cos(ang) * len
  const bend = rnd(-0.14, 0.14)
  const cx = (x + ex) / 2 + Math.cos(ang) * len * bend
  const cy = (y + ey) / 2 + Math.sin(ang) * len * bend
  const q = 'q' + pj([f(cx - x), f(cy - y), f(ex - x), f(ey - y)])
  acc.lv[lev]?.push('M' + pj([f(x), f(y)]) + q)
  // snow: a thin line on the upper side of leaning limbs (none on near-vertical ones)
  if (acc.snowOn && lev <= 2 && Math.abs(ang) > 0.4) {
    const o = acc.w0 * Math.pow(0.58, lev) * 0.32
    const nx = ang > 0 ? -Math.cos(ang) : Math.cos(ang)
    const ny = ang > 0 ? -Math.sin(ang) : Math.sin(ang)
    acc.snow[lev]?.push('M' + pj([f(x + nx * o), f(y + ny * o)]) + q)
  }
  if (lev >= max) {
    // fine twigs at the crown tips (nearest trees only)
    if (acc.twigs) {
      for (const sgn of [-1, 1]) {
        const a = ang + sgn * rnd(0.25, 0.7)
        const l = len * rnd(0.35, 0.6)
        acc.twig.push('M' + pj([ni(ex), ni(ey)]) + 'l' + pj([ni(Math.sin(a) * l), ni(-Math.cos(a) * l)]))
      }
    }
    return
  }
  const k = lev === 1 ? 2 + (R() < 0.6 ? 1 : 0) : 2 + (R() < 0.35 ? 1 : 0)
  const spread = lev === 1 ? 0.55 : 0.48
  for (let i = 0; i < k; i++) {
    const t = k === 1 ? 0 : (i / (k - 1) - 0.5) * 2
    let na = ang * 0.88 + t * spread * rnd(0.6, 1.15) + rnd(-0.12, 0.12) + bias * 0.3
    na = Math.max(-1.35, Math.min(1.35, na))
    const at = rnd(0.55, 1)
    branch(x + (ex - x) * at, y + (ey - y) * at, na, len * rnd(0.6, 0.78), lev + 1, max, acc, f, bias)
  }
}

type TreeOut = { z: number; s: string }

/**
 * A bare deciduous tree: still trunk, swaying crown (pivot at the fork).
 * Each tree draws its own fork height, 2-4 primary limbs, a lean, and maybe a
 * continuing central leader, so silhouettes differ.
 */
function tree(X: number, z: number, hM: number, depth: number, twigs: boolean, bias: number): TreeOut {
  const u = FOC / z
  const bx = sx(X, z)
  const by = sy(0, z)
  const f = ni
  const w0 = 0.3 * u * rnd(0.85, 1.15)
  const forkF = rnd(0.2, 0.48)
  const trunkH = hM * forkF * u
  const lean = bias + rnd(-0.14, 0.14)
  const fx = bx + lean * 0.22 * trunkH
  const fy = by - trunkH
  const acc = mkAcc(w0, z < 32, twigs)
  const limbs = 2 + Math.floor(R() * 3)
  const leader = R() < 0.45
  const L = hM * u * rnd(0.26, 0.34) * (1.2 - forkF * 0.6)
  for (let i = 0; i < limbs; i++) {
    const t = limbs === 1 ? 0 : (i / (limbs - 1) - 0.5) * 2
    const a = t * rnd(0.45, 0.85) + lean + rnd(-0.12, 0.12)
    const len = L * (1 + 0.3 * t * Math.sign(lean)) * rnd(0.85, 1.1)
    // with a leader, side limbs leave the trunk at staggered heights
    const drop = leader ? rnd(0, 0.3) * trunkH : 0
    branch(fx - (lean * 0.22 * drop) / 1, fy + drop, a, len, 1, depth, acc, f, bias)
  }
  if (leader) branch(fx, fy, lean * 0.4, L * 1.35, 1, depth, acc, f, bias * 0.5)
  const col = atm(C.ink, z * 0.9)
  const parts: string[] = []
  acc.lv.forEach((segs, lev) => {
    if (lev === 0 || segs.length === 0) return
    const w = Math.max(0.5, w0 * Math.pow(0.58, lev))
    const op = lev === depth && depth >= 3 ? ' opacity=".7"' : ''
    parts.push(`<path d="${segs.join('')}" stroke-width="${n(w)}"${op}/>`)
  })
  if (acc.twig.length) parts.push(`<path d="${acc.twig.join('')}" stroke-width=".7" opacity=".6"/>`)
  const snowOp = o2(0.5 - 0.3 * Math.min(1, Math.max(0, (z - 12) / 20)))
  acc.snow.forEach((segs, lev) => {
    if (!segs.length) return
    const w = w0 * Math.pow(0.58, lev) * 0.3
    const d = u * Math.pow(0.7, lev - 1)
    parts.push(
      `<path d="${segs.join('')}" stroke="${atm(C.snowHi, z * 0.5)}" stroke-width="${n(w)}" stroke-dasharray="${[0.9, 0.5, 0.5, 0.7].map(v => n(v * d)).join(' ')}" opacity="${snowOp}"/>`,
    )
  })
  const amp = Math.round(rnd(0.35, 0.8) * 10) / 10
  const dur = rnd(6, 11)
  const sw = an(
    `from{transform:rotate(${n(-amp)}deg)}to{transform:rotate(${n(amp)}deg)}`,
    dur,
    -rnd(0, dur),
    'ease-in-out',
    true,
    org(fx, fy),
  )
  const trunk = `M${pj([f(bx), f(by)])}Q${pj([f(bx - rnd(-0.05, 0.05) * trunkH), f(by - trunkH * 0.5), f(fx), f(fy)])}`
  const s =
    `<g stroke="${col}"><path d="${trunk}" stroke-width="${n(w0)}"/>` +
    `<path d="M${pj([f(fx), f(fy)])}v${f(trunkH * 0.12)}" stroke-width="${n(w0 * 0.85)}"/>` +
    `<g class="${sw}">${parts.join('')}</g></g>`
  return { z, s }
}

const trees: TreeOut[] = []
{
  const left = [12, 19.5, 27, 35, 44, 54, 66, 80, 96]
  const right = [14.5, 22, 30.5, 39, 49, 60, 73, 88]
  const nearest = [12, 14.5, 19.5] // these get twigs at the crown tips
  for (const [list, side] of [
    [left, -1],
    [right, 1],
  ] as const) {
    for (const z of list) {
      const near = z < 20
      const X = (side < 0 ? -3.6 : 2.9) + side * (near ? 0.5 : 0) + rnd(-0.3, 0.3)
      const bias = side * (near ? 0.2 : 0.04) + rnd(-0.1, 0.1)
      trees.push(tree(X, z, rnd(9, 12.5), z < 25 ? 4 : z < 60 ? 3 : 2, nearest.includes(z), bias))
    }
  }
  trees.sort((a, b) => b.z - a.z)
}

/** Snow-laden bushes beside the lane. */
function bushes(): string {
  const g: string[] = []
  const list: [number, number][] = [
    [-2.55, 10.5],
    [2.35, 13],
    [-2.6, 17.5],
    [2.25, 24],
    [-2.45, 31],
  ]
  for (const [X, z] of list.sort((a, b) => b[1] - a[1])) {
    const u = FOC / z
    const bx = sx(X, z)
    const by = sy(0, z)
    const tw: string[] = []
    for (let i = 0; i < 9; i++) {
      const a = rnd(-1.1, 1.1)
      const l = rnd(0.45, 0.95) * u
      tw.push('M' + pj([n(bx + rnd(-0.2, 0.2) * u), n(by)]) + 'l' + pj([n(Math.sin(a) * l), n(-Math.cos(a) * l)]))
    }
    const snow = atm(C.snowHi, z * 0.5)
    const caps: string[] = []
    for (let i = 0; i < 4; i++) {
      caps.push(
        `<ellipse cx="${n(bx + rnd(-0.4, 0.4) * u)}" cy="${n(by - rnd(0.35, 0.7) * u)}" rx="${n(rnd(0.1, 0.2) * u)}" ry="${n(rnd(0.05, 0.08) * u)}"/>`,
      )
    }
    const dur = rnd(5, 7.5)
    const sw = an('from{transform:rotate(-.8deg)}to{transform:rotate(.8deg)}', dur, -rnd(0, dur), 'ease-in-out', true, org(bx, by))
    g.push(
      `<ellipse cx="${n(bx)}" cy="${n(by)}" rx="${n(0.75 * u)}" ry="${n(0.16 * u)}" fill="${snow}" opacity=".35"/>` +
        `<g class="${sw}"><path d="${tw.join('')}" stroke="${atm(C.ink, z)}" stroke-width="${n(Math.max(0.6, 0.035 * u))}"/>` +
        `<g fill="${snow}" opacity=".85">${caps.join('')}</g></g>`,
    )
  }
  return `<g>${g.join('')}</g>`
}

// ============================== people =====================================

// Rig classes first (phase overrides per figure come after them in the CSS).

// --- girl, back view, feet at (0,0), 170 units tall ---
const GT = GIRL_STRIDE
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
const lin = (s: [number, string][], dur: number, extra: string): string => an(stops(s), dur, 0, 'linear', false, extra)

const G = {
  bob: lin(bobStops(2, 2.5), GT, ''),
  legA: lin(legStops, GT, org(-7, -84)),
  legB: lin(shift(legStops, 50), GT, org(7, -84)),
  shA: lin(shinStops, GT, org(-7, -46)),
  shB: lin(shift(shinStops, 50), GT, org(7, -46)),
  soA: lin(soleStops, GT, ''),
  soB: lin(shift(soleStops, 50), GT, ''),
  torso: lin(
    [
      [0, 'transform:rotate(0)'],
      [25, 'transform:rotate(1.2deg)'],
      [50, 'transform:rotate(0)'],
      [75, 'transform:rotate(-1.2deg)'],
      [100, 'transform:rotate(0)'],
    ],
    GT,
    org(0, -84),
  ),
  hem: an('from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}', GT / 2, -0.1, 'ease-in-out', true, org(0, -100)),
  armL: lin(armLStops, GT, org(-15, -137)),
  armR: lin(armRStops, GT, org(15, -137)),
  head: lin(
    [
      [0, 'transform:translateY(0)'],
      [25, 'transform:translateY(.7px)'],
      [50, 'transform:translateY(0)'],
      [75, 'transform:translateY(.7px)'],
      [100, 'transform:translateY(0)'],
    ],
    GT,
    '',
  ),
  bag: an('from{transform:rotate(-4deg)}to{transform:rotate(5deg)}', GT / 2, -0.2, 'ease-in-out', true, org(16, -101)),
  scarf: an(
    stops([
      [0, 'transform:rotate(-4deg)'],
      [30, 'transform:rotate(6deg)'],
      [55, 'transform:rotate(-1deg)'],
      [80, 'transform:rotate(7deg)'],
      [100, 'transform:rotate(-4deg)'],
    ]),
    2.3,
    -0.7,
    'ease-in-out',
    false,
    org(-5, -141),
  ),
}

// --- small generic back-view rig (side footpaths, the standing figure) ---
const B = {
  legA: lin(legStops, GT, org(-6, -84)),
  legB: lin(shift(legStops, 50), GT, org(6, -84)),
  armL: lin(armLStops, GT, org(-14, -136)),
  armR: lin(armRStops, GT, org(14, -136)),
  bob: G.bob,
}

// --- side-view rig, facing +x ---
const SIDE_SWING = 22 // deg, thigh swing
const thighStops: [number, string][] = [
  [0, `transform:rotate(${-SIDE_SWING}deg)`],
  [50, `transform:rotate(${SIDE_SWING}deg)`],
  [100, `transform:rotate(${-SIDE_SWING}deg)`],
]
const kneeStops: [number, string][] = [
  [0, 'transform:rotate(0)'],
  [45, 'transform:rotate(5deg)'],
  [50, 'transform:rotate(15deg)'],
  [65, 'transform:rotate(45deg)'],
  [85, 'transform:rotate(14deg)'],
  [100, 'transform:rotate(0)'],
]
const sArmStops: [number, string][] = [
  [0, 'transform:rotate(16deg)'],
  [50, 'transform:rotate(-16deg)'],
  [100, 'transform:rotate(16deg)'],
]
const S = {
  thA: lin(thighStops, 1, org(0, -84)),
  thB: lin(shift(thighStops, 50), 1, org(0, -84)),
  knA: lin(kneeStops, 1, org(0, -46)),
  knB: lin(shift(kneeStops, 50), 1, org(0, -46)),
  arA: lin(sArmStops, 1, org(0, -136)),
  arB: lin(shift(sArmStops, 50), 1, org(0, -136)),
  bob: lin(
    [
      [0, 'transform:translateY(0)'],
      [25, 'transform:translateY(-3px)'],
      [50, 'transform:translateY(0)'],
      [75, 'transform:translateY(-3px)'],
      [100, 'transform:translateY(0)'],
    ],
    1,
    '',
  ),
}

const RC = 'stroke-linecap="round"'

function girlRig(): string {
  const c = {
    coat: '#7487b0',
    coatSh: '#5d709b',
    belt: '#394a73',
    tights: '#26324f',
    boot: '#1e2945',
    sole: '#7082a9',
    hair: '#2a3151',
    hat: '#8d9fc4',
    brim: '#7a8cb3',
    pom: '#a9b9d8',
    scarf: '#58628f',
    bag: '#2b3757',
    mitt: '#2a3456',
    rim: '#c6cfe3',
  }
  const leg = (x: number, L: string, Sh: string, So: string): string =>
    `<g class="${L}"><path d="M${x}-84v40" stroke="${c.tights}" stroke-width="9" ${RC}/>` +
    `<g class="${Sh}"><path d="M${x}-46v8" stroke="${c.tights}" stroke-width="8"/>` +
    `<path d="M${x - 5}-41h10v37q0 4-5 4t-5-4z" fill="${c.boot}"/>` +
    `<ellipse class="${So}" cx="${x}" cy="-1.5" rx="5" ry="2" fill="${c.sole}"/></g></g>`
  const arm = (s: number, A: string): string =>
    `<g class="${A}"><path d="M${15 * s}-137q${5 * s} 18 ${3 * s} 38" stroke="${c.coatSh}" stroke-width="8" fill="none" ${RC}/>` +
    `<circle cx="${18 * s}" cy="-97" r="3.6" fill="${c.mitt}"/></g>`
  return (
    `<ellipse rx="30" ry="6" fill="${C.shadow}" opacity=".4"/>` +
    `<g class="${G.bob}">` +
    leg(-7, G.legA, G.shA, G.soA) +
    leg(7, G.legB, G.shB, G.soB) +
    `<g class="${G.torso}">` +
    `<g class="${G.hem}"><path d="M-14-101h28l8 45q-22 5-44 0z" fill="${c.coat}"/><path d="M4-98l2 40" stroke="${c.coatSh}" stroke-width="1.5"/></g>` +
    `<path d="M-16-141q16-5 32 0l-2 42h-28z" fill="${c.coat}"/>` +
    `<path d="M-14-101h28" stroke="${c.belt}" stroke-width="3.5"/>` +
    arm(-1, G.armL) +
    arm(1, G.armR) +
    `<path d="M-11-141L15-100" stroke="${c.bag}" stroke-width="2"/>` +
    `<g class="${G.bag}"><rect x="11" y="-101" width="13" height="11" rx="2.5" fill="${c.bag}"/></g>` +
    `<path d="M-16-139l-2 38-7 44" stroke="${c.rim}" stroke-width="1.2" fill="none" opacity=".45"/>` +
    `<g class="${G.head}">` +
    `<ellipse cy="-142" rx="11" ry="4.5" fill="${c.scarf}"/>` +
    `<path d="M-11-150q0 18 2 19h18q2-1 2-19z" fill="${c.hair}"/>` +
    `<g class="${G.scarf}"><path d="M-6-141q-2 14 1 28l5-1q-2-13 0-27z" fill="${c.scarf}"/></g>` +
    `<path d="M-10.5-154q0-16 10.5-16t10.5 16z" fill="${c.hat}"/>` +
    `<rect x="-11" y="-157" width="22" height="5" rx="2.5" fill="${c.brim}"/>` +
    `<circle cy="-171" r="5" fill="${c.pom}"/>` +
    `</g></g></g>`
  )
}

/** Generic back-view walker (also reads as front view at this size). */
function backRig(col: string, animated: boolean): string {
  const c = (k: string): string => (animated ? ` class="${k}"` : '')
  const dk = mix(col, C.ink, 0.35)
  return (
    `<ellipse rx="26" ry="5" fill="${C.shadow}" opacity=".35"/>` +
    `<g${c(B.bob)}>` +
    `<g stroke="${dk}" stroke-width="10" ${RC}><path${c(B.legA)} d="M-6-84v80"/><path${c(B.legB)} d="M6-84v80"/></g>` +
    `<path d="M-15-141q15-5 30 0l6 80h-42z" fill="${col}"/>` +
    `<g stroke="${col}" stroke-width="8" fill="none" ${RC}><path${c(B.armL)} d="M-14-136q-5 18-3 38"/><path${c(B.armR)} d="M14-136q5 18 3 38"/></g>` +
    `<circle cy="-152" r="10" fill="${dk}"/><path d="M-10.5-154q0-15 10.5-15t10.5 15z" fill="${col}"/>` +
    `</g>`
  )
}

/** Side-view walker facing +x. */
function sideRig(col: string): string {
  const dk = mix(col, C.ink, 0.4)
  const leg = (T: string, K: string, cl: string): string =>
    `<g class="${T}" stroke="${cl}" ${RC}><path d="M0-84v38" stroke-width="10"/>` +
    `<g class="${K}"><path d="M0-46v40" stroke-width="8"/><path d="M-1-3h9" stroke-width="6"/></g></g>`
  const arm = (A: string, cl: string): string =>
    `<path class="${A}" d="M0-136q1 18 3 38" stroke="${cl}" stroke-width="8" fill="none" ${RC}/>`
  return (
    `<ellipse rx="22" ry="4" fill="${C.shadow}" opacity=".35"/>` +
    `<g class="${S.bob}">` +
    arm(S.arB, dk) +
    leg(S.thB, S.knB, dk) +
    leg(S.thA, S.knA, col) +
    `<path d="M-10-142q12-4 20 1l4 82h-30z" fill="${col}"/>` +
    `<circle cx="2" cy="-153" r="9.5" fill="${col}"/><path d="M-8-156q1-13 11-13t9 13z" fill="${mix(col, C.fog, 0.15)}"/>` +
    arm(S.arA, col) +
    `</g>`
  )
}

type Stop = { p: number; x: number; y: number; s: number; o: number }
const travelKF = (list: Stop[]): string =>
  list.map(t => `${n(t.p)}%{transform:translate(${n(t.x)}px,${n(t.y)}px) scale(${s3(t.s)});opacity:${o2(t.o)}}`).join('')

/** Opacity of a background figure by distance (fog). */
const bgOp = (z: number): number => Math.max(0.22, Math.min(0.75, 0.85 * (1 - 0.85 * fogK(z))))

/**
 * A perspective loop: walk from depth zA to zB at constant world speed during
 * the first `walk` fraction of the loop, then hold, invisible. `vis(z,t)` is the
 * opacity at depth z and walk-progress t (0..1). The 0 % and 100 % frames must
 * be invisible (opacity 0 or fully off-frame); checked by the build script.
 */
function perspLoop(X: (z: number) => number, zA: number, zB: number, walk: number, N: number, vis: (z: number, t: number) => number): Stop[] {
  const list: Stop[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const z = zA + (zB - zA) * t
    list.push({ p: t * walk * 100, x: sx(X(z), z), y: sy(0, z), s: FOC / (100 * z), o: vis(z, t) })
  }
  const last = list[list.length - 1]
  if (last) list.push({ ...last, p: 100, o: 0 })
  if (last) last.o = 0
  return list
}

const people: string[] = []
const rigInfo: string[] = [] // notes for the build script's sanity check

// A. the girl
{
  const list = perspLoop(z => pathX(z) - 0.3, GIRL_Z0, GIRL_Z1, GIRL_WALK, 26, (z, t) => Math.min(1 - 0.88 * fogK(z * 0.85), t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25)))
  const tr = an(travelKF(list), GIRL_LOOP, -8, 'linear', false)
  people.push(`<g class="${tr}">${girlRig()}</g>`)
  rigInfo.push('girl')
}

// B1. side-view walkers on the far cross-path
{
  const STEP = 2 * 84 * Math.sin((SIDE_SWING * Math.PI) / 180) // design units per step
  const cross = (z: number, dir: number, T: number, figs: { dx: number; dy: number; k: number; ph: number }[], ph0: number): void => {
    const s = FOC / (100 * z)
    const speed = (2 * STEP * s) / T // px per second: feet don't skate
    const x0 = -70
    const x1 = 1670
    const dur = (x1 - x0) / speed
    const y = sy(0, z)
    const a = dir > 0 ? x0 : x1
    const b = dir > 0 ? x1 : x0
    const o = bgOp(z)
    const tr = an(
      `0%{transform:translate(${n(a)}px,${n(y)}px) scale(${s3(s)})}100%{transform:translate(${n(b)}px,${n(y)}px) scale(${s3(s)})}`,
      dur,
      -dur * ph0,
      'linear',
      false,
    )
    const inner = figs
      .map(f => {
        const ph = descCls(`animation-duration:${o2(T)}s;animation-delay:calc(${o2(-f.ph * T)}s - var(--t))`)
        const col = mix(C.figure, C.fog, fogK(z) * 0.5)
        return `<g transform="translate(${n(f.dx)} ${n(f.dy)}) scale(${f.k})"><g class="${ph}">${sideRig(col)}</g></g>`
      })
      .join('')
    people.push(`<g class="${tr}"><g opacity="${o2(o)}"${dir < 0 ? ' transform="scale(-1 1)"' : ''}>${inner}</g></g>`)
    rigInfo.push(`cross z=${z} dir=${dir} dur=${n(dur)}s speed=${n(speed)}px/s`)
  }
  cross(84, 1, 1.1, [{ dx: 0, dy: 0, k: 1, ph: 0 }], 0.31)
  cross(79, -1, 1.04, [{ dx: 0, dy: 0, k: 0.95, ph: 0.2 }], 0.72)
  // the pair: farther one first, slightly different heights, steps out of phase
  cross(76.5, 1, 1.18, [
    { dx: 6, dy: -9, k: 0.93, ph: 0.12 },
    { dx: -6, dy: 4, k: 1.04, ph: 0 },
  ], 0.05)
}

// B2. back-view walkers on the side footpaths (perspective loops)
{
  const foot = (Xs: number[], zA: number, zB: number, loop: number, walk: number, delay: number, ks: number[]): void => {
    const toward = zB < zA
    const X0 = Xs[0] ?? 0
    const list = perspLoop(() => X0, zA, zB, walk, 18, (z, t) => {
      const base = bgOp(z)
      if (toward) return base * Math.min(1, t / 0.1) // fade in from the fog
      return base * Math.min(1, Math.max(0, (1 - t) / 0.2)) // fade out into it
    })
    const tr = an(travelKF(list), loop, -delay, 'linear', false)
    const inner = Xs.map((X, i) => {
      // offset of the companion in design units at this figure's scale (same z)
      const dx = (X - X0) * 100
      const ph = descCls(`animation-delay:calc(${o2(-((i * 0.37 + delay * 0.13) % GT))}s - var(--t))`)
      return `<g transform="translate(${n(dx)} 0) scale(${ks[i] ?? 1})"><g class="${ph}">${backRig(C.figure, true)}</g></g>`
    }).join('')
    people.push(`<g class="${tr}">${inner}</g>`)
    rigInfo.push(`foot X=${Xs.join(',')} z ${zA}->${zB} loop=${loop}s`)
  }
  foot([-5.6], 72, 4.6, 61, 0.9, 17, [1]) // single, toward the viewer, left footpath
  foot([3.6], 4, 88, 83, 0.92, 51, [0.96]) // single, away, between trees and cars
  foot([-5.0, -5.7], 70, 4.2, 127, 0.94, 88, [1, 0.94]) // a pair, toward the viewer
}

// B3. one figure standing under the far lamp, shifting weight now and then
{
  const z = LAMPS[2] ?? 55
  const s = FOC / (100 * z)
  const sh = an(
    '0%,40%{transform:translateX(0) rotate(0)}50%,90%{transform:translateX(.6px) rotate(.8deg)}100%{transform:translateX(0) rotate(0)}',
    10.3,
    -4,
    'ease-in-out',
    false,
  )
  people.push(
    `<g transform="translate(${n(sx(LAMP_X - 0.45, z))} ${n(sy(0, z))}) scale(${s3(s)})" opacity="${o2(bgOp(z))}"><g class="${sh}">${backRig(C.figure, false)}</g></g>`,
  )
}

// fog in front of the lane's far end: the receding figures sink into it
const pathVeil =
  `<rect y="${HY - 70}" width="1600" height="200" fill="url(#hz)"/>` +
  `<ellipse cx="${n(sx(pathX(60), 60))}" cy="${HY + 62}" rx="640" ry="120" fill="url(#fg)"/>`

// ============================== 9. foreground fringe =======================

function fringe(): string {
  const groups: { x0: number; x1: number; count: number; len: [number, number]; col: string; op: number; pivot: number; dur: number }[] = [
    { x0: -40, x1: 560, count: 7, len: [80, 150], col: mix(C.ink, C.shadow, 0.15), op: 0.92, pivot: 260, dur: 7.3 },
    { x0: 1040, x1: 1640, count: 7, len: [80, 150], col: mix(C.ink, C.shadow, 0.15), op: 0.92, pivot: 1340, dur: 8.9 },
    { x0: 600, x1: 1000, count: 3, len: [40, 75], col: mix(C.ink, C.fog, 0.35), op: 0.45, pivot: 800, dur: 6.1 },
  ]
  return groups
    .map(gr => {
      const acc = mkAcc(0, false, false)
      for (let i = 0; i < gr.count; i++) {
        const x = rnd(gr.x0, gr.x1)
        const y = rnd(1012, 1045)
        const stems = 2 + (R() < 0.5 ? 1 : 0)
        for (let j = 0; j < stems; j++) {
          const lean = x < 700 ? 0.12 : x > 900 ? -0.12 : 0
          branch(x, y, rnd(-0.45, 0.45) + lean, rnd(gr.len[0], gr.len[1]), 1, 3, acc, ni, 0)
        }
      }
      const parts = acc.lv
        .map((segs, lev) => (segs.length ? `<path d="${segs.join('')}" stroke-width="${n(Math.max(0.8, 4.2 * Math.pow(0.6, lev - 1)))}"/>` : ''))
        .join('')
      const sw = an('from{transform:rotate(-.5deg)}to{transform:rotate(.5deg)}', gr.dur, -rnd(0, gr.dur), 'ease-in-out', true, org(gr.pivot, 1040))
      return `<g class="${sw}" stroke="${gr.col}" opacity="${o2(gr.op)}">${parts}</g>`
    })
    .join('')
}

// ============================== 10. power lines ============================

const wires = (() => {
  const sw = an('from{transform:translateY(-1.5px)}to{transform:translateY(1.5px)}', 8, -1.7)
  const sw2 = an('from{transform:translateY(1.2px)}to{transform:translateY(-1.2px)}', 9.4, -5.3)
  const col = mix(C.ink, C.shadow, 0.3)
  return (
    `<g fill="none" stroke="${col}">` +
    `<path class="${sw}" d="M-20 64Q700 196 1630 36" stroke-width="1.5" opacity=".6"/>` +
    `<path class="${sw2}" d="M-20 104Q760 238 1630 92" stroke-width="1.2" opacity=".5"/>` +
    `<path class="${sw}" d="M-20 150Q620 258 1630 128" stroke-width="1" opacity=".42"/>` +
    `</g>`
  )
})()

// ============================== 11. snow ===================================

function snowLayer(i: number): string {
  const L = SNOW[i]
  if (!L) return ''
  R = mulberry32(SEED + 101 * (i + 1))
  const subs: string[] = []
  for (let k = 0; k < 3; k++) {
    const id = `s${i}${k}`
    const cnt = Math.round(L.n / 3)
    const [r0 = 1, r1 = 2] = L.r
    const [o0 = 0.4, o1 = 0.6] = L.op
    let content = ''
    if (!L.bokeh) {
      // three size buckets, each one path of round-capped dots
      const buckets: string[][] = [[], [], []]
      for (let j = 0; j < cnt; j++) {
        const b = Math.floor(R() * 3)
        buckets[b]?.push('M' + pj([ni(rnd(-150, 1750)), ni(rnd(-150, 1150))]) + 'h.1')
      }
      content = buckets
        .map((d, b) => {
          const r = r0 + ((r1 - r0) * (b + 0.5)) / 3
          const o = o0 + ((o1 - o0) * (b === 1 ? 0.8 : b === 0 ? 0.2 : 0.5))
          return `<path d="${d.join('')}" stroke-width="${n(2 * r)}" opacity="${o2(o)}"/>`
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
  return `<g transform="rotate(${L.ang} 800 500)" ${paint}>${subs.join('')}</g>`
}

// ============================== assemble ===================================

const nearTrees = trees.filter(t => t.z < 20)
const farTrees = trees.filter(t => t.z >= 20)

out.push(snowLayer(0)) // farthest snow sits behind trees and people
out.push(`<g fill="none" stroke-linecap="round">${farTrees.map(t => t.s).join('')}</g>`)
out.push(`<g fill="none" stroke-linecap="round">${bushes()}</g>`)
out.push(`<g>${people.join('')}</g>`)
out.push(pathVeil)
out.push(`<g fill="none" stroke-linecap="round">${nearTrees.map(t => t.s).join('')}</g>`)
out.push(`<g fill="none" stroke-linecap="round">${fringe()}</g>`)
out.push(wires)
for (let i = 1; i < SNOW.length; i++) out.push(snowLayer(i))

// 12. near fog veil and vignette
{
  const v = an('from{transform:translateX(-90px)}to{transform:translateX(90px)}', 71, -20)
  out.push(
    `<ellipse class="${v}" cx="800" cy="560" rx="900" ry="260" fill="url(#fh)" opacity=".1"/>`,
    `<rect width="1600" height="1000" fill="url(#vg)"/>`,
    `<rect y="800" width="1600" height="200" fill="url(#vb)"/>`,
  )
}

css.push('@media (prefers-reduced-motion:reduce){*{animation-play-state:paused!important}}')

// ============================== reply text layer ===========================
// The latest reply hangs over the lane as rows of pale letters strung on thin
// wires between the building lines, each row deeper than the last.

const TXT_ROWS = 6
const TXT_COLS = 34
const TXT_Z = [16, 19, 23, 28, 34, 42] // row depths, m
const TXT_TOP_Y = 110 // screen y of row 1's wire ends
const TXT_Y = CAM + ((HY - TXT_TOP_Y) * (TXT_Z[0] ?? 16)) / FOC // world height of every wire (~10.6 m)
const TXT_SAG = 0.5 // wire sag at mid-span, m
const TXT_X0 = -14 // wire ends: the building lines either side
const TXT_X1 = 13.6
const TXT_OP = [0.5, 0.44, 0.38, 0.32, 0.27, 0.22]
const TXT_FILL = '#d6e4f6'
const TXT_EDGE = '#3d5a88'

type TxtRow = { z: number; x0: number; x1: number; y0: number; cy: number; cx: number; f: number; cls: string; op: number }

/** Row geometry, solved once: the largest font ∝ 1/z (≤ 60 px at row 1) whose rows don't overlap. */
const TXT_GEO: TxtRow[] = (() => {
  const base = TXT_Z.map(z => {
    const x0 = sx(TXT_X0, z)
    const x1 = sx(TXT_X1, z)
    const y0 = sy(TXT_Y, z)
    const sag = (TXT_SAG * FOC) / z
    const cx = sx(pathX(z), z)
    const t = (cx - x0) / (x1 - x0)
    return { z, x0, x1, y0, cy: y0 + 2 * sag, cx, wy: y0 + 4 * t * (1 - t) * sag }
  })
  // a row spans [wy + .15f, wy + 1.12f] (threads, then cap height to descender)
  let K = 60 * (TXT_Z[0] ?? 16)
  for (; K > 100; K -= 4) {
    let ok = true
    for (let i = 0; i + 1 < base.length; i++) {
      const a = base[i]
      const b = base[i + 1]
      if (a && b && a.wy + (1.12 * K) / a.z > b.wy + (0.15 * K) / b.z - 2) ok = false
    }
    if (ok) break
  }
  return base.map((r, i) => {
    const dur = 7 + ((i * 1.7) % 5) + rnd(0, 0.6)
    const midX = (r.x0 + r.x1) / 2
    const cls = an(
      'from{transform:translateY(-1.5px) rotate(-.5deg)}to{transform:translateY(1.5px) rotate(.5deg)}',
      dur,
      -rnd(0, dur),
      'ease-in-out',
      true,
      org(midX, r.y0 + (TXT_SAG * FOC) / r.z),
    )
    return { z: r.z, x0: r.x0, x1: r.x1, y0: r.y0, cy: r.cy, cx: r.cx, f: K / r.z, cls, op: TXT_OP[i] ?? 0.3 }
  })
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

function textLayer(text: string): string {
  const rows = wrapRows(cleanText(text))
  if (!rows.length) return ''
  const wireCol = mix(C.ink, C.shadow, 0.3)
  const parts: string[] = []
  // far rows first, so nearer rows sit in front
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = TXT_GEO[i]
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
      `<g class="${r.cls}" opacity="${o2(r.op)}">` +
        `<path d="M${pj([n(r.x0), n(r.y0)])}Q${pj([n((r.x0 + r.x1) / 2), n(r.cy), n(r.x1), n(r.y0)])}${threads}" stroke="${wireCol}" stroke-width="${n(Math.max(0.6, 19 / r.z))}" fill="none" opacity=".45"/>` +
        `<text x="${n(r.cx + d)}" y="${n(base + d)}" font-size="${n(r.f)}" fill="${TXT_EDGE}" opacity=".4">${e}</text>` +
        `<text x="${n(r.cx)}" y="${n(base)}" font-size="${n(r.f)}">${e}</text></g>`,
    )
  }
  return (
    `<g id="txt" font-family="-apple-system,'Helvetica Neue',Arial,sans-serif" font-weight="600" letter-spacing=".04em" text-anchor="middle" fill="${TXT_FILL}">` +
    parts.join('') +
    '</g>'
  )
}

// The heavy static scene, built once, split at its two markers.
const STATIC =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style="--t:${T_MARK}s">` +
  `<style>${css.join('')}</style>` +
  `<defs>${defs.join('')}</defs>` +
  out.join('') +
  '</svg>'
const [HEAD = '', REST = ''] = STATIC.split(T_MARK)
const [MID = '', TAIL = ''] = REST.split(TEXT_MARK)

/**
 * The whole scene with the reply hung over the lane. `elapsed` is seconds since
 * a fixed epoch: every animation's delay subtracts it, so phases carry on across
 * redraws. Cheap: string joins plus the small text layer.
 */
export function sceneWith(opts: { elapsed: number; text: string }): string {
  const e = Number.isFinite(opts.elapsed) ? opts.elapsed : 0
  return HEAD + e.toFixed(2) + MID + textLayer(typeof opts.text === 'string' ? opts.text : '') + TAIL
}

/** Text-layer geometry, for the preview build's notes. */
export const TEXT_NOTES: string[] = TXT_GEO.map(
  (r, i) => `row ${i + 1}: z=${r.z} wire y=${n(r.y0)} font=${n(r.f)}px opacity=${o2(r.op)}`,
)

export const SCENE: string = sceneWith({ elapsed: 0, text: '' })

/** Notes for the preview build (not part of the drawing). */
export const SCENE_NOTES: string[] = rigInfo
