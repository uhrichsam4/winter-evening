import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { sceneWith } from './scene.js'
import type { Tone } from './scene.js'
import {
  registerSound,
  setLook,
  setVolume,
  noteBackdrop,
  showVolume,
  startLooks,
  startSound,
  switchKeys,
  switchTheme,
  toggleMute,
} from './sound.js'

// Two colourways, dark only. Black: Space Black graphite with a warm ember
// accent. Blue: the steel-blue dusk of the first winter look. (Plain objects,
// so the preview build can check both.)
const BLACK_COLORS = {
  codeTheme: { dark: 'nord' },
  roles: { accent: '#e9a66b', danger: '#e06a62', success: '#7fbf8f', warning: '#e3c558', pro: '#a98ad8' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#111113',
        'surface-1': '#17171a',
        'surface-2': '#1d1d20',
        'surface-3': '#202024',
        'text-primary': '#f1eee9',
        'text-secondary': '#cfcac2',
        'text-muted': '#aaa59c',
      },
    },
  },
}
const BLUE_COLORS = {
  codeTheme: { dark: 'nord' },
  roles: { accent: '#6fa8e8', danger: '#e0605f', success: '#5fb58a', warning: '#e0a850', pro: '#a58be0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0d1826',
        'surface-1': '#122033',
        'surface-2': '#17283f',
        'surface-3': '#1a2c45',
        'text-primary': '#e8f0fa',
        'text-secondary': '#c0cfe2',
        'text-muted': '#9fb2ca',
      },
    },
  },
}
const black = makeColors({ label: 'Winter evening', only: 'dark', ...BLACK_COLORS })
const blue = makeColors({ label: 'Winter evening', only: 'dark', ...BLUE_COLORS })
const problems = [...black.problems, ...blue.problems]

const LOOKS: Record<Tone, ThemeSetArgs> = {
  black: { colors: black.theme, backdrop: { scene: 'winter-evening', glass: { blur: 1.5, tint: '#0e0e10', opacity: 0.42 } } },
  blue: { colors: blue.theme, backdrop: { scene: 'winter-evening', glass: { blur: 1.5, tint: '#0a1524', opacity: 0.4 } } },
}

// Which colourway shows: 'black' or 'blue' (kept in the store as `tone`).
const tone = atom({ plugin: 'winter-evening', key: 'tone' } as const, 'black')
const toneOf = (v: unknown): Tone => (v === 'blue' ? 'blue' : 'black')

// The latest reply, which /winter text draws into the scene as rows of letters
// hung over the lane.
const replyText = atom({ plugin: 'winter-evening', key: 'replyText' } as const, '')

// When the scene first drew. Every redraw continues the motion from here, so
// new text never restarts the snow or the walkers.
const sceneEpoch = atom({ plugin: 'winter-evening', key: 'sceneEpoch' } as const, 0)

// Whether the reply is drawn in the scene (/winter text, in sound.ts).
const isTextShown = atom({ plugin: 'winter-evening', key: 'isTextShown' } as const, false)

// How loud the sound is, 0 to 100, and whether its row above the message box
// is shown (sound.ts keeps both).
const volume = atom({ plugin: 'winter-evening', key: 'volume' } as const, 100)
const isVolumeShown = atom({ plugin: 'winter-evening', key: 'isVolumeShown' } as const, true)

// Which typing sound plays, 'drops' or 'snow' (sound.ts keeps it).
const keySound = atom({ plugin: 'winter-evening', key: 'keySound' } as const, 'drops')

// Whether this is the theme that shows (sound.ts keeps it, from ~/.claude/looks.json).
const isActive = atom({ plugin: 'winter-evening', key: 'isActive' } as const, true)

const ALT =
  'A slow drone flight down an endless snowy street at night: warm lit windows and shopfronts, lamps with garlands, lit firs, parked cars and people walking both ways'

// The scene as last drawn, kept so a redraw with the same words hands the
// surface the same document and nothing reloads.
let drawn: { text: string; tone: Tone; source: string } | undefined

// Black to Blue or back (or to `to`): the look follows at once while this
// theme shows; while it rests the choice is kept for when it shows again.
async function setTone($: EngineInterface, to?: Tone): Promise<Tone> {
  const next = to ?? (toneOf(await read($, tone)) === 'blue' ? 'black' : 'blue')
  await update($, tone, () => next)
  await $.store.set('tone', next)
  await setLook($, LOOKS[next])

  return next
}

export const register: Register = on => {
  // `/winter colour` (or `color`) flips Black and Blue; `/winter black` and
  // `/winter blue` pick one. Before the sound's hooks, so it answers these first.
  on('command.run', { command: 'winter' }, async ($, e, next) => {
    const [word = '', want = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (word !== 'colour' && word !== 'color' && word !== 'black' && word !== 'blue') {
      // The sound's answer, with the colour added.
      const answer = await next(e)
      const colour = `Colour: ${toneOf(await read($, tone)) === 'blue' ? 'Blue' : 'Black'}.`

      return typeof answer?.text === 'string' ? { ...answer, text: `${answer.text} ${colour}` } : answer
    }
    const to = word === 'black' || word === 'blue' ? word : want === 'black' || want === 'blue' ? want : undefined
    const now = await setTone($, to)
    const resting = !(await read($, isActive))

    return {
      text: `Winter evening: colour ${now === 'blue' ? 'Blue' : 'Black'}${resting ? ' (Winter is resting: the colour shows when it does)' : ''}. /winter colour switches; /winter black or /winter blue picks one.`,
    }
  })
  registerSound(on)

  on('session.start', async ($, e, next) => {
    // Before the scene can draw: every drawing counts its motion from here.
    if ((await read($, sceneEpoch)) === 0) {
      const now = await $.clock.now()
      await update($, sceneEpoch, () => now)
    }
    // The look, when this is the theme that shows (sound.ts; an older build
    // of the app gets the scene alone, so it still has the look's picture).
    const saved = toneOf(await $.store.get('tone'))
    await update($, tone, () => saved)
    await startLooks($, LOOKS[saved])
    // While you build: the line that would stop Desktop painting this look.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    // No status line: a reload answers before the app has attached again, and
    // the reason it gives then is out of date a moment later.
    $.ui.status(undefined)
    await startSound($)

    return next(e)
  })

  // The main conversation's answer is kept for /winter text.
  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)

    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      const text = e.answer.slice(0, 4000)
      await update($, replyText, () => text).catch(() => {})
    }

    return answer
  })

  // The volume row above the message box: quieter, a bar, louder, mute, keys,
  // colour, theme, hide. None while another theme shows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isVolumeShown)) || !(await read($, isActive))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, volume)
    const isSnow = (await read($, keySound)) === 'snow'
    const isBlue = toneOf(await read($, tone)) === 'blue'
    // Ten cells, drawn as text: every build of the app has Text, not every one
    // has a progress bar.
    const filled = Math.round(now / 10)
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)

    return (
      <Box gap={1} alignItems="center">
        <Text dimColor>Sound</Text>
        <Button key="quieter" label="−" onPress={() => setVolume($, now - 10)} />
        <Text>{`${bar} ${now}%`}</Text>
        <Button key="louder" label="+" onPress={() => setVolume($, now + 10)} />
        <Button key="mute" label={now === 0 ? 'Unmute' : 'Mute'} onPress={() => toggleMute($)} />
        <Button key="keys" label={isSnow ? 'Keys: snow crunch' : 'Keys: soft taps'} onPress={() => switchKeys($)} />
        <Button key="tone" label={isBlue ? 'Colour: Blue' : 'Colour: Black'} onPress={() => setTone($)} />
        <Button key="look" label="Theme: Winter" onPress={() => switchTheme($)} />
        <Button
          key="hide"
          label="Hide"
          onPress={async () => {
            await showVolume($, false)
            $.ui.toast('Volume row hidden. /winter volume brings it back.')
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    // Every mod hears every backdrop drawing: note whose it is, for the theme
    // switch (sound.ts), before drawing or passing it on.
    noteBackdrop(e.props.plugin)

    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== 'winter-evening') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)
    const text = (await read($, isTextShown)) ? await read($, replyText) : ''
    const t = toneOf(await read($, tone))

    if (drawn === undefined || drawn.text !== text || drawn.tone !== t) {
      const epoch = await read($, sceneEpoch)
      const now = await $.clock.now()
      const elapsed = epoch === 0 ? 0 : Math.max(0, (now - epoch) / 1000)
      drawn = { text, tone: t, source: sceneWith({ elapsed, text, tone: t }) }
    }

    return <Svg source={drawn.source} alt={ALT} isInteractive />
  })
}
