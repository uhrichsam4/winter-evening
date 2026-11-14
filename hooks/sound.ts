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

type Kind = 'key' | 'step'

let isMusicOn = true
let isCrunchOn = true
// When each kind last sounded: a keystroke never swallows the send's step.
const lastAt: Record<Kind, number> = { key: 0, step: 0 }
let lastIndex = 0
let song: AbortController | undefined
let nextSong: { cancel: () => void } | undefined

function crunch($: EngineInterface, kind: Kind): void {
  if (!isCrunchOn) {
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
  const gain = kind === 'key' ? 0.55 + Math.random() * 0.4 : 0.8 + Math.random() * 0.3

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
  if (!isMusicOn) {
    return
  }
  stopSong()
  song = new AbortController()
  $.audio.play({ asset: SONG }, { gain: SONG_GAIN, signal: song.signal }).catch(() => {})
  nextSong = $.clock.after(SONG_MS + SONG_GAP_MS, () => {
    void playSong($)
  })
}

// Called from the mod's one `session.start` hook.
export async function startSound($: EngineInterface): Promise<void> {
  isMusicOn = (await $.store.get('music')) !== false
  isCrunchOn = (await $.store.get('crunch')) !== false
  // The copy of the reply in the scene is off unless asked for.
  const isText = (await $.store.get('text')) === true
  await update($, isTextShown, () => isText)
  await $.command.register({
    name: 'winter',
    description: 'Winter evening: /winter music, /winter crunch, /winter text, /winter quiet, /winter on',
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

    if (word === 'music') {
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
      text: `Winter evening: music ${isMusicOn ? 'on' : 'off'}, snow crunch ${isCrunchOn ? 'on' : 'off'}, reply copied into the scene ${isText ? 'on' : 'off'}. Change with /winter music, /winter crunch, /winter text, /winter quiet or /winter on.`,
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
