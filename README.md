# Winter evening

A look for the Claude desktop app: a cold, foggy, steel-blue evening in an apartment-block
courtyard, seen as if from a window. Behind the conversation, snow falls in five depths, fog
drifts between the buildings, bare trees sway, a girl walks away up the lane and other people
cross in the distance. It also plays a snow crunch as you type and send, and a quiet song.

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
macOS (through `afplay`).

A volume row sits above the message box: `−` and `+` change the level in ten steps for the
crunches and the song together, `Mute` silences everything, and `Hide` puts the row away.
Changing the level starts the song again from the beginning, because the player sets its
loudness when a track starts.

- `/winter volume 40` sets the level; `/winter volume` alone shows or hides the row.
- `/winter music` turns the song on or off.
- `/winter crunch` turns the snow crunches on or off.
- `/winter text` draws the first lines of the latest reply into the scene, hung over the lane.
- `/winter quiet` silences everything, `/winter on` brings the sound back.

Add `on` or `off` to say which, as in `/winter music off`.

The crunch plays when you type in the message box, when you send, and when you press a button a
mod drew. Mods cannot hear other mouse clicks.

## Credits

The song is 'Midvinter' by Scott Buckley, released under CC-BY 4.0 (www.scottbuckley.com.au).
The snow steps were recorded by Iwan "qubodup" Gabovitch and are in the public domain (CC0).
Details and the changes made to each are in [CREDITS.md](CREDITS.md).

## License

The code is under the MIT License: see [LICENSE](LICENSE). The audio keeps its own terms.
