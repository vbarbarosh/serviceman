# terminal

A terminal for a web page: xterm in a Vue component, fitted to its frame, following the
page's theme, joined over a websocket to whatever the host opened at the far end — a shell
in a container, a pty on a machine.

It knows nothing of what it is joined to. The page half opens a websocket at the address it
is given and draws what comes back. The server half joins that websocket to a stream the host
opened. The host decides who may open one, opens the far end, and says what it is.

serviceman is the first host: its Shell tab of a service opens `docker exec` in a container,
and its Shell tab of a machine opens a pty there through the machine's agent.

## Layout

    server/terminal_attach.js   the websocket joined to a stream
    server/terminal_refuse.js   no terminal, and the note that says why
    ui/terminal.js              the component
    ui/terminal.css             the component's rules
    tests/                      the server half with a fake socket and stream

## What goes over the websocket

| From | Message |
|---|---|
| the far end | binary: the bytes it printed |
| the server | `{type: 'note', text, ok: true}`: what it is joined to, first of all |
| the server | `{type: 'note', text}`: why there is no terminal, then the socket closes |
| the pane | `{type: 'input', data}`: what was typed |
| the pane | `{type: 'resize', cols, rows}`: on opening, and whenever the frame changes |

## Plugging it into a host

The server half, once the host has a websocket and has opened the far end:

    const terminal_attach = require('../modules/terminal/server/terminal_attach');
    const terminal_refuse = require('../modules/terminal/server/terminal_refuse');

    terminal_attach(client, stream, {
        note: 'a shell on box',
        resize: function (size) {
            // size is {cols, rows}; the far end takes it
        },
        end: function () {
            // the pane went away; the stream is already closed
        },
    });

    terminal_refuse(client, 'box is not connected');

The page half: the host serves `ui/` and maps it, with Vue and xterm, in its import map, and
loads xterm's css and the component's:

    <link rel="stylesheet" href="/vendor/xterm.css">
    <link rel="stylesheet" href="/modules/terminal/terminal.css">
    <script type="importmap">
    {"imports": {"terminal/": "/modules/terminal/", "vue": "…", "xterm": "/vendor/xterm.mjs", "xterm-addon-fit": "/vendor/addon-fit.mjs"}}
    </script>

    import terminal from 'terminal/terminal.js';

    <terminal url="/api/v1/shell?remote=box" :theme="theme" :restart="true">
        <template #head><h1>box</h1></template>
        <div class="actions">…</div>
    </terminal>

| Prop | |
|---|---|
| `url` | the websocket's path and query on this host; a new one opens a new terminal on a clean screen |
| `theme` | `light` or `dark` |
| `restart` | true offers Start over when the shell ends, under what the last one printed |

The head slot is the title; the frame is laid out as four rows, the title, the note, the
terminal and what goes under it, so a host gives a title. The host page gives the colours,
`--panel`, `--line` and `--bg` (behind the terminal in full screen), and the classes of the note
line: `muted`, `bad`, `link`.

Ctrl-W is a shell's and the browser's both, and the browser never lets a page have it. So while a
terminal is open its page asks before it goes ("Leave site?"), and on Chrome the note line offers
**Full screen**: the terminal over the whole screen with Keyboard Lock, every key going to it,
Ctrl-W, Ctrl-T and Ctrl-N too. Holding Esc leaves.

## In serviceman

- `src/main/src/routes/handle_control_upgrade.js` opens the far end for `/api/v1/shell`,
  `docker exec` for a service or a pty through the agent for a machine, and attaches it
- `src/main/public/remote_shell.js` and `service_shell.js` are the two Shell tabs, each a
  wrapper that gives the url, the title, and for a service the buttons of its instances
- `src/main/public/index.html` loads the css and maps `terminal/`; the control server serves
  `ui/` at `/modules/terminal/`; `bin/vendor` copies xterm

## Tests

    node --test modules/terminal/tests/*.test.js
