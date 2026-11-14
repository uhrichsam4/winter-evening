import type { ProcessSpawnChunk } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'winter-evening',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

test('the volume row lowers the sound a step at a time, mutes and unmutes', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  // Nothing sits beneath the plugin: these stand for the engine.
  on('audio.play', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('██████████ 100%')
  await ui.press({ key: 'quieter' })
  await ui.press({ key: 'quieter' })
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('████████░░ 80%')

  await ui.press({ key: 'mute' })
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('░░░░░░░░░░ 0%')
  await ui.press({ key: 'mute' })
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('████████░░ 80%')
  await ui.unmount()
})

test('hiding the row leaves the band to the engine', async ($, on) => {
  mock.clock(on)
  mock.store(on, { volumeBar: false })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)
  await ui.unmount()
})

test('a change of volume is written for every chat and the player, and starts no second player', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/someone' })
  const written: string[] = []
  let spawned = 0
  let running = 0
  // These stand for the engine: the control file, `pgrep`, and the player.
  on('fs.read', () => {
    if (written.length === 0) {
      throw new Error('no such file')
    }

    return { value: written[written.length - 1] ?? '' }
  })
  on('fs.write', (_, e) => {
    written.push(e.text)

    return { value: undefined }
  })
  on('process.run', () => ({
    value: {
      exitCode: running > 0 ? 0 : 1,
      stdout: running > 0 ? '4242\n' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('process.spawn', async function* (): AsyncGenerator<ProcessSpawnChunk, void> {
    spawned += 1
    running += 1
    // The player writes nothing while it plays; it ends when it is stopped.
    await new Promise<void>(() => {})
  })
  on('command.register', () => ({ value: { command: 'winter' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.parse(written[written.length - 1] ?? '{}')).toEqual({ volume: 100, music: true, gain: 0.8 })

  // The first look starts the one player; later looks find it running.
  await clock.advance(4_000)
  expect(spawned).toBe(1)
  await clock.advance(60_000)
  expect(spawned).toBe(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'quieter' })
  await ui.press({ key: 'quieter' })
  await ui.press({ key: 'quieter' })
  expect(JSON.parse(written[written.length - 1] ?? '{}').volume).toBe(70)
  // The song is turned down where it is: no new player.
  await clock.advance(30_000)
  expect(spawned).toBe(1)
  await ui.unmount()
})
