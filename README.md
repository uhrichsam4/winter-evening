# Winter evening

A look for the Claude desktop app: a slow drone flight, about nine metres up, forward down an
endless snowy street on a winter night. It comes in two colours: Black, graphite close to a
Space Black MacBook Pro (a near-black sky, dark neutral fog, charcoal buildings and soft grey
snow, with an ember accent), and Blue, the steel-blue dusk of the first winter look. The warmth is in the lights, passing by on both sides so the conversation in the middle
stays over the calm, foggy far end of the street: lit windows (a few flicker like a TV or a
fire), shopfronts under snowy awnings with garlands, lamps with soft halos and strings of bulbs
to the walls, lit firs, parked cars under snow. People walk both ways on the pavements and in the
lane, a girl in a knitted hat among them; the drone slowly overtakes some and others come past.
Snow falls and streams past the camera. It also plays a soft tap as you type, a snow step when
you send, and a quiet song.

The scene is one script-free SVG animated with CSS, so it is an illustration, not a photograph.

## Install

At the prompt of a terminal session:

```
/plugin install winter-evening --marketplace uhrichsam4/winter-evening
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install winter-evening --marketplace uhrichsam4/winter-evening
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `uhrichsam4/winter-evening`, then Add plugin.

## Using it

The look draws in the Claude desktop and mobile apps; a terminal draws no look. Sound plays on
macOS (the crunches through `afplay`, the song through `osascript`).

A volume row sits above the message box: `−` and `+` change the level in ten steps for the
crunches and the song together, `Mute` silences everything, `Colour: Black` / `Colour: Blue`
switches the colourway (the app's colours and the scene change together), and `Hide` puts the
row away.
The song turns up or down while it plays; it does not start over.

- `/winter volume 40` sets the level; `/winter volume` alone shows or hides the row.
- `/winter music` turns the song on or off.
- `/winter keys` switches the typing sound between soft taps and a snow crunch; the row has a
  button for it too.
- `/winter crunch` turns the snow crunches on or off.
- `/winter text` draws the first lines of the latest reply into the scene, hung on wires across
  the street a little ahead of the drone.
- `/winter quiet` silences everything, `/winter on` brings the sound back.
- `/winter colour` (or `/winter color`) switches between Black and Blue; `/winter black` and
  `/winter blue` pick one. The choice is kept for the next session.
- `/winter theme` switches to the next installed theme (see Switching themes).

Add `on` or `off` to say which, as in `/winter music off`.

The song plays once for the whole computer, however many chats are open. One chat runs a small
player (`player/song-player.js`, through macOS's own `osascript`); the others see it running and
leave it be. The volume and the music switch are shared, so changing them in any chat changes
the one song. They are kept in `~/.claude/winter-evening-sound.json`.

The crunch plays when you type in the message box, when you send, and when you press a button a
mod drew. Mods cannot hear other mouse clicks.

## Switching themes

Winter evening can be installed beside another look mod, such as Miami sunset. One theme shows
at a time, in every chat; the others rest, with no look, no row and no sound.

- `Theme: Winter` on the volume row hands the screen to the next installed theme.
- `/winter theme` does the same; `/miami theme` does it from Miami sunset.
- `/winter on` brings Winter back (and its sound) and makes it the theme that shows; `/miami on`
  does the same for Miami.

A newly installed theme shows itself first. The themes share `~/.claude/looks.json`; while Winter
rests, the song stops in every chat and your volume and music choices are kept.

If no theme shows after removing one, type `/winter on` or `/miami on`.

## Credits

The song is 'Midvinter' by Scott Buckley, released under CC-BY 4.0 (www.scottbuckley.com.au).
The snow steps were recorded by Iwan "qubodup" Gabovitch and are in the public domain (CC0).
Details and the changes made to each are in [CREDITS.md](CREDITS.md).

## License

The code is under the MIT License: see [LICENSE](LICENSE). The audio keeps its own terms.
