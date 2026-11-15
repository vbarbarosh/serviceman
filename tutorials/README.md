# Tutorials

Each file here is one tutorial: a way of using serviceman, told as the steps a person takes and
what each step shows. No video is kept here. A video is made from a file whenever it is needed,
after the page or a feature changes too, by following this page.

| File | What it shows |
|------|---------------|
| [01-a-static-site.md](01-a-static-site.md) | A zip of HTML given on **Apps**, open at once, then behind authwall |
| [02-a-proxy-into-a-socket.md](02-a-proxy-into-a-socket.md) | A program with no port, reached through a socket file, behind authwall |
| [03-something-already-running.md](03-something-already-running.md) | A dashboard already on a port, given an address and a sign-in |
| [04-an-app-folder-on-a-machine.md](04-an-app-folder-on-a-machine.md) | An app folder with `bin/run` on a machine, asleep until a visit |
| [05-a-public-name-through-a-door.md](05-a-public-name-through-a-door.md) | A public name answered through a machine's door, behind authwall |

## A tutorial file

It says what the tutorial shows, what has to be there before it starts, its flowchart, and its
steps:

- **Flowchart:** the questions a person meets and the way the tutorial takes, as a tree: each
  node an id, a kind (a step, a question or the end) and a few words; a question has the answer
  the tutorial takes and the other one, which it does not show.
- **Steps,** numbered, each a heading `### N. <node id>`, then three lines:
  - **Do:** what the person does, in the page's own words (the button, the field, the address);
  - **See:** what the page shows then, which the run checks before it goes on;
  - **Say:** the one or two sentences the voice says, written to be heard.

## Making the video

The video is one run, for real: a fresh serviceman, the services the tutorial needs, a browser
doing what the steps say, and every **See** checked before the step is ticked. A check that
fails stops the run: the video is never made of a step that did not happen.

**The picture is in two parts,** side by side, the same height:

- **left, the browser,** 960 pixels wide, dark theme, as the person sees the page;
- **right, the flowchart,** 560 pixels wide: the tree, the node of the step being taken lit,
  the nodes passed marked, each node whose **See** was checked ticked, the answers the tutorial
  does not take dashed; under it, the address the browser is on.

**The mouse cursor is seen.** A browser recorded without a screen draws no cursor, so the page
draws one: an arrow above everything on the page, put where the mouse is on every move, with a
ring for a moment on each click. The run moves the mouse to what it is about to click or type
into, in a short glide of about half a second, never a jump, then clicks. After a page loads,
the cursor is put back where it was.

**The voice says each step's Say line.** The lines are spoken before the run starts, one sound
file each, so the run knows how long each takes; at each step the run waits as long as its line
lasts, so what is said and what is shown keep together. One voice for all of it (Microsoft's
online voices through `msedge-tts`, `en-US-AvaNeural`, were used so far: a line's text goes to
that service, so it says nothing private).

**What the voice says is shown as text,** a caption at the foot of the browser part: the Say
line, from the moment it starts until it ends, white on a dark band, large enough to read on a
phone, never over the flowchart.

**The video:** MP4, H.264 and AAC, 15 frames a second, the browser recording and the flowchart
frames joined side by side, the captions burned in, the voice lines laid at their moments.
Beside it, the flowchart alone as a picture: every node the run reached, ticked.

**Before handing it over,** watch it and listen to it: the cursor is seen at every click, every
caption is whole and readable, each line is heard while its step is shown, the flowchart lights
the step on screen, and nothing on the page shows a name, an address or a log line of anybody's
own machines.

## Changing one

When a page or a feature changes, change the steps first: a **Do** that names a button that is
gone, a **See** the page no longer shows, a **Say** that is no longer true. Then make the video
again from the file. A step that cannot be taken any more is a change to the tutorial, said in
its file, not a step skipped in the video.
