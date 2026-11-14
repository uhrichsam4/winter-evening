import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

// Sound for the winter evening look: snow crunches under typing and sending,
// and one quiet song on repeat. Credits for the recordings: ../CREDITS.md.

const SONG = 'sounds/midvinter.m4a'
const SONG_MS = 274_000
const SONG_GAP_MS = 7_000
const SONG_GAIN = 0.8
const KEY_COUNT = 8
const STEP_COUNT = 6
const KEY_MIN_GAP_MS = 75
const STEP_MIN_GAP_MS = 220

// Whether the reply is drawn in the scene (/winter text); register.tsx reads it.
const isTextShown = atom({ plugin: 'winter-evening', key: 'isTextShown' } as const, false)

// How loud everything is, 0 to 100 in steps of ten; the volume row above the
// message box draws it (register.tsx).
const volume = atom({ plugin: 'winter-evening', key: 'volume' } as const, 100)

// Whether that volume row is shown (/winter volume).
const isVolumeShown = atom({ plugin: 'winter-evening', key: 'isVolumeShown' } as const, true)

// The player takes its loudness when a song starts, so a change has to start
// the song again: wait until the person has stopped pressing.
const RETUNE_AFTER_MS = 1_200

type Kind = 'key' | 'step'

let isMusicOn = true
let isCrunchOn = true
// When each kind last sounded: a keystroke never swallows the send's step.
const lastAt: Record<Kind, number> = { key: 0, step: 0 }
let lastIndex = 0
let song: AbortController | undefined
let nextSong: { cancel: () => void } | undefined
// The loudness now, 0 to 1, and the one the song now playing was started at.
let level = 1
let songLevel = 1
let retune: { cancel: () => void } | undefined
// What Unmute goes back to.
let unmuteTo = 100

function crunch($: EngineInterface, kind: Kind): void {
  if (!isCrunchOn || level === 0) {
    return
  }
  const now = Date.now()

  if (now - lastAt[kind] < (kind === 'key' ? KEY_MIN_GAP_MS : STEP_MIN_GAP_MS)) {
    return
  }
  lastAt[kind] = now
  const count = kind === 'key' ? KEY_COUNT : STEP_COUNT
  // Never the same recording twice running.
  const index = 1 + ((lastIndex + Math.floor(Math.random() * (count - 1))) % count)
  lastIndex = index
  const gain = (kind === 'key' ? 0.55 + Math.random() * 0.4 : 0.8 + Math.random() * 0.3) * level

  // A sound that cannot play must never hold up the typing or the send.
  try {
    $.audio.play({ asset: `sounds/${kind}${index}.wav` }, { gain }).catch(() => {})
  } catch {
    // Nothing to do: the crunch is decoration.
  }
}

function stopSong(): void {
  nextSong?.cancel()
  nextSong = undefined
  song?.abort()
  song = undefined
}

async function playSong($: EngineInterface): Promise<void> {
  stopSong()
  songLevel = level

  if (!isMusicOn || level === 0) {
    return
  }
  song = new AbortController()
  $.audio.play({ asset: SONG }, { gain: SONG_GAIN * level, signal: song.signal }).catch(() => {})
  nextSong = $.clock.after(SONG_MS + SONG_GAP_MS, () => {
    void playSong($)
  })
}

// Sets how loud the crunches and the song are, 0 to 100. The crunches follow at
// once; the song starts again at the new loudness a moment after the last change.
export async function setVolume($: EngineInterface, percent: number): Promise<void> {
  const next = Math.max(0, Math.min(100, Math.round(percent / 10) * 10))

  if (next > 0) {
    unmuteTo = next
  }
  level = next / 100
  await update($, volume, () => next)
  await $.store.set('volume', next)
  retune?.cancel()
  retune = $.clock.after(RETUNE_AFTER_MS, () => {
    retune = undefined

    if (level !== songLevel) {
      void playSong($)
    }
  })
}

// Silence, or back to the loudness before it.
export async function toggleMute($: EngineInterface): Promise<void> {
  await setVolume($, level === 0 ? unmuteTo : 0)
}

export async function showVolume($: EngineInterface, isShown: boolean): Promise<void> {
  await update($, isVolumeShown, () => isShown)
  await $.store.set('volumeBar', isShown)
}

// Called from the mod's one `session.start` hook.
export async function startSound($: EngineInterface): Promise<void> {
  isMusicOn = (await $.store.get('music')) !== false
  isCrunchOn = (await $.store.get('crunch')) !== false
  // The copy of the reply in the scene is off unless asked for.
  const isText = (await $.store.get('text')) === true
  await update($, isTextShown, () => isText)
  const saved = await $.store.get('volume')
  const percent = typeof saved === 'number' && saved >= 0 && saved <= 100 ? saved : 100
  level = percent / 100
  unmuteTo = percent > 0 ? percent : 100
  await update($, volume, () => percent)
  const isBar = (await $.store.get('volumeBar')) !== false
  await update($, isVolumeShown, () => isBar)
  await $.command.register({
    name: 'winter',
    description: 'Winter evening: /winter volume 40, /winter music, /winter crunch, /winter text, /winter quiet, /winter on',
  })

  // A reload of the mod ends the song it was playing, so each start begins one.
  await playSong($)
}

export function registerSound(on: On): void {
  on('session.end', ($, e, next) => {
    // /clear ends the session's record, not the evening: the song plays on.
    if (e.reason !== 'clear') {
      stopSong()
    }

    return next(e)
  })

  on('command.run', { command: 'winter' }, async ($, e) => {
    // `/winter music` flips it; `/winter music on` or `off` says which.
    const [word = '', want = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const flip = (now: boolean): boolean => (want === 'on' ? true : want === 'off' ? false : !now)

    if (word === 'volume') {
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
    }
    await $.store.set('music', isMusicOn)
    await $.store.set('crunch', isCrunchOn)

    if (!isMusicOn) {
      stopSong()
    } else if (song === undefined && nextSong === undefined) {
      await playSong($)
    }

    const isText = await read($, isTextShown)

    return {
      text: `Winter evening: volume ${Math.round(level * 100)}%, music ${isMusicOn ? 'on' : 'off'}, snow crunch ${isCrunchOn ? 'on' : 'off'}, reply copied into the scene ${isText ? 'on' : 'off'}. Change with /winter volume 40, /winter music, /winter crunch, /winter text, /winter quiet or /winter on.`,
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

  // A press on any button a mod drew.
  on('ui.press', { plugin: '*' }, ($, e, next) => {
    crunch($, 'step')

    return next(e)
  })
}
