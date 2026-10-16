# Terminals from another program

The terminals of a machine's Shell tab are plain shells kept running on that machine: a small
holder process the agent starts owns each one, and outlives the page, serviceman and the agent
itself. It keeps the last megabyte the shell printed and hands it to whoever joins, so the
terminal that draws it scrolls back through it. There is no tmux: no status bar, no modes.

Any program on the machine serviceman runs on can list them, join one, type into it and leave
it running, through the same doors the page uses. A working client is in
[demos/terminal-client](../demos/terminal-client): copy its files into your program,
terminals_list.js, terminal_connect.js and terminal_call.js (create, signal, end).

## The two doors

Both are on the control port, `http://127.0.0.1:8081` unless `control.port` says otherwise.

**List:** `GET /api/v1/remotes/<remote>/terminals`

    {"items": [
        {"name": "work", "created_at": 1791415022399, "attached": 1,
         "command": "socat -,raw,echo=0 UNIX-CONNECT:/home/user/serviceman-agent/terminals/work.sock"}
    ]}

`attached` counts who has it open now, from anywhere. `command` is the line that joins it by
hand, over ssh: the holder's socket carries the terminal as it is.

`cwd` is the folder the terminal's shell is in now; it follows every `cd`.

**Create:** `POST /api/v1/remotes/<remote>/terminals` with `{name, cols, rows}` (all optional)
makes a terminal without joining it, the lowest free number when no name is given, and answers
`{name, created}`; `created` is false when it was running already.

**Signal:** `POST /api/v1/remotes/<remote>/terminals/<name>/signal` with `{signal, to}` sends one
of `SIGHUP SIGINT SIGQUIT SIGTERM SIGKILL SIGUSR1 SIGUSR2 SIGSTOP SIGCONT`: to the shell
(`to: "shell"`, the default; SIGKILL or SIGHUP there ends the terminal), or to what runs in it in
front (`to: "foreground"`; SIGINT there is Ctrl-C).

**End:** `POST /api/v1/remotes/<remote>/terminals/<name>/end` hangs the shell up, as closing a
terminal window does; whoever has it open sees it close. Typing `exit` in it does the same.

**Join:** a websocket on `/api/v1/shell?remote=<remote>&term=<name>`

- A name that is not running is made. Names are letters, digits, `-` and `_`.
- The first message is text, json: `{"type": "note", "text": "the terminal work on laptop: …", "ok": true}`.
- Every message after it is binary: the terminal's bytes, escapes and all, for xterm.js or a
  real tty to draw. The first of them is the history, so a terminal joined again shows what
  it printed before, and scrolls back through it.
- Send text messages, json: `{"type": "input", "data": "ls\r"}` types (Enter is `\r`), and
  `{"type": "resize", "cols": 120, "rows": 40}` sets the size. Send a resize first: a new
  terminal starts at 80×24.
- Closing the socket leaves the terminal running. It ends when someone types `exit` in it,
  or ends it as above, and then the socket closes from the far end.

## Who may connect

The control page answers only the machine it runs on: a program there connects; one on another
machine is refused (`control.exposed` opens it, behind a wall of your own). It wants the
owner's token, as `Authorization: Bearer <token>` (`bin/owner-token` prints it): a reader's
token never opens a terminal. It also refuses a websocket a browser page opens from another
site, so a page on the internet cannot reach your terminals through your browser.

For an Electron app such as Visual Notes this means: **connect from the main process**, not
from a page. Node sends no `Origin`, and passes; a page loaded from `file://` or its own
scheme is another site, and is refused. The main process holds the socket and passes the
bytes to the page that draws them:

    // main process
    const terminal_connect = require('./terminal_connect');
    const terminal = terminal_connect({url: 'http://127.0.0.1:8081', token: process.env.SERVICEMAN_TOKEN, remote: 'laptop', name: 'work', cols: 120, rows: 40});
    terminal.on('data', v => window.webContents.send('terminal-data', v));
    ipcMain.on('terminal-input', (event, text) => terminal.write(text));
    ipcMain.on('terminal-resize', (event, size) => terminal.resize(size.cols, size.rows));

    // page, with xterm.js
    xterm.onData(v => ipcRenderer.send('terminal-input', v));
    ipcRenderer.on('terminal-data', (event, bytes) => xterm.write(new Uint8Array(bytes)));

## A page of its own

[demos/terminal-web](../demos/terminal-web) is a whole terminal app in two files: a
small Node server that holds the connection to serviceman, and a page with xterm.js that
talks to it alone, so the page may be opened from anywhere that server answers.

    node demos/terminal-web/server.js
    # then open http://127.0.0.1:8090/

Nothing has to be set. It looks for serviceman where bin/run publishes it (127.0.0.1:3001),
then on its config default (127.0.0.1:8081), opens on serviceman's first machine, and prints
what it settled on. `SERVICEMAN_TOKEN` is the owner's token (`bin/owner-token` prints it),
without which serviceman answers nothing; `PORT`, `URL` and `?remote=<machine>` choose
otherwise.

Tabs as in the Shell tab (`1 · Shell ×`, `+`), the terminal over the rest of the window, the
one shown in the address, light or dark.

### With an ssh key

[demos/terminal-web-ssh](../demos/terminal-web-ssh) is the same page with a box for a
private key, for git pull and push from the terminals it opens:

    node demos/terminal-web-ssh/server.js
    # then open http://127.0.0.1:8091/

- The key is kept in that server's memory only; the page shows its kind, never the key.
- Each terminal + opens gets it before the page joins: an ssh-agent of the terminal's own
  (`trap` ends it with the terminal, `-t 8h` forgets the key in any case), and the key typed
  in with the echo off. It is never on the screen, in the history a later join is shown, or in
  a file on the machine.
- The host keys of GitHub and Bitbucket go to `~/.ssh/known_hosts` when they are not there, so the first clone or push asks
  nothing.
- A terminal opened before the key was given, or after Forget, has none.

### With files

[demos/files-web](../demos/files-web) is the ssh page with the machine's files beside the
terminals, for a developer to see how the files API is used:

    node demos/files-web/server.js
    # then open http://127.0.0.1:8092/

- The calls are in `fs_client.mjs`, one function a door, with fetch only: copy it into a page
  or a node program. The doors themselves are in the files API's own README,
  [modules/file_manager](../modules/file_manager/README.md#the-api).
- The page calls the API at its real addresses, `/api/v1/remotes/<machine>/fs…`; the demo
  server passes them through to serviceman as they are.
- The folder shown is watched, and the list follows the watch: the watch opens first, the list
  is read once it says `ready` and again after `resync`, and each event changes the list. A
  file written in the terminal shows in the list as it lands.
- New folder, New file, Upload (or a drop on the list), Move (a rename, or another folder:
  the whole new path), Delete, Download (a folder as one tar).
- Under the list, each request as it was sent, its answer and each event of the watch.
- The folder shown is in the address too, `?dir=`, so a reload comes back to it.

## From a shell

    node demos/terminal-client/attach.js laptop            # its terminals
    node demos/terminal-client/attach.js laptop work       # joins work here; Ctrl-] leaves it running

`SERVICEMAN_TOKEN=$(bin/owner-token)` brings the owner's token, which it needs;
`URL=http://127.0.0.1:8081` points it at another control port.

## Checked by

`tests/remote.test.js`, "a terminal kept on a machine outlives its page and its agent, and its tab ends it": a real agent; the client lists, joins,
types, leaves, the agent is killed and started again, and joined again the terminal hands back
what it printed; ended, it closes for whoever had it open and leaves the list.
