import type { EngineInterface } from 'claude-code'

// The theme switch shared by the look mods (winter-evening, miami-sunset). Each
// keeps this same file. They share one small file under the person's home
// folder, `~/.claude/looks.json`:
//
//   { "look": "miami-sunset", "looks": { "winter-evening": "Winter", "miami-sunset": "Miami" } }
//
// `look` is the one theme that shows, in every chat; `looks` lists the
// installed look mods, name to button label, in the order they joined.

// `broken` is set when the file is there but could not be read
// ('unreadable') or did not parse as the switch's file ('malformed'): a
// caller must not write over it then, since it may hold another mod's entry.
export type Looks = { look?: string; looks: Record<string, string>; broken?: 'unreadable' | 'malformed' }

const FILE = '.claude/looks.json'
// How long a start waits before reading a malformed file again.
const REREAD_MS = 150

async function looksPath($: EngineInterface): Promise<string> {
  try {
    const home = await $.env.get('HOME')

    return home === undefined || home === '' ? '' : `${home}/${FILE}`
  } catch {
    return ''
  }
}

async function writeLooks($: EngineInterface, state: Looks): Promise<void> {
  const path = await looksPath($)

  if (path === '') {
    return
  }
  const data = state.look === undefined ? { looks: state.looks } : { look: state.look, looks: state.looks }

  try {
    await $.fs.write(path, `${JSON.stringify(data, null, 2)}\n`)
  } catch {
    // Nowhere to write: this chat still knows what it chose.
  }
}

// Whether the file is there, after a read failed; a failed check counts as missing.
async function isThere($: EngineInterface, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

function pause($: EngineInterface, ms: number): Promise<void> {
  return new Promise(resolve => {
    $.clock.after(ms, () => resolve())
  })
}

// The shared file as it is now. A missing one is no theme chosen and none
// listed; an unreadable or malformed one the same, marked `broken`. Never throws.
export async function readLooks($: EngineInterface): Promise<Looks> {
  const path = await looksPath($)

  if (path === '') {
    return { looks: {} }
  }
  let text: unknown

  try {
    text = await $.fs.read(path)
  } catch {
    return (await isThere($, path)) ? { looks: {}, broken: 'unreadable' } : { looks: {} }
  }

  try {
    const data: unknown = JSON.parse(typeof text === 'string' ? text : '')

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { looks: {}, broken: 'malformed' }
    }
    const { look, looks } = data as { look?: unknown; looks?: unknown }

    if (typeof looks !== 'object' || looks === null || Array.isArray(looks)) {
      return { looks: {}, broken: 'malformed' }
    }
    const listed: Record<string, string> = {}

    for (const [name, label] of Object.entries(looks)) {
      if (typeof label === 'string' && name !== '__proto__') {
        listed[name] = label
      }
    }

    return typeof look === 'string' && look !== '' ? { look, looks: listed } : { looks: listed }
  } catch {
    return { looks: {}, broken: 'malformed' }
  }
}

// Makes sure this mod is listed; writes only when something changed, and
// never over a broken file. `isInstall` (the session's start only): a mod
// newly listed takes the look, as a newly installed theme shows itself, and a
// file still malformed when read again a moment later is written anew. Any
// other time a mod takes the look only when none is chosen.
export async function joinLooks(
  $: EngineInterface,
  name: string,
  label: string,
  isInstall: boolean,
): Promise<Looks> {
  let state = await readLooks($)

  if (state.broken !== undefined) {
    if (!isInstall || state.broken !== 'malformed') {
      return state
    }
    await pause($, REREAD_MS)
    state = await readLooks($)

    if (state.broken === 'unreadable') {
      return state
    }

    if (state.broken === 'malformed') {
      state = { looks: {} }
    }
  }
  const isListed = Object.hasOwn(state.looks, name)
  let isChanged = false

  if (!isListed || state.looks[name] !== label) {
    state.looks[name] = label
    isChanged = true
  }

  if ((state.look === undefined || (isInstall && !isListed)) && state.look !== name) {
    state.look = name
    isChanged = true
  }

  if (isChanged) {
    await writeLooks($, state)
  }

  return state
}

// Makes `name` the theme that shows, in every chat; nothing over a broken file.
export async function chooseLook($: EngineInterface, name: string): Promise<Looks> {
  const state = await readLooks($)

  if (state.broken !== undefined) {
    return state
  }
  state.look = name
  await writeLooks($, state)

  return state
}

// The theme after `current` in the listed order, wrapping round; `current`
// itself when it is the only one.
export function nextLook(state: Looks, current: string): string {
  const names = Object.keys(state.looks)

  if (names.length === 0) {
    return current
  }
  const index = names.indexOf(current)

  return index === -1 ? (names[0] ?? current) : (names[(index + 1) % names.length] ?? current)
}
