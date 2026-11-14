// The song's player, run by macOS's own `osascript -l JavaScript`:
//
//   osascript -l JavaScript song-player.js <song file> <control file>
//
// It plays the song on a loop and reads the control file a few times a second,
// so the loudness follows the volume row at once and the song never starts
// over. The control file is JSON, `{ "gain": 0.4, "music": true }`, written by
// hooks/sound.ts in whichever chat the person changed it. The player ends when
// the file says the music is off, when the file is gone, or when the chat that
// started it has gone away.

ObjC.import('AVFoundation')
ObjC.import('Foundation')
ObjC.import('unistd')

function run(argv) {
  const songPath = argv[0]
  const controlPath = argv[1]
  const player = $.AVAudioPlayer.alloc.initWithContentsOfURLError($.NSURL.fileURLWithPath(songPath), null)

  if (player.isNil()) {
    return 'cannot open the song'
  }

  // The gain asked for now, 0 to 1; -1 when the music is off or the file is unreadable.
  const gain = () => {
    const text = $.NSString.stringWithContentsOfFileEncodingError(controlPath, $.NSUTF8StringEncoding, null)

    if (text.isNil()) {
      return -1
    }

    try {
      const control = JSON.parse(ObjC.unwrap(text))
      const value = Number(control.gain)

      return control.music === false || !isFinite(value) ? -1 : Math.max(0, Math.min(1, value))
    } catch (error) {
      return -1
    }
  }

  let now = gain()

  if (now < 0) {
    return 'the music is off'
  }
  player.numberOfLoops = -1
  player.volume = now
  player.play

  for (;;) {
    delay(0.35)
    const next = gain()

    // Parent 1 means the chat that started this player is gone.
    if (next < 0 || $.getppid() === 1) {
      break
    }

    if (Math.abs(next - now) > 0.001) {
      player.setVolumeFadeDuration(next, 0.25)
      now = next
    }
  }
  player.stop

  return 'stopped'
}
