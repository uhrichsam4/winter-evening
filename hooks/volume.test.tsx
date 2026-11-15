import type { On, ProcessSpawnChunk } from 'claude-code'
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

const HOME = '/home/someone'
const CONTROL = `${HOME}/.claude/winter-evening-sound.json`
const LOOKS = `${HOME}/.claude/looks.json`
const BOTH = { 'winter-evening': 'Winter', 'miami-sunset': 'Miami' }

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
  const others: Record<string, string> = {}
  let spawned = 0
  let running = 0
  // These stand for the engine: the control file (and the shared theme file
  // beside it), `pgrep`, and the player.
  on('fs.read', (_, e) => {
    if (e.path !== CONTROL) {
      const text = others[e.path]

      if (text === undefined) {
        throw new Error('no such file')
      }

      return { value: text }
    }

    if (written.length === 0) {
      throw new Error('no such file')
    }

    return { value: written[written.length - 1] ?? '' }
  })
  on('fs.write', (_, e) => {
    if (e.path === CONTROL) {
      written.push(e.text)
    } else {
      others[e.path] = e.text
    }

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
  expect(JSON.parse(written[written.length - 1] ?? '{}')).toEqual({ volume: 100, music: true, gain: 0.8, look: true })

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

// The engine beneath the plugin for a chat with the shared theme file: the
// files by path, `pgrep`, the player, and every call the switch makes.
function chat(on: On, files: Record<string, string>) {
  const seen = { themeSets: 0, themeClears: 0, toasts: [] as string[], sounds: 0, spawned: 0, looksReads: 0, looksWrites: 0 }
  let running = 0
  mock.store(on)
  mock.env(on, { HOME })
  on('fs.read', (_, e) => {
    if (e.path === LOOKS) {
      seen.looksReads += 1
    }
    const text = files[e.path]

    if (text === undefined) {
      throw new Error('no such file')
    }

    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined }))
  on('fs.write', (_, e) => {
    if (e.path === LOOKS) {
      seen.looksWrites += 1
    }
    files[e.path] = e.text

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
    seen.spawned += 1
    running += 1
    await new Promise<void>(() => {})
  })
  on('audio.play', () => {
    seen.sounds += 1

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'winter' } }))
  on('theme.set', () => {
    seen.themeSets += 1

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => {
    seen.themeClears += 1

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return seen
}

const looksFile = (look: string, looks: Record<string, string> = BOTH): string => JSON.stringify({ look, looks })
const looksNow = (files: Record<string, string>): unknown => JSON.parse(files[LOOKS] ?? '{}')
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const AT_THE_PROMPT = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// Miami sunset as far as the switch sees it: a row with its Theme button,
// which makes Winter the look, and then leaves the band alone.
const MIAMI = {
  name: 'miami-sunset',
  register(on: On) {
    let isPressed = false
    on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
      if (isPressed) {
        return next(e)
      }
      const { Button } = $.ui.resolve(e)

      return (
        <Button
          key="look"
          label="Theme: Miami"
          onPress={async () => {
            isPressed = true
            const looks = { 'winter-evening': 'Winter', 'miami-sunset': 'Miami' }
            await $.fs.write('/home/someone/.claude/looks.json', JSON.stringify({ look: 'winter-evening', looks }))
          }}
        />
      )
    })
  },
}

test('while Miami is the theme, Winter sets no look and draws no row', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset') }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(seen.themeSets).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'look' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('the Theme button hands the screen to the next theme and the row goes', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening') }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(seen.themeSets).toBe(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'look' }))?.props.label).toBe('Theme: Winter')
  await ui.press({ key: 'look' })
  expect(looksNow(files)).toEqual({ look: 'miami-sunset', looks: BOTH })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)
  expect(JSON.parse(files[CONTROL] ?? '{}').look).toBe(false)
  expect(seen.themeClears).toBe(0)
  await ui.unmount()
})

test('a resting Winter comes back when the shared file names it again', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset') }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(seen.themeSets).toBe(0)

  files[LOOKS] = looksFile('winter-evening')
  await clock.advance(3_100)
  expect(seen.themeSets).toBe(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeDefined()
  await ui.unmount()
})

test("Miami's Theme button brings a resting Winter back at once", { plugins: [MIAMI] }, async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset') }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(seen.themeSets).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // No clock moved: the press itself hands over.
  await $.ui.press({ plugin: 'miami-sunset', key: 'look' })
  expect(seen.themeSets).toBe(1)
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeDefined()
  expect(seen.themeClears).toBe(0)
  await ui.unmount()
})

test('with no other theme installed, the Theme button changes nothing', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening', { 'winter-evening': 'Winter' }) }
  const seen = chat(on, files)

  await $.session.start(START)
  const before = files[LOOKS]

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'look' })
  expect(files[LOOKS]).toBe(before)
  expect(seen.toasts).toContain('No other theme is installed.')
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeDefined()
  expect(seen.themeSets).toBe(1)
  await ui.unmount()
})

test('/winter on makes Winter the theme, /winter theme hands it on', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset') }
  const seen = chat(on, files)

  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)

  const turnedOn = await $.command.run({ command: 'winter', args: 'on', ...AT_THE_PROMPT })
  expect(looksNow(files)).toEqual({ look: 'winter-evening', looks: BOTH })
  expect(seen.themeSets).toBe(1)
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeDefined()
  expect(JSON.stringify(turnedOn)).toContain('theme showing Winter')

  await $.command.run({ command: 'winter', args: 'theme', ...AT_THE_PROMPT })
  expect(looksNow(files)).toEqual({ look: 'miami-sunset', looks: BOTH })
  expect(await ui.find({ type: 'Text', text: /%/ })).toBe(undefined)
  expect(seen.themeClears).toBe(0)
  await ui.unmount()
})

test('with no file, Winter is listed and is the look', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {}
  const seen = chat(on, files)

  await $.session.start(START)
  expect(looksNow(files)).toEqual({ look: 'winter-evening', looks: { 'winter-evening': 'Winter' } })
  expect(seen.themeSets).toBe(1)
})

test('a Winter newly listed at its start takes the look', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset', { 'miami-sunset': 'Miami' }) }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(looksNow(files)).toEqual({ look: 'winter-evening', looks: { 'miami-sunset': 'Miami', 'winter-evening': 'Winter' } })
  expect(seen.themeSets).toBe(1)
})

test('a Winter listed again by the watch does not take a chosen look', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('miami-sunset') }
  const seen = chat(on, files)

  await $.session.start(START)
  files[LOOKS] = looksFile('miami-sunset', { 'miami-sunset': 'Miami' })
  await clock.advance(3_100)
  expect(looksNow(files)).toEqual({ look: 'miami-sunset', looks: { 'miami-sunset': 'Miami', 'winter-evening': 'Winter' } })
  expect(seen.themeSets).toBe(0)
})

test('the theme file is not written when nothing changed', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening') }
  const seen = chat(on, files)

  await $.session.start(START)
  await clock.advance(10_000)
  expect(seen.looksWrites).toBe(0)
})

test('a broken read of the theme file on a watch tick writes nothing', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening') }
  const seen = chat(on, files)

  await $.session.start(START)
  files[LOOKS] = '{"look": "mia'
  await clock.advance(3_100)
  expect(seen.looksWrites).toBe(0)
  expect(files[LOOKS]).toBe('{"look": "mia')
  expect(seen.themeSets).toBe(1)
})

test('the watch stops when the session ends, but not on /clear', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening') }
  const seen = chat(on, files)

  await $.session.start(START)
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  let before = seen.looksReads
  await clock.advance(3_100)
  expect(seen.looksReads).toBeGreaterThan(before)

  await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } })
  before = seen.looksReads
  await clock.advance(10_000)
  expect(seen.looksReads).toBe(before)
})

test("Winter puts its look back when another theme's picture is up", async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [LOOKS]: looksFile('winter-evening') }
  const seen = chat(on, files)

  await $.session.start(START)
  expect(seen.themeSets).toBe(1)

  // The backdrop drawn is Miami's, though the file names Winter.
  const scene = await $.ui.mount({
    plugin: 'winter-evening',
    component: 'Backdrop',
    requestId: 'backdrop',
    props: { scene: 'miami-sunset', plugin: 'miami-sunset', glass: false },
    surface: 'desktop',
  })
  await scene.unmount()
  await clock.advance(3_100)
  expect(seen.themeSets).toBe(2)
  // Once put back, not again on every look.
  await clock.advance(10_000)
  expect(seen.themeSets).toBe(2)
  expect(seen.themeClears).toBe(0)
})

test('a resting Winter is silent, starts no song, and takes up choices made elsewhere', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [LOOKS]: looksFile('miami-sunset'),
    [CONTROL]: JSON.stringify({ volume: 40, music: true, gain: 0.32, look: true }),
  }
  const seen = chat(on, files)

  await $.session.start(START)
  const resting = JSON.parse(files[CONTROL] ?? '{}')
  expect([resting.volume, resting.music, resting.look]).toEqual([40, true, false])

  // The test engine cannot raise `prompt.edit`; a send goes through the same gate.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await clock.advance(30_000)
  expect(seen.sounds).toBe(0)
  expect(seen.spawned).toBe(0)

  // The person's choices, made in another chat while Winter rested.
  files[CONTROL] = JSON.stringify({ volume: 70, music: false, gain: 0.56, look: false })
  files[LOOKS] = looksFile('winter-evening')
  await clock.advance(3_100)
  const back = JSON.parse(files[CONTROL] ?? '{}')
  expect([back.volume, back.music, back.look]).toEqual([70, false, true])
  await clock.advance(20_000)
  // The music is off: still no song.
  expect(seen.spawned).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /%/ }))?.text).toBe('███████░░░ 70%')
  await ui.unmount()
})
