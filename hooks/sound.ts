import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

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
const KEY_COUNT = 4
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

type Kind = 'key' | 'step'

let isMusicOn = true
let isCrunchOn = true
// When each kind last sounded: a keystroke never swallows the send's step.
const lastAt: Record<Kind, number> = { key: 0, step: 0 }
let lastIndex = 0
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

function stopPlayer(): void {
  doubleCheck?.cancel()
  doubleCheck = undefined
  const mine = player
  player = undefined

  mine?.stop()
}

// Writes what the person chose for every chat, and for the player, to read.
async function writeControl($: EngineInterface): Promise<void> {
  if (controlPath === '') {
    return
  }
  const control = { volume: Math.round(level * 100), music: isMusicOn, gain: SONG_GAIN * level }
  await $.fs.write(controlPath, `${JSON.stringify(control)}\n`).catch(() => {})
}

// Takes up what the person last chose in any chat; false when nothing is written yet.
async function readControl($: EngineInterface): Promise<boolean> {
  try {
    const text = await $.fs.read(controlPath)
    const control: unknown = JSON.parse(typeof text === 'string' ? text : '')

    if (typeof control !== 'object' || control === null) {
      return false
    }
    const { volume: saved, music } = control as { volume?: unknown; music?: unknown }

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
  await readControl($)

  if (!isMusicOn) {
    stopPlayer()
  } else if (player === undefined && (await playersRunning($)) === 0) {
    startPlayer($)
  }
  lookSoon($, LOOK_EVERY_MS + Math.random() * 4_000)
}

// Sets how loud the crunches and the song are, 0 to 100, in every chat. The
// song follows while it plays: it does not start over.
export async function setVolume($: EngineInterface, percent: number): Promise<void> {
  const next = Math.max(0, Math.min(100, Math.round(percent / 10) * 10))

  if (next > 0) {
    unmuteTo = next
  }
  level = next / 100
  await update($, volume, () => next)
  await writeControl($)
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
  const home = await $.env.get('HOME')
  controlPath = home === undefined || home === '' ? '' : `${home}/${CONTROL}`
  isCrunchOn = (await $.store.get('crunch')) !== false
  // The copy of the reply in the scene is off unless asked for.
  const isText = (await $.store.get('text')) === true
  await update($, isTextShown, () => isText)

  // The first chat ever writes the control file; every other one reads it.
  if (controlPath !== '' && !(await readControl($))) {
    await writeControl($)
  }
  await update($, volume, () => Math.round(level * 100))
  const isBar = (await $.store.get('volumeBar')) !== false
  await update($, isVolumeShown, () => isBar)
  await $.command.register({
    name: 'winter',
    description: 'Winter evening: /winter volume 40, /winter music, /winter crunch, /winter text, /winter quiet, /winter on',
  })

  // A little apart from the other chats starting in the same moment.
  lookSoon($, 300 + Math.random() * 2_500)
}

export function registerSound(on: On): void {
  on('session.end', ($, e, next) => {
    // /clear ends the session's record, not the evening: the song plays on.
    if (e.reason !== 'clear') {
      look?.cancel()
      look = undefined
      stopPlayer()
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
    await $.store.set('crunch', isCrunchOn)
    // The player reads the same file: it ends itself when the music goes off,
    // and the look below starts one when it comes back on.
    await writeControl($)
    await keepSong($)

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
