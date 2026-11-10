# Changelog

Every change raises the patch version and is said here in short, the newest first.

## 1.0.55 — 2026-11-10

- The test "a machine may not open a stream this host would be using" wrote its frames on the
  host's own end of the link, so they went to the agent and the guard never ran: it passed with
  the guard taken out. A machine played by hand sends them now, and the test reads the three
  refusals (`EBADSTREAM` twice, `EBADTARGET`); it fails with any of the checks out. (SM-331)

## 1.0.54 — 2026-11-10

- The tutorial "A coding agent on a machine" said the Shell ends when its tab closes, and put
  the build and the coding agent into tmux under a systemd scope. A terminal of the Shell tab
  is kept by the machine: the tutorial opens one with **+** and runs both in it, and says what
  outlives the page, the link and a restart of the agent. (SM-315)

## 1.0.53 — 2026-11-10

- The agent read how much of an upload in parts is there with `stat`: through a link under the
  part's name it answered with the size of the file the link points at, and a token for one
  folder learnt whether a file outside it is there, and how big. It asks the part itself now,
  and a link or a folder under that name says 0. Agent 1.33.9. (SM-359)

## 1.0.52 — 2026-11-10

- The agent wrote each file of a tar to `.<name>.part` opened with plain `'w'`: a link planted
  under that name carried the bytes to the file it points at, outside the folder. The part is
  made new now, following no link, and is checked again before it takes the file's name, as a
  single upload's is. (SM-217)
- A folder under a part's name made the tar's drop throw in nobody's hands, and the agent's
  process ended: two requests with a token for one folder. The drop is caught, in a single
  upload too; the tar is refused by the folder's name and the agent goes on. Agent 1.33.8.
  (SM-358)

## 1.0.51 — 2026-11-10

- A machine's `log` message was written into serviceman's log as it came: with another
  machine's `remote=`, with a key that held a line break (a whole second line, any time, the
  process's own group), with a sender of 100 000 letters. Now `remote=` is the machine the link
  belongs to, a key that is not a word is left out, a sender has 64 letters at most, and no
  machine writes under the groups its link hangs from; why a line was not kept is said once a
  link, as `remote_link_error`. A line of free text is still written as sent (SM-357, open).
  (SM-286)

## 1.0.50 — 2026-11-10

- The test of a file's grant (1.0.33) changed the last letter of the grant's signature to prove
  a changed grant is refused; the last letter of a base64 text holds bits that are thrown away,
  so one run in sixteen the changed grant was the same grant and the test failed. It changes
  the first letter now.

## 1.0.49 — 2026-11-10

- `docs/how-it-works.md` said serviceman never deletes and that the next request always tries
  a failed start again. It says what serviceman removes by itself (a replaced container, a
  removed program's folder), what the Docker tab and the File Manager remove when asked, and
  that after `start_tries` failures it gives up until something changes; `docs/overview.md`
  follows. (SM-318)

## 1.0.48 — 2026-11-10

- "What the token buys" in `docs/remotes.md` named docker commands, a folder and streams, and
  said the agent runs no shell and dials only its `--url`. It says what an agent does now:
  programs and shells, the user's files, apt, and with the root half ufw, ssh, encrypted
  volumes and shared folders; and where else it dials (Logline, the peer port, juicefs).
  (SM-316)

## 1.0.47 — 2026-11-10

- `docs/config.md` and `docs/usecases.md` said a program does not outlive a restart of the
  agent; it does, and the next agent takes it back. They say so now, and that a program is
  stopped by stopping its service. (SM-314)

## 1.0.46 — 2026-11-10

- The sign-in wall is told the visitor's address the front vouches for: the last of
  `X-Forwarded-For`, else `X-Real-IP`, and nothing that is no address. A machine's door told
  it the first of the list, which the visitor writes, and serviceman told it nothing for what
  came through a link. At a door, `X_Auth_User` and `X_Serviceman_Relay` are dropped as their
  `-` spellings are. Agent 1.33.7. (SM-228)

## 1.0.45 — 2026-11-10

- The agent's program follower no longer ends the agent when a file a program prints into
  cannot be read or emptied (a disk gone read-only, the file taken away between two looks):
  it says `program_follow_error` once and tries again at its next look. Thrown from its
  timer, it ended the agent. Agent 1.33.6. (SM-355)

## 1.0.44 — 2026-11-10

- web-terminal's image copies `src/helpers/term_size_valid.js`, which the Terminal module
  requires, and the agent's image `modules/file_manager/server/tar_parser.js`, which the agent
  requires: by the files, the first ended at its first `require` and the second at its
  bundler. A test walks each image's program and holds its `COPY` lines to it. (SM-354)

## 1.0.43 — 2026-11-10

- Seven config examples of the docs that the validator refused name their machine, their
  address and their image now (`docs/config.md`, `docs/remotes.md`, `docs/usecases.md`), two
  shortened lines are written whole, and `tests/docs_examples.test.js` runs every `json` block
  of the docs through the validator the real file goes through. (SM-307)

## 1.0.42 — 2026-11-10

- `"socket": null` for `listen` or `control` means no socket file, as leaving the key out
  does: the whole file of `docs/config.md`, the first a reader copies, stopped serviceman at
  its start with an error that named no field. A socket that is no path is refused by its
  name. (SM-306)

## 1.0.41 — 2026-11-10

- Tracked files hold the rule's placeholders where they held private things: a person's name
  in a note, a link to a private artifact, machine names and initials in a comment, and
  `/home/me` (the File Manager's tests and README), which is `/home/user` now. (SM-338)

## 1.0.40 — 2026-11-10

- A service that answers with a status no HTTP has (`HTTP/1.1 099`, `000`), or with status
  words node refuses, is a 502 for that visitor: at serviceman's proxy, with an
  `upstream_error` line, and at a machine's door. Passed on from a callback nothing catches,
  one such answer stopped serviceman, or the agent. Agent 1.33.5. (SM-350)

## 1.0.39 — 2026-11-10

- The audit's note gains what was met while mending, SM-350 to SM-356 (three high: a service's
  status 099 stops serviceman and the agent; two ways a folder's copy still writes outside its
  folder), and AGENTS.md names the last issue id as it is now. (SM-328)

## 1.0.38 — 2026-11-10

- A machine whose agent answers the security check with a part missing or of another shape is
  shown with that check grey, "not read", and why; an answer that is no facts at all is a part
  that could not be asked. One that still breaks a check costs that machine its row, said once
  as `security_view_error`. Before, one such answer made every status answer a 500 until
  serviceman restarted. (SM-178)

## 1.0.37 — 2026-11-10

- A folder's copy between machines takes from the source's walk only paths under the folder:
  one from the root, or with a `..`, a `.` or an empty part, fails the copy at once and for
  good, before anything is written, naming the machine and the path. A machine whose agent
  lied wrote files, folders and links anywhere its neighbour's agent could. The rule is the
  tar's own (`tar_parser`), which the agent bundles: agent 1.33.4. (SM-239)

## 1.0.36 — 2026-11-10

- The agent no longer stops, at every start, when its Logline spool cannot be written (a
  read-only folder, a full disk): the lines wait in memory, a segment of them at most, the
  agent says `logline_spool_error` once and `logline_spool_ok` when the disk takes them again,
  each line written once. Until then it reads no more from docker or the files, which keep
  their lines. Agent 1.33.3. (SM-284)

## 1.0.35 — 2026-11-10

- web-terminal's websocket asks which page opens it: a handshake whose `Origin` is not the
  host and port it was sent to is answered 403, however its token came. The browser sent the
  page's cookie from any page of the same site, so a page of a neighbouring service opened a
  shell in the browser of whoever was signed in. A program names no `Origin` and is not asked.
  (SM-283)

## 1.0.34 — 2026-11-10

- What a visitor writes into `X-Auth-User` is dropped from every request and handshake at the
  service port, not only from those that came through a machine's door: on a service's own
  address anyone signed in as anyone. `X_Auth_User` goes too, for the stacks that read `_`
  and `-` alike. The wall's own word is set after, as before. (SM-169)

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
