# Changelog

Every change raises the patch version and is said here in short, the newest first.

## 1.0.33 — 2026-11-10

- A file opened from the File Manager under its machine's own name (`<name>.fs.<control host>`)
  is opened by a grant for its folder, kept as a cookie of that folder for an hour, and the
  machine's agent keeps the reading inside it, links too; a file that is no page is granted
  alone. The owner's cookie opens nothing there any more: with it, an `.html` left among a
  machine's files read every file of that machine once the owner opened it. The page's links
  go through `GET /api/v1/remotes/<name>/fs/open/<path>`. (SM-260)

## 1.0.32 — 2026-11-10

- The agent no longer stops at a handshake on its peer port that is reset before the answer,
  which needed no token: the socket's error is listened for first. What answering a caller
  throws, at the peer port and at the door, is a 500 or a closed socket and a line in the
  agent's log (`peer_request_error`, `peer_upgrade_error`, `door_request_error`,
  `door_upgrade_error`), where it ended the agent. Agent 1.33.2. (SM-215)

## 1.0.31 — 2026-11-10

- module-host no longer stops at one request: a folder named `constructor` is a 404, an
  address that is no address (`GET //[`) a 400 at the page's door and a closed socket at the
  websocket's, as in web-terminal. A file's path whose percent signs spell no text is the File
  Manager's own 400 on every host, where serviceman's door answered its 500 page. (SM-243)

## 1.0.30 — 2026-11-10

- serviceman, the agent and Logline's lines server go on when whoever read their stdout is
  gone (a pipe to `tee`, a supervisor that restarts its reader): the error that comes back for
  the next line is listened for, and no line is tried there again. Unheard, it ended the
  process; stderr is kept the same way. Agent 1.33.1. (SM-294)

## 1.0.29 — 2026-11-10

- A Docker socket that answers 200 with what is no JSON, when a container's shell is opened,
  is told to the pane that asked ("docker answered 200 with what is no JSON"): read inside a
  listener nobody holds, it stopped serviceman. (SM-176)

## 1.0.28 — 2026-11-10

- The end of a load test no longer stops serviceman when its state folder cannot be written:
  the run's log and the file of runs are each written by itself, and the one that fails is a
  line in the log (`load_test_log_write_error`, `load_test_runs_write_error`). (SM-177)

## 1.0.27 — 2026-11-10

- web-terminal no longer stops at one request from whoever reaches its port: an address that
  is no address (`GET //`) answers 400 at the page's door and closes the socket at the
  websocket's, and a handshake with no token that is reset before its 401 costs its socket
  alone. Each ended the process, and every open terminal with it. (SM-282)

## 1.0.26 — 2026-11-10

- A line from a machine that is no JSON object fails what was reading it and nothing else: a
  folder's tree, a watch, a folder copy's walk, the answer to a file sent, and Logline's files
  compared with the machine's. Each read it with a bare `JSON.parse` inside a stream's
  listener, and one such line stopped serviceman. (SM-240)

## 1.0.25 — 2026-11-10

- A link that drops while a link test sends its bytes fails that test and nothing else: the
  refusal of its stream is held until the test waits for it, and the spell stops at a stream
  that is gone. Held by nobody, it stopped serviceman. (SM-201)

## 1.0.24 — 2026-11-09

- A test of the forwards compared the table of serviceman's own forwards with `{}`; the table
  has no prototype since 1.0.23, and the test, which failed in that version, reads its keys.

## 1.0.23 — 2026-11-09

- A forward may be labelled `constructor`, `toString` or `__proto__`: the tables kept by a
  forward's label have no prototype. Such a label, saved by a token with the forwards right
  alone, stopped serviceman a second later and again at every start. (SM-200)

## 1.0.22 — 2026-11-09

- What a machine says of itself no longer stops serviceman: a hello whose `can` is no list, or
  an answer to `forwards_set` of another shape, is a line in the log. The three tellings a hello
  sets off (forwards, doors, shared folders) let nothing out. (SM-199)

## 1.0.21 — 2026-11-09

- A pane whose far end sends a frame the websocket's rules forbid is cut alone, at serviceman's
  shell doors, in module-host and in web-terminal: six bytes from a token holder stopped the
  whole process. (SM-170)

## 1.0.20 — 2026-11-09

- A handshake whose address is no address (`GET //`) is dropped, at the control port and under
  the control name on the service port: it stopped serviceman, with no token. What a handshake's
  handler throws now costs that socket, not the process. (SM-168)

## 1.0.19 — 2026-11-09

- A full audit of the project, `notes/audit-2026-11-09.md`: 182 findings, SM-168 to SM-349,
  each with the line it names and how it was found. Nothing is mended in this version.

## 1.0.18 — 2026-11-07

- Vulnerabilities: Ubuntu's critical CVEs on each machine, read from Ubuntu's own list every
  hour; a Security column, a machine tab, and a red bar when one is new or its fix is out.

## 1.0.17 — 2026-11-04

- A file to a machine keeps about a second of its pace on its way, not 4 MB, so a call waits
  seconds behind it (33 s at 128 KB/s before); a link whose bytes still creep is reset at 30 s,
  as one whose bytes stand (`the way to it fell behind`).

## 1.0.16 — 2026-10-31

- History has a **10m** range: servermon's lines, a point a second, read every second (only the
  new seconds cross the link); a refresh no longer dims the charts. Agent 1.32.0.

## 1.0.15 — 2026-10-31

- docs/remotes.md and logs.md named a `status` file beside the agent; it is `bin/status`, which
  asks the running agent over its socket.

## 1.0.14 — 2026-10-31

- The Health check asks a machine once a link, not every minute, about a mounted file its agent
  may not open: the shared folders' home wrote four EACCES lines a minute into both logs.

## 1.0.13 — 2026-10-30

- Each machine in the rail shows its CPU and memory as two small bars; a tick on the CPU, Memory
  and Disk tiles of its Overview chooses which, kept in this browser.

## 1.0.12 — 2026-10-30

- A forward a token adds or changes says which token asked for it (`by`), shown on the page. A
  revoked token's forwards, or those it may no longer hold, are set aside at once, and what it
  holds open (a shell, a watch, an upload) is cut.

## 1.0.11 — 2026-10-30

- `GET /api/v1/forwards` also says where serviceman's own sockets come from (`sources`), a
  token's those from its machines, read only.

## 1.0.10 — 2026-10-30

- A token's `forwards` right: `GET /api/v1/forwards` and `PUT /api/v1/forwards` see and write
  the forwards between its machines alone, the others kept as they were.

## 1.0.9 — 2026-10-30

- The dark theme's loose ends: scrollbars, checkboxes and select lists dark (they were white),
  both editors in Olive 3's code colours, tags with their edges, selected buttons in the
  selected colour, the header's search a field. The light theme is unchanged.

## 1.0.8 — 2026-10-29

- Takes out two files of a terminal a local test opened (src/agent/terminals/), which 1.0.7
  carried by mistake.

## 1.0.7 — 2026-10-29

- The dark theme in the colours of the author's Olive 3: an olive page, olive-dark bars, near-black
  cards, a blue accent, each by its role, in both skins, the terminal, the docker log and the
  pages a visitor sees; red text keeps to a card or its tag. The light theme is as it was.

## 1.0.6 — 2026-10-29

- Test the link, under a machine's Link tile: eight seconds of bytes each way, a quick call timed
  every quarter second, and what both ends dropped and sent again, as a chart per way and the
  numbers; `POST /api/v1/remotes/<name>/link-test`, `link_test_end_ok` (agent 1.31.0).

## 1.0.5 — 2026-10-29

- A link whose way to the machine stands is reset after 30 s, and the agent dials a fresh one:
  a call waiting 30 s behind a file whose bytes stood 30 s, the machine still heard
  (`remote_dropped reason="the way to it stood"`), where it waited 1½ to 4 minutes; the agent
  dials fresh by itself after 30 s of nothing while a file comes in (agent 1.30.2).

## 1.0.4 — 2026-10-29

- A machine not answering names the file its link carries meanwhile: how much was sent, how much
  the machine wrote and when its bytes last moved, on its page and in the log's
  remote_unanswered and remote_answering (`file= sent= taken= still=`).

## 1.0.3 — 2026-10-29

- A copy between machines whose bytes stand still for 30 s is cut and goes on by itself from
  where the disk says it stands, where it waited for Cancel; the line under it names the file on
  its way, read from the tar's headers, not "56 small files in one go".
- A machine whose calls wait past 10 s says "not answering" beside its name, its dot orange, and
  the log says once when it stops answering and once when it answers again.

## 1.0.2 — 2026-10-29

- A machine's lines gather ten seconds before they go to Logline: a batch every ten seconds, not
  an INSERT a line; Logline's own four containers carry `logline=off`, so the agent on its machine
  no longer sends it its own lines back; ClickHouse's own logs keep three days, and the four
  nothing reads are off (`config/clickhouse-logs.xml`).

## 1.0.1 — 2026-10-28

- The version goes up with every change, and this file says each change in short.

## 1.0.0

- Everything before this file.
