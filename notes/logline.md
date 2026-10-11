# Logline: every line of every machine, in one place

Status: design only, nothing built. Started 2026-09-25.

Logline is the ClickHouse logger from
[templ/docker-compose-clickhouse](https://github.com/vbarbarosh/templ/tree/main/templ.d/docker-compose-clickhouse):
ClickStack, the `default.otel_logs` table, and the focused log-ui on top of it. It implements
the house rules for logs:
[logs.md](https://github.com/vbarbarosh/rules/blob/main/drafts/logs.md) and its
[cheatsheet](https://vbarbarosh.github.io/rules/drafts/logs-cheatsheet.html). Where this note and
the rules disagree, the rules win.

## What the rules settle

- One physical line is one event: `[time][group_uid][sender] details`, four fields and nothing
  else.
- `time` is ISO-8601 UTC with milliseconds. It is written when the program writes a file, and
  left off when the runtime stamps the line, as docker does. A container that follows the rules
  prints `[group_uid][sender] details`, and docker's timestamp is the line's time.
- A group opens with `group_spawn`, with `parent=` naming the group it came from, and a root
  group names none. A request or message carries the caller's uid, and the receiver uses it as
  the parent of its new group.
- `sender` is one call site, unique in the codebase, matching `^[a-z_][a-z0-9_]*$`.
  `_begin` is closed by `_end_ok`, `_end_error` or `_end` in the same group.
- `details` never holds a newline or a secret. A line tries to stay under 2k bytes; a cut keeps
  valid UTF-8 and ends with `...+N`.
- `group_exit` is optional. Telling a leak from late delivery needs "preserved per-group order,
  a shared sequence, or another causal-order signal".

## What is asked

1. The logs of every remote and every service flow into one log: Logline.
2. One endpoint takes every line (D4), and serviceman says where it is.
3. The docker services a VPS runs on its own — ordinary compose projects, not managed by
   serviceman — stay as they are, and their logs flow in too, tagged `host=server.example.com
   service=ffmpeg` and so on.
4. Something on each machine watches the logs, keeps them locally, and sends them on when the
   endpoint is reachable.
5. It is reliable: no line is dropped.

## What is there today

- The host writes one daily file, `data/logs/YYYYMMDD.log`, about 1 MB and 10k lines a day.
- Every line an agent writes is sent up its link and written into that file with its uid kept.
  A line written while the link is down stays in that machine's own file and never reaches the
  host.
- `shell` services' output arrives as `program_stdout` / `program_stderr`.
- Docker services' output is not collected: the Logs tab runs `docker logs --tail` when opened.
- Logline has no endpoint of its own yet. Its collector tails files and docker on its own
  machine, and parses `2026/08/15 00:48:05 [g][s] …` and `[g][spawn] parent=`. It stores the
  fields as `subject` and `description`. The rules and serviceman write
  `[2026-09-25T18:17:09.979Z][g][s] …` and `[g][group_spawn]`, and call them `sender` and
  `details`.

## Decided

**D1. What the endpoint accepts: an array of `{time, labels, line}`.** Logline's one endpoint
(D4) takes lines in this form and no other, whoever sends them: an agent, serviceman itself,
or anything else:

> format of logs to send is --- {time, labels, line} where "line" is final log line with all of
> [foo][bar][..] ....; without trailing spaces
>
> an array of such items
>
> labels are an array of {name, value}; time is ISO string; line will be displayed in logline
> interface as it was sent; agent could try to remove [2026/09/25 22:41:30] from the begining of
> line; so if line has time at the very beginig, this time shold be stripeed, and used as time;
> otherwise time shold be used from provider or file by current time;

    [
        {
            "time": "2026-09-25T18:17:09.979123456Z",
            "labels": {"host": "server.example.com", "service": "ffmpeg"},
            "line": "[c7t0xb1m][mp4gif_worker_begin]"
        },
        {
            "time": "2026-09-25T18:17:10.863401202Z",
            "labels": {"host": "server.example.com", "service": "ffmpeg"},
            "line": "[c7t0xb1m][mp4gif_worker_end_error] 0.884s ffmpeg exit=1"
        }
    ]

- `time` is an ISO string.
- `labels` is an object of names and values, `{"host": "server.example.com", "service": "ffmpeg"}`.

  > change how labels are stored and saved from array of {name,value} to object {name:value}

  Changed 2026-09-26 from the array of `{name, value}` decided at first. The endpoint still
  takes that array, as the same object, for batches cut before the change.
- `line` is the final log line, every `[…][…]` in it, with no trailing whitespace. Logline shows
  it exactly as it was sent. Parsing it into fields happens behind the endpoint, never in what
  is sent to it (P17).

**D2. Where `time` comes from.** The agent looks at the very beginning of the line:

- **The line starts with a time** — `[2026/09/25 22:41:30] …` — so that time is stripped from the
  line and becomes `time`. The line is sent without it.
- **It does not** — so `time` is the provider's: docker's stamp for a container's line. For a
  line read from a file, it is the moment the line was read.

serviceman's and the agent's own lines are sent the same way: `time` carries the moment, and
the line has no `[time]` of its own.

**D3. Which leading times are stripped.**

> "2026/09/25 22:47:45" followed by "\s*["; or '2026-09-25T19:48:10.059Z' followed by "\s[";
> or same time wrapped with []; it no timezone 2026/09/25 22:49:19 --- treat local on machine;
> An unreadable time, like [2026/13/45 99:00:00], ---- keep in line, use time from other sources
>
> 2026-09-25T19:48:10.059Z[c7t0xb1m][…] --- also safe

| Shape at the very start of the line | Example                                  |
|-------------------------------------|------------------------------------------|
| slash time, then `\s*[`             | `2026/09/25 22:47:45 [c7t0xb1m][…]`      |
| ISO time, then `\s*[`               | `2026-09-25T19:48:10.059Z [c7t0xb1m][…]`, `2026-09-25T19:48:10.059Z[c7t0xb1m][…]` |
| either one wrapped in `[]`          | `[2026/09/25 22:47:45][c7t0xb1m][…]`, `[2026-09-25T19:48:10.059Z][c7t0xb1m][…]` |

- The time is stripped, and the whitespace after it; the `[` that follows stays, so the line
  still starts with its first tag.
- A time with no zone — `2026/09/25 22:49:19` — is local time on the machine the line came from.
- A time in one of these shapes that is not a real time — `[2026/13/45 99:00:00]` — stays in the
  line, and `time` comes from the other sources (D2).
- A line that starts any other way is sent as it is.

**D4. Agents POST to one endpoint, and ask serviceman where it is.**

> agents need just one endpoint to POST; agents could ask this endpoint from servcieman;

- Logline has one endpoint. Lines go to it with a `POST` whose body is the D1 array.
- serviceman's config says where it is (P1). An agent asks serviceman for it over the link it
  already dials, and keeps the last answer on disk.
- Lines go straight from the agent to the endpoint; they never cross serviceman. The link
  carries requests, as it does now, and not a log's worth of traffic besides.
- The agent keeps the answer on disk, so a machine goes on shipping while serviceman is away:
  serviceman is where the address comes from, not a step every line waits on.

**D5. The endpoint is `POST http://logline:3000/lines`.**

> 3: POST http://logline:3000/lines

**D6. The agent sends one token and nothing else; Logline issues tokens bound to IPs, and
serviceman asks for them.**

> no; agent should send single token, no headers; logline could issue tokens bound to ips; so
> token should be allowed from some ip only;
>
> so, servecimen would ask logline for token, then send provide it to agent;

- Logline issues the tokens. Each one is allowed only from the addresses it was issued for; the
  same token from any other address is refused.
- serviceman asks Logline for a token, and hands it to the agent.
- An agent sends a single token, and no headers of its own beside it.

This replaces the per-remote HMAC tokens that were decided here on 2026-09-25.

How it works, proposed:

- **One token per remote.** For each remote, serviceman asks Logline for a token named after it
  and bound to that machine's addresses:

      POST http://logline:3000/tokens
      {"name": "server", "ips": ["100.64.0.20", "fd7a:115c:a1e0::20"]}
      → {"name": "server", "token": "5f0c…e21a"}

- **The addresses come from the agent.** It says them in its hello (every address the machine
  has, loopback left out), because serviceman sees every agent as `127.0.0.1` behind its own
  proxy. When they change, serviceman asks Logline again, and the new token replaces the old.
- **serviceman keeps what it was given** in `data/logline_tokens.json`, mode 600, beside
  `secrets.json`. A restart does not ask again, and asking again for the same name and the same
  addresses gets the same token.
- **Asking needs a key of its own.** `ADMIN_TOKEN` in `logline/.env`, made once with
  `openssl rand -hex 32`. serviceman keeps the same value in its Secrets library, and the config
  names it (P1). It is also bound to serviceman's own address, and it can only issue and revoke;
  it cannot send lines.
- **A remote taken out of the config** has its token revoked: `DELETE
  http://logline:3000/tokens/server`.
- **serviceman's own lines** go in with a token it asks for itself, named `serviceman` and bound
  to its own addresses. serviceman then refuses that name for a remote.
- **The endpoint checks two things:** the token is known, and the caller's address is one it was
  issued for. Otherwise it answers 401. To the agent, a 401 is like any answer that is not 2xx:
  the batch stays, and the log says why.
- **The token's name is the `remote` label.** The endpoint sets it, and drops any `remote` label
  in the body, so no machine can write under another's name.
- **Logline keeps the tokens** in `tokens.json` in the `lines` container's data volume, mode 600. Issuing and revoking
  change that file and need no restart.

**D7. The endpoint is published on the Logline machine's tailscale address, with nothing in
front of it.**

> seems reasanoble;

    lines:
      ports:
        - "100.64.0.20:3000:3000"      # the machine's address from `tailscale ip -4`

- Port 3000 is open on the tailnet only. The public internet and the local network cannot reach
  it.
- No `tailscale serve`, nginx or Caddy between the agents and the port. A forwarder opens a
  connection of its own, and every caller would arrive as `127.0.0.1` — which is what
  serviceman's own log shows for every agent today. With docker's own port publishing, a caller
  from another machine arrives with its real tailnet address, and D6 can check it.
- Tailscale must be up before docker starts the container, or there is no address to open the
  port on. One reboot of that machine shows whether it is.
- A caller on the Logline machine itself goes through docker's own forwarding and can arrive as
  docker's address, not its tailnet one. If serviceman runs there, its `serviceman` token is
  bound to that address.

**D8. Every line from the moment collection is switched on is kept.**

> Start each container from the moment collection was switched on for its machine, ------ lets
> start with this; from moment on....; and be very careful to save all logs from this momenet

- The moment a machine is switched to `"logs": "all"` is its **floor**. Nothing before it is
  collected; nothing after it may be missed.
- Every container is read with `docker logs --since <floor>`, the first time the agent sees it.
  One that started after the floor is therefore read from its first line, which also covers the
  moments between a container starting and the agent attaching to it.
- History from before the floor is not collected. Loading it would be a deliberate backfill of
  its own, later, at a lower priority than live lines.

How each gap after the floor is closed:

| Where a line could slip                          | What closes it                                                                                          |
|--------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| The agent starts reading before the floor is kept | The floor is written to `<prefix>/logline/settings.json` and synced before the first container is read.             |
| A container starts, and the agent attaches late  | `--since <floor>` for a container never seen, not "from now".                                           |
| The agent restarts, or is updated                | Each container resumes from its last line in the spool (P11), never from "now".                         |
| A container starts and exits while the agent is down | On every start the agent lists `docker ps -a`, exited containers too, and reads each one past its cursor. |
| `docker events` drops, or the docker daemon restarts | The agent lists `docker ps -a` again, and reads every container past its cursor.                      |
| A container exits while it is being followed     | `docker logs -f` ends only after its last line; the agent then reads `--since` its cursor once more.     |
| A line at the very same instant as the floor     | `--since` is taken to include that instant; a test proves it against the real docker, not the stand-in. |
| The spool is full                                | The agent stops reading and resumes from its cursor (P14); docker keeps the lines meanwhile.            |

- A container is done with only when it is gone from `docker ps -a` and its last line is in the
  spool.
- Switching a machine to `"off"` and back to `"all"` sets a new floor. The lines in between are
  not collected, because that is what `"off"` asks for.
- What stays out of reach is under "Where a line can still be lost": a container removed before
  the agent read it, and rotation outrunning a paused agent. Both are said in the log when they
  happen.

**D9. Folders of log files are read too.**

> someone should being able to watch dirs with logs;

Built 2026-09-26, `src/agent/src/logline_files.js`: a remote's `log_dirs` — a folder, or a folder
and a pattern — read every second, a line at a time, into the same spool. A file is known by
device and inode; its lines are held under `file:<dev>:<ino>:<run>@<floor>` with the byte offset
after each line as its place, so a restart resumes, a truncation starts a new run, and a new
floor never meets an old place. Files there when a folder is first watched are read from their
end, later ones from their start (`files.json`). Labels: `host`, `service`, `file`. This is also
how serviceman's own log reaches Logline: the agent on its machine reads its `data/logs`.

## Proposed decisions

Each one is a proposal until it is confirmed here.

### Where the endpoint is

**P1. serviceman's config names the endpoint.** A `logline` key in serviceman.json:

    "logline": {
        "endpoint": "http://logline:3000/lines",
        "admin": "logline"
    }

- It is typed in on any machine's **Logs** tab, under **Where Logline is**: the endpoint, the
  admin token (kept in the Secrets library as `logline`, never shown again) and the viewer's
  address. Logline stays a stack of its own, not a serviceman service. A change reaches every
  connected agent without a restart (P2).
- No `logline` key: nothing is collected. A spool with nowhere to go would only fill a disk.
- `admin` names the secret in the Secrets library that holds Logline's `ADMIN_TOKEN`: the key
  serviceman asks Logline for tokens with (D6). The tokens it is given live in
  `data/logline_tokens.json`, never in the config.
- The tokens are asked for at `/tokens` on the endpoint's own address.

**P2. The agent asks, and is told again when it changes.** The agent's hello says what it was
last told — the endpoint, the token by its hash, `logs` and the floor — and serviceman answers
with a telling only when that differs from what it should be. That is the agent asking, without
a line in either log at every hello for the machines that are as they should be. A telling, for
example:

    {"endpoint": "http://logline:3000/lines", "token": "5f0c…e21a", "logs": "all"}

- `token` is this remote's own, which serviceman asked Logline for (D6).
- `logs` comes from the remote's entry in serviceman.json: `"all"` (every container) or `"off"`.
  Any container can opt out with the label `logline=off`. Logline's own containers (clickstack,
  log-ui, the endpoint) are always skipped, so Logline does not log itself.
- When the config changes, serviceman tells every connected agent the new answer, unasked.
- The agent writes the answer to its folder, `<prefix>/logline/settings.json`, mode 600, before
  it acts on it — a folder of its own, because `data/` holds the volumes services keep. After a
  restart it starts from that file, so a machine whose serviceman is away still ships to the
  endpoint it last heard of.
- An agent that has never had an answer collects nothing.

**P3. Every machine needs a route to the endpoint.** This is the price of D4: the endpoint
must be reachable from each VPS, and `logline` must resolve there. On the tailnet that is the
machine that runs Logline being named `logline`, which MagicDNS then answers for. It is one
address on the tailnet, which every agent already uses to reach serviceman.

### What the agent collects

**P4. The agent is the collector.** No second program on the machine. The agent is already
installed on every VPS, updates itself, dials home, and already runs docker. A collector of its
own would be a second thing to install, update and give docker access to.

**P5. It follows every container, not only serviceman's.**
- `docker ps` when it starts, and `docker events` for every container started afterwards.
- `docker logs -f --timestamps` for each one.
- It uses `docker logs`, not the files under `/var/lib/docker`: no root, and it works the same
  with snap or rootless docker and with the json-file, local and journald drivers.

**P6. Labels come from docker.** All of them are known before a container's first line is read.
The `remote` label is not among them: the endpoint sets it from the token (D6).

| Label       | From                                                        |
|-------------|-------------------------------------------------------------|
| `host`      | the machine name, `server.example.com`                            |
| `service`   | label `serviceman.service` (a container serviceman made), else `com.docker.compose.service`, else the container name |
| `project`   | label `com.docker.compose.project`                          |
| `container` | the container's name                                        |
| `container_id` | the container's short id, which the log-ui's "surroundings" follows |
| `image`     | the container's image                                       |
| `stream`    | `stdout` or `stderr`                                        |

**P7. Lines that do not follow the rules are kept, not fixed.**
- The 2k limit and the no-newline rule bind the producer, so the collector does not cut a
  foreign line at 2k.
- The one change to a line besides D2's leading time: a line over 64 KB is cut the rules' way
  (valid UTF-8, `...+N`), and the log says so. Without that, one runaway line could outgrow a
  batch.
- docker already splits output into lines, so a multi-line stack trace arrives as several
  items, in order (P15).

**P8. The agent's own lines take the same path.** They go into the spool as they happen, besides
the daily file the agent keeps now. There are few of them, so each one is synced before the
agent moves on.

**P9. serviceman is a source like any other.**
- Its own lines go into a spool of its own and are POSTed to the same endpoint, labelled
  `host=<its machine>` and `service=serviceman`.
- The daily file `data/logs/*.log` stays exactly as it is.

### Not a line dropped

**P10. Every line goes to a spool on disk before it counts as seen.** The spool is a folder of
append-only segment files beside the agent, `<prefix>/spool/`. It holds one D1 item per line,
with its place in the spool in front:

    {"seq":184467,"time":"2026-09-25T18:17:09.979123456Z","labels":[…],"line":"…"}

- `seq` counts up forever within one spool. It is the spool's own bookkeeping, and leaves the
  machine only as the position of a batch (P12).
- Items are fdatasync'ed in batches, every 200 ms at most. An item counts as captured only once
  it is on disk.

**P11. The spool is its own cursor.** There is no separate "read up to here" file to fall out of
step with it.
- After a crash or an update, the agent reads the last item of each container from the spool's
  tail and asks docker for `--since <time>`.
- It skips as many lines at that timestamp as the spool already holds for it.
- A line that was read but not yet on disk is simply read from docker again, so nothing
  between the two is lost.

**P12. A batch is deleted only after the endpoint has it.** The agent POSTs spool items in order.
The body is exactly the D1 array, and the token is all that goes with it (D6).
- The endpoint answers 2xx only once the lines are stored. Only then does the agent delete them.
- Any other answer, or none, means the same batch is sent again later, byte for byte: a batch is
  cut from the spool once, and a resend is that cut, not a new one.

**P13. A resend is harmless, and needs no header to be.** The endpoint inserts a batch into
ClickHouse with `insert_deduplication_token = sha256(body)`. The same bytes are the same batch,
so a batch sent twice is stored once. This needs `non_replicated_deduplication_window` set on
`otel_logs`, which is a plain MergeTree.

**P14. Backpressure, never a drop.**
- While the endpoint is away, the spool grows.
- At its cap, the agent stops reading docker.
- docker keeps the lines meanwhile, and the agent picks them up with `--since` once there is
  room.
- A batch the endpoint refuses outright (a 4xx, which no retry will change) is moved to
  `<prefix>/spool/refused/` and said in the log. It is kept, not deleted, and it does not block
  the batches behind it.

Nothing in this chain throws a line away to make room.

**P15. The order a producer wrote in survives the trip, as far as time and the batch can
carry it.**
- A batch is in the order the lines were written, and a machine sends its batches one at a time,
  in order.
- The endpoint stores each item's place in its batch as `LogAttributes['log.index']`, so lines
  that share a timestamp still sort as they were written.
- Across batches, `time` orders them. With no per-source sequence on the wire (D6), `group_exit`
  cannot be told from late delivery for certain; the rules call that detection advisory.

**P16. The pipeline is watched.** The agent is still connected to serviceman, and each
heartbeat carries:
- how many items are waiting in the spool;
- how old the oldest one is;
- how far behind each container is;
- the endpoint's last answer.

The remote's page shows it: "logs: 3.1 MB waiting, oldest 2m, endpoint unreachable". The log
says when shipping stops, when it resumes, and every loss it knows about.

### Behind the endpoint

**P17. The endpoint is Logline's, and it parses.** A small service added to Logline's compose
file, beside ClickStack. It takes the D1 array, and writes each item to `otel_logs`:

| From the item         | In ClickHouse                                    |
|-----------------------|--------------------------------------------------|
| `time`                | `Timestamp`                                      |
| `line`                | `Body`, untouched — what the log-ui shows         |
| label `service`       | `ServiceName`                                    |
| label `host`          | `ResourceAttributes['host.name']`                |
| every other label     | `ResourceAttributes[<name>]`                     |
| the token's `name`    | `ResourceAttributes['remote']` — the `remote` label, set by the endpoint |
| its place in the batch | `LogAttributes['log.index']`                    |

It also reads the fields out of a line in the rules' form, and stores them in `LogAttributes` as
`group_uid`, `sender`, `details`, and `parent_group_uid` on a `group_spawn` that names one. A
line is in that form only when all of it matches:

    ^\[([^\]\s]+)\]\[([a-z_][a-z0-9_]*)\](?: (.*))?$

- A leading time never reaches this point: the agent has already taken it off (D2).
- A sender outside `[a-z_][a-z0-9_]*` is not a sender, so a quoted snippet of code or a
  bracketed word in someone's output is not taken for a grouped line.
- A foreign `[warn][cache_miss] …` does still read as group `warn`. `Body` is kept whole either
  way, so that costs a wrong label, never a line.
- Any other line is kept whole in `Body`, and nothing is guessed from it.

It lives in the same compose network as ClickHouse, so port 8123 stays unpublished.

**P18. A service serviceman starts learns its parent.** Following the rules, the caller's uid
goes with the work: serviceman passes its instance's group uid to the container or program as
`LOG_PARENT`.
- A service that honours it opens its root group with `[g][group_spawn] parent=<that uid>`.
  Then a trace in Logline climbs from a line inside the app, to the start that launched it, to
  the request that woke it.
- A service that ignores it stays a root, which the rules allow.
- The VPS's own compose services are not touched: their roots stay roots.

## The path of one line

```
container stdout
  → docker keeps it (json-file)
  → agent: docker logs -f --timestamps
  → agent spool (fsync)                        ← cursor for docker --since
  → POST to the endpoint, the D1 array
  → endpoint: parse, insert with dedup token
  → 2xx back to the agent                      ← agent deletes the batch
  → otel_logs, shown in the log-ui
```

serviceman is not on this path. It says where the endpoint is (P2), and it shows how far behind
each machine is (P16).

## Where a line can still be lost

No design gets this to zero. These are the known places, and each one is said in the log when it
happens, never silently.

1. **A container removed before the agent read it** — `docker run --rm`, or a compose recreate
   while the agent is down. Its lines went with it. Seen as a container that `docker events`
   reported and `docker logs` no longer knows: `[logline_lost] container=… reason=removed`.
   The only full cure is a log driver that outlives the container (journald), which changes the
   VPS's docker config; not proposed.
2. **Rotation outrunning a paused agent.** A container with `max-size` rotation drops its oldest
   lines if the agent is paused for longer than the rotation keeps. Seen as a `--since` whose
   first line is later than the cursor while the container has run all along:
   `[logline_gap] container=… from=… to=…`.
3. **The disk itself** — a spool on a disk that dies. Out of scope.

## Open — to decide

1. **Spool caps.** Proposal: 1 GB or 10% of the disk, whichever is smaller.
2. **Which VPS stream everything first.**
3. **Logline catching up with the rules.** Its collector expects an unbracketed
   `2026/08/15 00:48:05`, the sender `spawn`, and fields named `subject` / `description`. The
   rules say bracketed ISO time, `group_spawn`, `sender` and `details`. Proposal: Logline follows
   the rules, its log-ui reads `sender`/`details`, and old rows keep working through a view.
   Lines that come through the endpoint are parsed by the endpoint, so this touches only what
   still comes through that collector.
4. **serviceman's Log page.** It keeps the last 2000 lines in memory. Should it read Logline
   instead, so that history and search are in one place? The cheatsheet already draws what it
   could show: a lane per group, `group_spawn` arrows, the tree view, and a summary per group
   read back from the lines themselves.
5. **The name of the parent variable** (P18): `LOG_PARENT`, or something the rules name?

## Order of work

0. **Built 2026-09-26.** The `logline` key, each remote's `logs`, the agent's addresses in its
   hello, and the agent told its endpoint, token and floor (P1, P2, D6). Nothing is collected
   yet; it is the switch the rest hangs on.
   - serviceman: `src/main/src/helpers/logline_*.js`, and `PUT /api/v1/remotes/<name>/logs`.
     A remote's **Logs** tab switches it (Off / All containers; off is asked twice) and shows
     where it stands — Off, Nowhere to send, Offline, Agent too old, Not told, Switched on,
     Catching up, Held back, Active — with where the lines go, since when, the token's
     addresses, and the numbers of P16: sent, batches, waiting here, oldest waiting, last sent
     and Logline's last answer. Until step 3 the agent reports `collecting: false`, and the
     numbers show as dashes. Tests: `tests/logline.test.js`, with a real agent and the real
     endpoint code in one process.
   - agent: `src/agent/src/agent_addresses.js`, `agent_logline_*.js`.
1. **Built 2026-09-26.** The endpoint in Logline, `logline/lines/`: node, the house rules,
   `@vbarbarosh/node-helpers` its one dependency. `/tokens` issues and revokes tokens bound to
   IPs; `/lines` checks them, takes the D1 array, and stores it without duplicates (D6, P17,
   P13). It runs as the `lines` service in `logline/docker-compose.yml`, and writes as the
   ClickHouse user `lines`, which may insert and set the dedup window, and nothing else. Tested
   against a real ClickHouse 25.8: a batch sent twice is one copy, times keep their
   nanoseconds, and `remote` is the token's.
2. **Built 2026-09-26.** The spool, `src/agent/src/logline_spool.js`: segments of at most 16M
   (an eighth of the cap when that is smaller), synced every 200ms, `acked.json`,
   `inflight.json` (a batch is cut once and sent again byte for byte), `cursors.json` (what
   deleted segments knew, with the last seq they cover). Full counts what waits to be sent,
   not what is on disk. A torn last line is cut off at recovery.
3. **Built 2026-09-26.** Following containers, `logline_collect.js` and `logline_follow.js`,
   through the engine's API on its socket rather than the docker command: the API gives a
   container's stdout and stderr as one stream in docker's own order, which the command splits
   into two pipes. Every container in the list, every one docker's events say started, and the
   list read again every five minutes and whenever the events stream drops. A stopped
   container is read to its end and once more. D2/D3 in `logline_time_strip.js`.
4. **Built 2026-09-26.** Shipping, `logline_ship.js`: in order, one batch at a time, 1000 lines
   or 1M; a 2xx acks, 401/403/404/408/425/429 and no answer send the same batch again after 1s
   doubling to 60s, any other 4xx puts the batch in `refused/`. Totals in `stats.json` feed the
   Logs tab.

   Tests: `tests/logline_agent.test.js` (the spool, including 40 seeded runs of random appends,
   syncs, batches, acks and restarts, checked line for line) and `tests/logline_collect.test.js`
   (a stand-in docker engine, the real endpoint, a ClickHouse that keeps one copy of a batch
   sent twice, and a real agent killed four times while two containers write, with Logline away
   through one restart and a container that runs and stops while the agent is down: every
   line arrives once). Not yet proved against a real docker: that `since` takes the stamp
   itself, the last row of D8's table. Docker's source says it does; if it did not, a line
   sharing a nanosecond with the one before a restart would be skipped.
5. **The agent's half built 2026-09-26** (P8):

   > agents should automatically send/handle their own logs too

   Every line `agent_say` writes also goes into the spool, as `[group][sender] details` with
   its time beside, labelled `service=serviceman-agent`, and is synced right after a burst —
   it cannot be read again from anywhere. Lines said before collection has started, `agent_begin`
   after a restart among them, wait in memory (up to 1000) and go in once it has. serviceman's
   own lines (P9) go by D9 for now: its `data/logs` watched as a folder by the agent on its
   machine.
6. Watching the pipeline (P16), the parent uid (P18), then the Log page (open question 4).
