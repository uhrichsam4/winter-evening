declare module 'claude-code' {
  interface PluginState {
    'winter-evening': {
      /** The latest reply, which /winter text draws into the scene. */
      replyText: string
      /** When the scene first drew, in the clock's milliseconds; 0 before. */
      sceneEpoch: number
      /** Whether the reply is drawn in the scene. */
      isTextShown: boolean
    }
  }
}
