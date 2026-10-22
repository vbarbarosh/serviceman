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
    server/terminal_serve.js    the HTTP API of kept terminals, given call(method, params)
    server/terminal_manifest.js its kind of items and the commands on them
    ui/terminal.js              the component
    ui/terminal.css             the component's rules
    tests/                      the server half with a fake socket and stream

## The API of kept terminals

What it holds and does is written down in `server/terminal_manifest.js`, for a host to route,
give rights and show by: its kind of items and the commands on them, in
[the shape every module has](../../README.md#modules).

A host that keeps terminals on a machine, to be joined later, lists, makes, signals, ends and
joins them here, under the base it mounts it at — serviceman's is
`/api/v1/remotes/<name>/terminals`. Each door but the join is one call of the host's
`call(method, params)`:

| Door | What it does |
|---|---|
| `GET <base>` | `term_list`: `{items: [{name, created_at, attached, cwd, command}]}` |
| `POST <base>` `{name, cols, rows, env, cwd}` | `term_create`; no name is the first number no terminal has |
| `POST <base>/<name>/signal` `{signal, to}` | `term_signal`: to its shell, or to what runs in front (`to: foreground`) |
| `POST <base>/<name>/end` | `term_end`: the shell hung up, the terminal gone |
| `POST <base>/<name>/join` | the host's `join(name)`: `{stream, url}`, a stream both ways, the WebSocket to open at `url`; 501 without one |

- Only the fields a door takes go on to the call; `env` and `cwd` go as they came, for the host
  to judge.
- **Refusals:** a call that throws is a 502 with its message, or the status the error carries;
  a body that is not JSON is a 400; any other door or method is a 404.

[Terminals from another program](../../docs/terminals.md) says what each answers in serviceman,
and how a terminal is joined.

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

The kept terminals' API, for a host that keeps them:

    const terminal_serve = require('../modules/terminal/server/terminal_serve');

    await terminal_serve(req, res, {
        // term_list, term_create, term_signal, term_end -> what the machine answers
        call: (method, params) => ask_the_machine(method, params),
        join: name => a_stream_to_join(name),           // -> {stream, url}; optional
        tail: '',                                       // the address after the base
    });

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

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/terminals…` to
  `terminal_serve`, after its own refusals: no such machine, not connected; its `call()` asks
  the agent, and refuses an agent from before what is asked, a name that is not one, and an
  `env` or a `cwd` its shell would not take; its `join()` is a stream kept for a minute, which
  `handle_control_upgrade.js` joins once, for whoever asked, to the terminal
- `src/main/public/remote_shell.js` asks for a join each time it joins a terminal, and gives
  the component the stream's address
- `src/main/src/routes/handle_control_upgrade.js` opens the far end for `/api/v1/shell`,
  `docker exec` for a service or a pty through the agent for a machine, and attaches it
- `src/main/public/remote_shell.js` and `service_shell.js` are the two Shell tabs, each a
  wrapper that gives the url, the title, and for a service the buttons of its instances
- `src/main/public/index.html` loads the css and maps `terminal/`; the control server serves
  `ui/` at `/modules/terminal/`; `bin/vendor` copies xterm

## Tests

    node --test modules/terminal/tests/*.test.js
