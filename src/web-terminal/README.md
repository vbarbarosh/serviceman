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

## Run

    PORT=3000 node src/web-terminal/index.js

It needs `python3` (the pty) and `tmux` on the machine, and the vendored xterm and Vue in
`src/main/public/vendor` (`bin/vendor`).

## As an Ubuntu image

Every terminal is then a shell in an Ubuntu container. Built from the root of the repo:

    bin/vendor
    docker build -f src/web-terminal/Dockerfile -t web-terminal .

And served by serviceman like any other service, started by the first visit:

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

An open terminal is a request in flight, so the service is not idle while a page is attached.
Once the last page has closed, `stop_after_idle` counts. When it stops the container, the kept
sessions go with it.
