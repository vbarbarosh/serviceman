# Tutorials

Each file here is one tutorial: a way of using serviceman, told as the steps a person takes and
what each step shows. No video is kept here. A video is made from a file whenever it is needed,
after the page or a feature changes too, by following this page.

## The voice

Every video is said in one voice, the same from one video to the next:

- **Voice:** Microsoft's online `en-US-AndrewNeural`, the one Edge reads pages aloud with,
  through `msedge-tts`. It needs no key, and only each line's text is sent to it.
- **Rate:** `-5%`, a little slower than its default.
- **Sound:** the silence around each line cut; the whole track evened out to -16 LUFS (two
  passes of ffmpeg's `loudnorm`, `I=-16:TP=-1.5:LRA=7`), 48 kHz mono.

## The tutorials

| File | What it shows |
|------|---------------|
| [00-authwall.md](00-authwall.md) | authwall set up once, as a docker image: every tutorial after it starts there |
| [01-a-static-site.md](01-a-static-site.md) | A zip of HTML given on **Apps**, open at once, then behind authwall |
| [02-a-proxy-into-a-socket.md](02-a-proxy-into-a-socket.md) | A program with no port, reached through a socket file, behind authwall |
| [03-something-already-running.md](03-something-already-running.md) | A dashboard already on a port, given an address and a sign-in |
| [04-an-app-folder-on-a-machine.md](04-an-app-folder-on-a-machine.md) | An app folder with `bin/run` on a machine, asleep until a visit |
| [05-a-public-name-through-a-door.md](05-a-public-name-through-a-door.md) | A public name answered through a machine's door, behind authwall |
| [06-three-walls-each-with-its-app.md](06-three-walls-each-with-its-app.md) | Three walls for three teams (Google only, users named, an open demo), an app behind each |
| [07-a-website-online-with-a-sign-in.md](07-a-website-online-with-a-sign-in.md) | A website online, with a sign-in: an article, a video with a voice, a recap |

## An article and a video (07 on)

From 07 on, a tutorial file holds five parts: the **Article** (with an "In this tutorial" list
and a screenshot per section), the **Tutorial scenario** (goal, audience, prerequisites, the
example, the steps, the result), the **Video recording scenario** (its scenes, a line each),
the **Voiceover script** (`### Scene N — Title`, then one paragraph per beat; `[shown|said]`
shows the first and says the second) and **Audit notes** (what was measured in the page).

Its video is 1920×1080: a blue title card, each scene filmed on its own so no wait is filmed, a
cross-fade between scenes, a blue recap card of five lines. Each beat is said first and done
right after; the cursor reaches a control before its outline appears. One calm voice, evened out
to -16 LUFS; its subtitles go beside the video as an `.srt`. 00 to 06 keep the shape below.

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

**A file picked is seen picked.** A recorded browser draws no window of its own when a page
asks for a file, so the run draws one over the page: a folder, its files, the one to pick, **Open**;
the cursor clicks the file, then **Open**, and the window goes as the page gets the file.

**The voice says each step's Say line.** The lines are spoken before the run starts, one sound
file each, so the run knows how long each takes; at each step the run waits as long as its line
lasts, so what is said and what is shown keep together. One voice for all of it, the one under
**The voice** above (00 to 06 were made in `en-US-AvaNeural`, at its default rate).

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
