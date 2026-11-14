declare module 'claude-code' {
  interface PluginState {
    'winter-evening': {
      /** The latest reply, which /winter text draws into the scene. */
      replyText: string
      /** When the scene first drew, in the clock's milliseconds; 0 before. */
      sceneEpoch: number
      /** How loud the crunches and the song are, 0 to 100. */
      volume: number
      /** Which typing sound plays: 'drops' (soft taps) or 'snow' (snow crunch). */
      keySound: string
      /** Whether the volume row above the message box is shown. */
      isVolumeShown: boolean
      /** Whether the reply is drawn in the scene. */
      isTextShown: boolean
    }
  }
}
