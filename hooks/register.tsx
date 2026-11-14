import { atom, read, update } from 'claude-code'
import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { sceneWith } from './scene.js'
import { registerSound, setVolume, showVolume, startSound, switchKeys, toggleMute } from './sound.js'

// Steel-blue dusk: dark only, to sit under the snowy evening scene.
const { theme, problems } = makeColors({
  label: 'Winter evening',
  only: 'dark',
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
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: 'winter-evening', glass: { blur: 1.5, tint: '#0a1524', opacity: 0.4 } },
}

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

const ALT =
  'Snow falling over a foggy blue courtyard between apartment blocks at dusk, people walking along a snowy path'

// The scene as last drawn, kept so a redraw with the same words hands the
// surface the same document and nothing reloads.
let drawn: { text: string; source: string } | undefined

export const register: Register = on => {
  registerSound(on)

  on('session.start', async ($, e, next) => {
    // Before the scene can draw: every drawing counts its motion from here.
    if ((await read($, sceneEpoch)) === 0) {
      const now = await $.clock.now()
      await update($, sceneEpoch, () => now)
    }
    // An older build of the app takes the scene but not the colors: give it
    // the scene alone, so it still has the look's picture and its sound.
    try {
      await $.theme.set(LOOK)
    } catch {
      await $.theme.set({ backdrop: LOOK.backdrop }).catch(() => {})
    }
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

  // The volume row above the message box: quieter, a bar, louder, mute, hide.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isVolumeShown))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, volume)
    const isSnow = (await read($, keySound)) === 'snow'
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
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== 'winter-evening') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)
    const text = (await read($, isTextShown)) ? await read($, replyText) : ''

    if (drawn === undefined || drawn.text !== text) {
      const epoch = await read($, sceneEpoch)
      const now = await $.clock.now()
      const elapsed = epoch === 0 ? 0 : Math.max(0, (now - epoch) / 1000)
      drawn = { text, source: sceneWith({ elapsed, text }) }
    }

    return <Svg source={drawn.source} alt={ALT} isInteractive />
  })
}
