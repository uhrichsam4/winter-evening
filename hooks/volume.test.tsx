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
