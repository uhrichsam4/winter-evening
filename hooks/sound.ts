import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ThemeSetArgs } from 'claude-code'

import { chooseLook, joinLooks, nextLook, readLooks } from './looks.js'

// Sound for the winter evening look: a soft tap under typing, a snow step on
// sending,
// and one quiet song on repeat. Credits for the recordings: ../CREDITS.md.
//
// The song is one for the whole computer, however many chats are open, and its
// loudness changes while it plays. Every chat runs this mod, so they share one
// small file, the control file: what the person last chose, in any chat. One
// chat runs the player (player/song-player.js), which follows that file; the
// others see the player is running and leave it be.

const SONG = 'sounds/midvinter.m4a'
const PLAYER = 'player/song-player.js'
// Where the control file is kept, under the person's home folder.
const CONTROL = '.claude/winter-evening-sound.json'
// How `pgrep -f` knows the player among the computer's processes.
const PLAYER_MATCH = '^osascript -l JavaScript .*player/song-player\\.js'
// How often a chat looks: for the person's choices made in another chat, and
// for whether the player is still running.
const LOOK_EVERY_MS = 12_000
// Two chats can start a player in the same moment: each looks once more
// shortly after, and one that hears two stops its own for a while.
const DOUBLE_CHECK_MS = 2_500
const SONG_GAIN = 0.8
// The typing sounds to choose between, and how many recordings each has.
const KEY_SOUNDS = { drops: 4, snow: 8 } as const
type KeySound = keyof typeof KEY_SOUNDS
const STEP_COUNT = 6
const KEY_MIN_GAP_MS = 75
const STEP_MIN_GAP_MS = 220
// This mod in the shared theme switch (looks.ts), and how often a chat looks
// at it for a switch made in another chat.
const ME = 'winter-evening'
const LABEL = 'Winter'
const WATCH_EVERY_MS = 3_000
const PRESS_RECHECK_MS = 300

// Whether the reply is drawn in the scene (/winter text); register.tsx reads it.
const isTextShown = atom({ plugin: 'winter-evening', key: 'isTextShown' } as const, false)

// How loud everything is, 0 to 100 in steps of ten; the volume row above the
// message box draws it (register.tsx).
const volume = atom({ plugin: 'winter-evening', key: 'volume' } as const, 100)

// Which typing sound plays: the soft taps or the snow crunch (/winter keys).
const keySound = atom({ plugin: 'winter-evening', key: 'keySound' } as const, 'drops')

// Whether that volume row is shown (/winter volume).
const isVolumeShown = atom({ plugin: 'winter-evening', key: 'isVolumeShown' } as const, true)

// Whether this is the theme that shows (~/.claude/looks.json); while it is not,
// the look, its row and its sounds rest.
const isActive = atom({ plugin: 'winter-evening', key: 'isActive' } as const, true)

type Kind = 'key' | 'step'

// The same as isActive, kept here for the sounds, which must not wait on it.
let isShowing = true
// The look to give the app when this theme shows (register.tsx).
let lookArgs: ThemeSetArgs | undefined
let watch: { cancel: () => void } | undefined
// What the control file last said about the look; not one of the person's choices.
let controlLook = true
// Who set the session's backdrop, as the last drawing of it said; undefined
// until one does.
let backdropOwner: string | undefined

let isMusicOn = true
let isCrunchOn = true
// When each kind last sounded: a keystroke never swallows the send's step.
const lastAt: Record<Kind, number> = { key: 0, step: 0 }
let lastIndex = 0
let keys: KeySound = 'drops'
// This chat's own player, when it is the one running it.
let player: { stop: () => void } | undefined
let look: { cancel: () => void } | undefined
let doubleCheck: { cancel: () => void } | undefined
// The loudness now, 0 to 1.
let level = 1
// What Unmute goes back to.
let unmuteTo = 100
let controlPath = ''

function crunch($: EngineInterface, kind: Kind): void {
  if (!isShowing || !isCrunchOn || level === 0) {
    return
  }
  const now = Date.now()

  if (now - lastAt[kind] < (kind === 'key' ? KEY_MIN_GAP_MS : STEP_MIN_GAP_MS)) {
    return
  }
  lastAt[kind] = now
  const count = kind === 'key' ? KEY_SOUNDS[keys] : STEP_COUNT
  // Never the same recording twice running.
  const index = 1 + ((lastIndex + Math.floor(Math.random() * (count - 1))) % count)
  lastIndex = index
  const gain = (kind === 'key' ? 0.55 + Math.random() * 0.4 : 0.8 + Math.random() * 0.3) * level

  // A sound that cannot play must never hold up the typing or the send.
  try {
    const asset = kind === 'key' ? `sounds/keys-${keys}/key${index}.wav` : `sounds/step${index}.wav`
    $.audio.play({ asset }, { gain }).catch(() => {})
  } catch {
    // Nothing to do: the crunch is decoration.
  }
}

function stopPlayer(): void {
  doubleCheck?.cancel()
  doubleCheck = undefined
  const mine = player
  player = undefined

  mine?.stop()
}

// Writes what the person chose for every chat, and for the player, to read.
// `look` says whether this theme shows: the player ends while it does not.
async function writeControl($: EngineInterface): Promise<void> {
  if (controlPath === '') {
    return
  }
  const control = { volume: Math.round(level * 100), music: isMusicOn, gain: SONG_GAIN * level, look: isShowing }
  await $.fs.write(controlPath, `${JSON.stringify(control)}\n`).catch(() => {})
  controlLook = isShowing
}

// Takes up what the person last chose in any chat; false when nothing is written yet.
async function readControl($: EngineInterface): Promise<boolean> {
  try {
    const text = await $.fs.read(controlPath)
    const control: unknown = JSON.parse(typeof text === 'string' ? text : '')

    if (typeof control !== 'object' || control === null) {
      return false
    }
    // `look` is the theme switch's, not the person's: only noted.
    const { volume: saved, music, look: shown } = control as { volume?: unknown; music?: unknown; look?: unknown }
    controlLook = shown !== false

    if (typeof saved === 'number' && saved >= 0 && saved <= 100) {
      level = saved / 100

      if (saved > 0) {
        unmuteTo = saved
      }
      await update($, volume, () => saved)
    }
    isMusicOn = music !== false

    return true
  } catch {
    return false
  }
}

// How many players are running on this computer, this chat's included; -1
// when that cannot be told (no `pgrep` here, or it failed).
async function playersRunning($: EngineInterface): Promise<number> {
  try {
    const found = await $.process.run(['pgrep', '-f', PLAYER_MATCH], { timeoutMs: 5_000 })

    if (found.exitCode === 0) {
      return found.stdout.split('\n').filter(line => line.trim() !== '').length
    }

    return found.exitCode === 1 ? 0 : -1
  } catch {
    return -1
  }
}

function startPlayer($: EngineInterface): void {
  const stream = $.process.spawn({
    argv: ['osascript', '-l', 'JavaScript', `${$.plugin.root}/${PLAYER}`, `${$.plugin.root}/${SONG}`, controlPath],
  })
  const mine = {
    // Ending the stream ends the player.
    stop: (): void => {
      stream.return({ code: null, signal: 'SIGTERM' }).catch(() => {})
    },
  }
  player = mine
  // The loop is the player's life: it ends when the player does.
  void (async () => {
    try {
      for await (const piece of stream) {
        void piece
      }
    } catch {
      // No `osascript` here, or the player failed: there is no song.
    }

    if (player === mine) {
      player = undefined
    }
  })()
  doubleCheck = $.clock.after(DOUBLE_CHECK_MS + Math.random() * 1_500, () => {
    doubleCheck = undefined
    void stepBackIfDoubled($)
  })
}

async function stepBackIfDoubled($: EngineInterface): Promise<void> {
  if (player !== undefined && (await playersRunning($)) > 1) {
    stopPlayer()
    lookSoon($, 3_000 + Math.random() * 12_000)
  }
}

function lookSoon($: EngineInterface, afterMs: number): void {
  look?.cancel()
  look = $.clock.after(afterMs, () => {
    void keepSong($)
  })
}

// One look: take up the person's choices, and start the player if the music
// is on and no chat is running it. Then look again later, for as long as the
// chat lives.
async function keepSong($: EngineInterface): Promise<void> {
  // While another theme shows, no song: looking starts again when this one does.
  if (!isShowing) {
    look?.cancel()
    look = undefined
    stopPlayer()

    return
  }
  await readControl($)

  if (!isShowing) {
    return
  }

  if (!isMusicOn) {
    stopPlayer()
  } else if (player === undefined && (await playersRunning($)) === 0 && isShowing) {
    // Still the theme that shows after the wait for `pgrep`.
    startPlayer($)
  }
  lookSoon($, LOOK_EVERY_MS + Math.random() * 4_000)
}

// Gives the app the look. An older build of the app takes the scene but not
// the colors: give it the scene alone, so it still has the look's picture.
async function applyLook($: EngineInterface): Promise<void> {
  if (lookArgs === undefined) {
    return
  }

  try {
    await $.theme.set(lookArgs)
  } catch {
    await $.theme.set({ backdrop: lookArgs.backdrop }).catch(() => {})
  }
  // Until a drawing of the backdrop says otherwise.
  backdropOwner = ME
}

// Who set the session's backdrop, as its last drawing said (register.tsx).
export function noteBackdrop(owner: string): void {
  backdropOwner = owner
}

// This theme shows, or rests while another does. Resting never clears the
// theme: the other mod's look replaces it.
async function becomeShown($: EngineInterface, isShown: boolean): Promise<void> {
  isShowing = isShown
  await update($, isActive, () => isShown)

  if (isShown) {
    await applyLook($)
  } else {
    look?.cancel()
    look = undefined
    stopPlayer()
  }
}

// Shows or rests as the shared file says now, taking up the person's latest
// sound choices first, and tells the player.
async function followLooks($: EngineInterface, isShown: boolean): Promise<void> {
  if (isShown === isShowing) {
    return
  }
  await readControl($)
  await becomeShown($, isShown)
  await writeControl($)

  if (isShown) {
    await keepSong($)
  }
}

// One look at the shared theme file: back on the list if this mod is missing
// from it, and shown or resting as it says.
// A file caught half written, or unreadable, is left for the next look.
async function syncLooks($: EngineInterface): Promise<void> {
  let state = await readLooks($)

  if (state.broken !== undefined) {
    return
  }
  let isRejoined = false

  if (!Object.hasOwn(state.looks, ME)) {
    state = await joinLooks($, ME, LABEL, false)

    if (state.broken !== undefined) {
      return
    }
    isRejoined = true
  }
  const isShown = state.look === ME

  if (isShown !== isShowing) {
    await followLooks($, isShown)
  } else if (isShown && backdropOwner !== ME && (isRejoined || backdropOwner !== undefined)) {
    // Shown, but another theme's picture is up: put this one back.
    await applyLook($)
  }
}

function watchSoon($: EngineInterface): void {
  watch?.cancel()
  watch = $.clock.after(WATCH_EVERY_MS, () => {
    watchSoon($)
    void syncLooks($).catch(() => {})
  })
}

// The Theme button: the next installed theme shows, in every chat, and this
// one rests; when no other is installed, nothing changes.
export async function switchTheme($: EngineInterface): Promise<void> {
  const state = await joinLooks($, ME, LABEL, false)

  if (state.broken !== undefined) {
    $.ui.toast('The theme file could not be read just now. Try again in a moment.')

    return
  }
  // From this theme while it shows; from the one showing while it rests.
  const from = isShowing ? ME : (state.look ?? ME)
  const to = nextLook(state, from)

  if (to === from) {
    $.ui.toast('No other theme is installed.')

    return
  }
  if ((await chooseLook($, to)).broken === undefined) {
    await followLooks($, to === ME)
  }
}

// Called first from the mod's one `session.start` hook: joins the theme switch
// and gives the app the look when this theme is the one that shows.
export async function startLooks($: EngineInterface, args: ThemeSetArgs): Promise<void> {
  lookArgs = args
  // The session's start is the install: a theme new to the list shows itself.
  const state = await joinLooks($, ME, LABEL, true)
  isShowing = state.look === ME
  await update($, isActive, () => isShowing)

  if (isShowing) {
    await applyLook($)
  }
}

// The label of the theme that shows now, for the command's answer.
async function shownLabel($: EngineInterface): Promise<string> {
  if (isShowing) {
    return LABEL
  }
  const state = await readLooks($)

  return state.look === undefined ? 'another' : (state.looks[state.look] ?? state.look)
}

// Sets how loud the crunches and the song are, 0 to 100, in every chat. The
// song follows while it plays: it does not start over.
export async function setVolume($: EngineInterface, percent: number): Promise<void> {
  const next = Math.max(0, Math.min(100, Math.round(percent / 10) * 10))

  // The person's latest choices first, made in any chat.
  await readControl($)

  if (next > 0) {
    unmuteTo = next
  }
  level = next / 100
  await update($, volume, () => next)
  await writeControl($)
}

// Switches the typing sound between the soft taps and the snow crunch, and
// plays one so the person hears which it is now.
export async function switchKeys($: EngineInterface, to?: string): Promise<void> {
  keys = to === 'snow' || to === 'drops' ? to : keys === 'drops' ? 'snow' : 'drops'
  await update($, keySound, () => keys)
  await $.store.set('keys', keys)
  lastAt.key = 0
  crunch($, 'key')
}

// Silence, or back to the loudness before it.
export async function toggleMute($: EngineInterface): Promise<void> {
  await readControl($)
  await setVolume($, level === 0 ? unmuteTo : 0)
}

export async function showVolume($: EngineInterface, isShown: boolean): Promise<void> {
  await update($, isVolumeShown, () => isShown)
  await $.store.set('volumeBar', isShown)
}

// Called from the mod's one `session.start` hook.
export async function startSound($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  controlPath = home === undefined || home === '' ? '' : `${home}/${CONTROL}`
  isCrunchOn = (await $.store.get('crunch')) !== false
  keys = (await $.store.get('keys')) === 'snow' ? 'snow' : 'drops'
  await update($, keySound, () => keys)
  // The copy of the reply in the scene is off unless asked for.
  const isText = (await $.store.get('text')) === true
  await update($, isTextShown, () => isText)

  // The first chat ever writes the control file; every other one reads it,
  // and writes it again only to tell the player whether this theme shows.
  if (controlPath !== '' && (!(await readControl($)) || controlLook !== isShowing)) {
    await writeControl($)
  }
  await update($, volume, () => Math.round(level * 100))
  const isBar = (await $.store.get('volumeBar')) !== false
  await update($, isVolumeShown, () => isBar)
  await $.command.register({
    name: 'winter',
    description:
      'Winter evening: /winter keys, /winter volume 40, /winter music, /winter crunch, /winter text, /winter quiet, /winter on (sound on and Winter the theme that shows; also brings a theme back if none shows), /winter theme',
  })

  // One look at the theme file before any song: a Winter that rests never
  // starts it, even for a moment.
  await syncLooks($).catch(() => {})

  // A little apart from the other chats starting in the same moment. While
  // another theme shows there is no song.
  if (isShowing) {
    lookSoon($, 300 + Math.random() * 2_500)
  }
  watchSoon($)
}

export function registerSound(on: On): void {
  on('session.end', ($, e, next) => {
    // /clear ends the session's record, not the evening: the song plays on.
    if (e.reason !== 'clear') {
      look?.cancel()
      look = undefined
      watch?.cancel()
      watch = undefined
      stopPlayer()
    }

    return next(e)
  })

  on('command.run', { command: 'winter' }, async ($, e) => {
    // `/winter music` flips it; `/winter music on` or `off` says which.
    const [word = '', want = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const flip = (now: boolean): boolean => (want === 'on' ? true : want === 'off' ? false : !now)
    // The person's latest choices, made in any chat, before anything is written.
    await readControl($)

    if (word === 'keys') {
      // `/winter keys snow` or `/winter keys drops`; alone, it switches.
      await switchKeys($, want)
    } else if (word === 'volume') {
      // `/winter volume 40` sets it; `/winter volume` alone shows or hides the row.
      if (/^\d+$/.test(want)) {
        await setVolume($, Number(want))
      } else {
        await showVolume($, flip(await read($, isVolumeShown)))
      }
    } else if (word === 'music') {
      isMusicOn = flip(isMusicOn)
    } else if (word === 'crunch') {
      isCrunchOn = flip(isCrunchOn)
    } else if (word === 'text') {
      const isText = flip(await read($, isTextShown))
      await update($, isTextShown, () => isText)
      await $.store.set('text', isText)
    } else if (word === 'quiet' || word === 'off') {
      isMusicOn = false
      isCrunchOn = false
    } else if (word === 'on') {
      isMusicOn = true
      isCrunchOn = true
      // And this theme shows, in every chat.
      await joinLooks($, ME, LABEL, false)
      await chooseLook($, ME)
      await becomeShown($, true)
    } else if (word === 'theme') {
      await switchTheme($)
    }
    await $.store.set('crunch', isCrunchOn)
    // The player reads the same file: it ends itself when the music goes off,
    // and the look below starts one when it comes back on.
    await writeControl($)
    await keepSong($)

    const isText = await read($, isTextShown)
    const shown = await shownLabel($)

    return {
      text: `Winter evening: theme showing ${shown}${isShowing ? '' : ' (Winter is resting: no look, row or sound)'}, typing sound ${keys === 'snow' ? 'snow crunch' : 'soft taps'}, volume ${Math.round(level * 100)}%, music ${isMusicOn ? 'on' : 'off'}, snow crunch ${isCrunchOn ? 'on' : 'off'}, reply copied into the scene ${isText ? 'on' : 'off'}. Change with /winter keys, /winter volume 40, /winter music, /winter crunch, /winter text, /winter quiet or /winter on (which also makes Winter the theme that shows, and brings a theme back if none shows); /winter theme switches to the next theme.`,
    }
  })

  // Typing in the message box: a light crunch for each edit that changes the
  // text; a bare cursor move makes no sound.
  on('prompt.edit', ($, e, next) => {
    if (e.inputText !== '' || e.end > e.start) {
      crunch($, 'key')
    }

    return next(e)
  })

  // Sending a message: one whole step.
  on('prompt.submit', ($, e, next) => {
    crunch($, 'step')

    return next(e)
  })

  // A press on any button a mod drew. A Theme button (any look mod's) hands
  // over at once: its own handler, beneath, has written the shared file.
  on('ui.press', { plugin: '*' }, async ($, e, next) => {
    crunch($, 'step')
    const answer = await next(e)

    if (e.element === 'look') {
      await syncLooks($).catch(() => {})
      // Once more shortly, in case the button's handler wrote the file late.
      $.clock.after(PRESS_RECHECK_MS, () => {
        void syncLooks($).catch(() => {})
      })
    }

    return answer
  })
}
