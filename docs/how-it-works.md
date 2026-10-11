# How it works

## The knock

1. A request arrives. serviceman reads the `Host` header and the path, and finds the
   service — the exact hostname first, then wildcards, the longest path prefix wins.
2. A running service gets the request at once.
3. A sleeping service is started. Two requests that arrive together start it once.
4. serviceman waits until the service *answers a request* — not until its port opens. docker
   publishes the port before the app inside binds it, so a socket that connects proves only
   that docker is there.
5. Up to 2.5 seconds, the caller waits and then gets the answer of the service. It never
   learns that anything was asleep.
6. After 2.5 seconds a browser gets the waiting page. Everything else keeps waiting until
   `start_timeout`.

## The pages serviceman serves itself

The waiting page and the error page are light or dark, from the same choice the control
page keeps, with the same switch in the corner.

An error page of a service that failed is not a dead end: it asks the address again by
itself, first after two seconds and then more slowly, up to fifteen. **Ask now** asks at
once. The moment the service answers, the page opens. A page of an address nobody serves
does not ask again — nothing will change. Callers that are not browsers get the plain
page, never the script.

## The waiting page

The waiting page names the service, counts the seconds, and asks
`/__serviceman__/status.json` every second. The moment the phase turns to `running`, the page
reloads itself and the service answers. A start that fails writes the docker error on the
same page.

`/__serviceman__/` is the one path serviceman keeps for itself on every service address —
for a service mounted at `/pdf` it lives at `/pdf/__serviceman__/`.

## The log

Every line has one shape — `[time][group_uid][sender] details` — and work that causes other work
says whose child it is. A whole visit, from the knock to the answer:

    [2026-08-21T16:57:07.113Z][cqhldlq3xclh][request_begin] GET /hello {"from":"","host":"whoami.test","ip":"203.0.113.9"}
    [2026-08-21T16:57:07.115Z][c8pox602ru6x][group_spawn] parent=cqhldlq3xclh
    [2026-08-21T16:57:08.201Z][c8pox602ru6x][docker_run] service=whoami image=demo/whoami remote=vps1
    [2026-08-21T16:57:08.255Z][c8pox602ru6x][service_start_end_ok] service=whoami instance=1 remote=vps1 upstream=127.0.0.1:39231 inside=8080 answered=200 took=0.140s
    [2026-08-21T16:57:08.269Z][cqhldlq3xclh][request_end] 200 0.156s whoami#1

One grep of the trace shows the whole story; one grep of a sender shows every time it ever
happened — and finds the one line of code that writes it. [The log](logs.md) lists every
sender there is. The file is
`data/logs/<yyyymmdd>.log` next to the config; `SERVICEMAN_LOG_DIR` moves the folder and
`SERVICEMAN_LOG_DIR=none` turns the file off.

What a service has counted — requests served, how long its last start took, when each copy
came up — is kept in `data/counters.json`, written every few seconds when it moved and once
more on the way out. A restart and an edit of the service carry on from those numbers, and a
container found still running keeps its age. `SERVICEMAN_STATE_DIR` moves `data/`.

**Shell** on the control page opens a terminal inside the running container: serviceman asks the docker socket on that machine, through the
agent's link, for an exec with a TTY and joins it to the pane. The shell lives as long as
the pane; closing the pane ends it.

Every decision carries its reason: why a service started, why it was stopped, why another
instance was warmed. A container that accepts connections and drops them is named too —
`[upstream_error] service=deaf hint="nothing inside answers on port 5000, check publish.port"`
— the sign of a wrong `publish.port` in the config. A port that answers nothing at all is
caught earlier, at the start: `nothing answered on 127.0.0.1:41719 — read ECONNRESET — is
publish.port (5000) the port it listens on inside?`

## The sleep

Every request stamps the service. A stamp is also written when a request finishes, so a
long download counts as activity. Every 5 seconds serviceman looks for services that are
running, have nothing in flight, and were quiet for longer than `stop_after_idle`. Those
are stopped. `always` services are never in that list.

## Restarts

A stopped docker service keeps its container, so the next start is `docker start`. Sockets
that pointed to the old container are dropped when the service stops, because docker can
give the same host port to somebody else.

When serviceman itself starts, it asks every agent that is dialled in what is already running
and adopts it. Nothing is stopped and nothing is started twice. When serviceman is stopped,
the containers it started keep running — they are stopped again by the next serviceman, or
by hand — and the programs are stopped, because a program nobody watches is an orphan.

## Websockets

A websocket handshake wakes a sleeping service in the same way, then serviceman glues the two
sockets together. The connection counts as in-flight for the whole time it is open, so a
service with an open socket is never called idle.

## What serviceman never does

serviceman does not delete. It stops containers, it does not remove them, and it never
touches volumes, networks or files. The one exception is written in the log: when the
`image` of a docker service changes in the config, the old container is recreated from the
new image.

## Failures

A failed start leaves the service in `failed` with the docker error kept. The next request
tries again. If a running service stops answering, serviceman reports 502, forgets the address
and starts the service again at the next request.
