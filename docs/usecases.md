# Use cases

What serviceman is for, told as the situations it is actually used in. Each one is a config you
can copy.

## Development watchers

*Several `bin/watch` scripts at once — a webpack dev server that builds an app and then rebuilds
it on every change — started, stopped and restarted from one page instead of a pile of
terminals.*

A watcher is a program, so it is a `shell` service, and a program runs where an agent is: the
laptop itself here, dialled in as `laptop`. Give each one an address and serviceman proxies to
it; give it none and serviceman only keeps it running.

```json
{
    "listen": {"host": "127.0.0.1", "port": 3000},
    "control": {"host": "serviceman.localhost", "port": 3001},
    "remotes": [
        {"name": "laptop", "token": "0c0f…a91b"}
    ],
    "services": [
        {
            "name": "app-watch",
            "title": "app · webpack",
            "type": "shell",
            "remote": "laptop",
            "publish": {"host": "app.localhost", "port": 8080},
            "command": "npm run watch",
            "cwd": "/home/user/app",
            "policy": {"start": "always", "restart": "always"}
        },
        {
            "name": "admin-watch",
            "title": "admin · webpack",
            "type": "shell",
            "remote": "laptop",
            "publish": {"host": "admin.localhost", "port": 8081},
            "command": "npm run watch",
            "cwd": "/home/user/admin",
            "policy": {"start": "always", "restart": "always"}
        },
        {
            "name": "css-watch",
            "title": "css · sass",
            "type": "shell",
            "remote": "laptop",
            "command": "npx sass --watch src:public/css",
            "cwd": "/home/user/app",
            "policy": {"start": "always", "restart": "always"}
        }
    ]
}
```

    serviceman-agent --url http://127.0.0.1:3001 --token 0c0f…a91b

Then `http://app.localhost:3000` and `http://admin.localhost:3000` are the two apps, the sass
watcher answers nowhere and only runs, and the control page on
`http://serviceman.localhost:3001` has all three.

**`"start": "always"` is required here, not a preference.** A watcher gets no HTTP traffic while
you edit, so a service left `on_demand` would be put to sleep in the middle of your work. An
always-on service is never reaped, whatever `stop_after_idle` says.

**`"restart": "always"`** brings a watcher back when it dies on a bad build — after 1s, then 2s,
doubling to 30s, and the count resets once it has stayed up for half a minute. `on_failure`
(the default) leaves a clean exit alone; `never` leaves everything alone.

**What the page gives you**

| Want                    | Where                                                                                  |
|-------------------------|----------------------------------------------------------------------------------------|
| The build output        | Not on the page yet: **Logs** is a place kept for it. The waiting page shows the last lines while a watcher comes up. |
| Kill a stuck watcher    | **Stop**. The whole process group goes, so `npm run watch` takes webpack with it.      |
| Bring it back           | **Start**.                                                                             |
| Why it died, and when   | The log: `program_end service=app-watch how="code 1"`, then `program_restart_wait`.    |
| All of them at a glance | Services: green while they run, and the state changes as they fall over and come back. |

**Restart is missing.** The page has Start and Stop; restarting a watcher — the thing you do
most — is two clicks today, with a wait between them. A `POST /api/v1/services/<name>/restart`
and a third button belong here.

### Catching a watcher that hangs

serviceman knows when a program **exits** — the agent holds the child and says so, serviceman
writes `program_end` and lets the restart policy decide. What neither can see from outside is
a program that is still running and has stopped working: the watcher that holds its port and
never rebuilds again.

For that, put `watchdog` from `@vbarbarosh/node-helpers` between serviceman and the program:

```json
{
    "name": "app-watch",
    "type": "shell",
    "publish": {"host": "app.localhost", "port": 8080},
    "command": "npx watchdog npm run watch",
    "cwd": "/home/user/app",
    "policy": {"start": "always", "restart": "always"}
}
```

`watchdog` opens a unix socket, puts `WATCHDOG_SOCKET` and `WATCHDOG_INTERVAL` in the child's
environment, and waits for the child to knock on it. A ping is any connection that ends
cleanly — `ping_socket(process.env.WATCHDOG_SOCKET)` from the same package, or a connect and a
close from anything else. No ping within the interval and watchdog kills the whole process
group and exits **124**.

serviceman then sees what it always sees — a program that stopped, with a code:

    [program_end] service=app-watch how="code 124"
    [program_restart_wait] service=app-watch in_ms=1000 restart=1

So a hang becomes a restart, with no new machinery on either side. Two things to know before
reaching for it: **the program has to ping**, so it works for code you own and not for a
third-party binary; and the ping proves only that the loop doing the pinging is alive, so ping
from the place that does the work, not from a timer beside it.

For a service that serves HTTP there is a cheaper answer — asking it for a page — which is what
serviceman already does before it calls a service ready. Watching for that *after* the start,
on a clock, is not built yet.

**Two smaller things worth knowing**

- `command` runs through `/bin/sh -c`, so pipes, `&&` and environment expansion work. Use
  `argv` instead when you want no shell.
- serviceman stops the programs it started when it stops itself, through the agent. Containers
  outlive it and are adopted again; a program cannot be, so it is stopped rather than left
  orphaned.
