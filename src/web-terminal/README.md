# web-terminal

A terminal in a web page, served as an ordinary HTTP service. It is the Terminal module
(`modules/terminal`) with a host of its own: one page, the terminal over the whole window,
and its websocket on the page's own path.

The path says which terminal:

| URL | What opens | When the page closes or the connection drops |
|---|---|---|
| `/<name>` | the kept session `<name>`, started on the first visit | it stays; `/<name>` opens it again, screen and all |
| `/` | a shell of its own | it ends |

A name is lowercase letters, digits, `-` and `_`. Kept sessions are tmux sessions on a tmux
server of the app's own (`tmux -L web-terminal`); the page lists them in its head.
`GET /_/sessions` lists them as json.

## Who may connect

A terminal is a shell for whoever reaches it, so the page asks for a token first:
`WEB_TERMINAL_TOKEN` where it runs, or, when that is not set, one it makes at start and prints
once. Pasted on the page it becomes a cookie only this page's own requests carry (HttpOnly,
SameSite=Strict, Secure behind https); a program sends it as `Authorization: Bearer <token>`.
The websocket and `GET /_/sessions` want it too; the page's own files under `/_/` do not.

The token is one word, and an address on the open internet is tried all day: publish the
terminal behind a wall, a machine's door rule with `auth`, or on a tailnet, and keep the token
besides.

## Run

    WEB_TERMINAL_TOKEN=wt_… PORT=3000 node src/web-terminal/index.js

It needs `python3` (the pty) and `tmux` on the machine, and the vendored xterm and Vue in
`src/main/public/vendor` (`bin/vendor`).

## As an Ubuntu image

Every terminal is then a shell of the user `term` in an Ubuntu container, not of root. Built
from the root of the repo:

    bin/vendor
    docker build -f src/web-terminal/Dockerfile -t web-terminal .

And served by serviceman like any other service, started by the first visit, its token given
as a secret of the service on the Secrets page, under the name `WEB_TERMINAL_TOKEN`:

```json
{
    "name": "term",
    "type": "docker",
    "remotes": ["vps1"],
    "publish": {"host": "term.example.com", "port": 3000},
    "image": "web-terminal",
    "policy": {"stop_after_idle": "1h"}
}
```

A door rule that answers `term.example.com` on a machine's public side names a wall:
`{"service": "term", "auth": "authwall"}`.

An open terminal is a request in flight, so the service is not idle while a page is attached.
Once the last page has closed, `stop_after_idle` counts. When it stops the container, the kept
sessions go with it.
