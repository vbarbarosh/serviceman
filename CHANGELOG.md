# Changelog

Every change raises the patch version and is said here in short, the newest first.

## 1.0.85 — 2026-11-14

- What takes the space counts a disk once: the agent keeps what its one walk found in every folder, an hour after it was last asked for, and a folder opened afterwards, or while the walk goes on once it has been through it, opens at once; the count says when it was made, and Count again walks the disk anew. Docker's counts stay fresh. Agent 1.35.0.

## 1.0.84 — 2026-11-13

- A machine's card for lines Logline refused says what Logline answered for the newest file and counts from the oldest one; it is a warning while lines still go, and says "sends Logline nothing" only once a refused line waits for room. Agent 1.34.0.

## 1.0.83 — 2026-11-13

- A Save of the config reads the file over the settings serviceman started with (`config/index.js`), as its start does: a file that names no `listen` or `control` no longer says they changed and waits for a restart. The same for a form's Save, a machine that joins and a revoked token's forwards.

## 1.0.82 — 2026-11-13

- Restart pressed while a service is starting ends with the service running: whoever wants it up after a stop of its start gets a start of its own, not the cut start's end; an image pull that ends while its service starts is mended by the same line (SM-180). Registered SM-372 (a Stop pressed during a Restart's own stop is not the last word kept).

## 1.0.81 — 2026-11-13

- A token is drawn as dots wherever the page shows it: a remote's Settings and install commands, the join token and its command, a token just made on the Tokens page or for an app folder, and every `token` in the Config editor. Copy takes the real one; Check and Save put each token back as it was, and one typed over the dots is the new one.

## 1.0.80 — 2026-11-10

- A program waiting to be started again (restart: always, after it ended by itself) is no longer started by its timer once Stop is pressed, the service is removed or changed by a Save, or serviceman stops; any start in the wait is the restart (`program_restart_cancel` in the log) (SM-181). Registered SM-371 (a program that ends at once is marked running).

## 1.0.79 — 2026-11-10

- A copy of a file that got shorter while it was copied ends at once, "the file got shorter while it was copied", its part left a part and nothing landed under its name; the copy behind it goes (SM-206). Registered SM-369 (a folder's tar pads a shrunk file with zeros) and SM-370 (a download ends short with no error).

## 1.0.78 — 2026-11-10

- Logline's lines server answers 422 for what ClickHouse refuses about the lines themselves (too many days in one insert, a time past 2262), 502 for all else as before; the agent halves a refused batch down to the line refused, sets that line aside in a bounded refused/, and every other line goes in. Health says it as Logline refusing some lines, not as down (SM-287; agent 1.33.17).

## 1.0.77 — 2026-11-10

- The agent's root half refuses a volume target or a shared folder's path with a link in it (409, naming the link), does its folder work and its mount on the folder it looked at, held open, and puts the system's folders first on its PATH (SM-214; agent 1.33.16). Registered SM-367 (a shared folder's path swapped mid-way still races its mount) and SM-368 (a volume under a home behind a link reads Closed).

## 1.0.76 — 2026-11-10

- A machine has at most 1024 streams of its own open towards serviceman, and none before its hello: one more is refused (`ETOOMANY`, `ENOHELLO`, said once a link), a visitor at its door gets 502, and the link carries on (SM-203). Registered SM-366: the refusals themselves still wait unbounded in the link's queue.

## 1.0.75 — 2026-11-10

- serviceman counts each stream's window itself: a machine that sends past it and a piece, or makes room for bytes it was never sent, loses that stream (`EWINDOW`, said once a link) and the link carries on; room for bytes still in serviceman's queue counts once the link took them (SM-202).

## 1.0.74 — 2026-11-10

- The link test's stand test asks for more than 1125 ms where it asked for 1250, one of its quarter-second counts itself: a right link read 1249 now and then and the suite failed (SM-365).

## 1.0.73 — 2026-11-10

- A kept terminal's holder waits for no reader and for no program: a reader a megabyte behind is let go and joins again at the history, and what is typed waits without stopping the terminal. It stood still for everyone while one pane read nothing. Agent 1.33.15 (SM-222; SM-363, SM-364 registered).

## 1.0.72 — 2026-11-10

- A tar whose header says a size that is no whole number (letters, a minus) is refused at that header, by the entry's name: it was held whole in memory, and a minus size never answered again. A body that names nothing is the disk's after 2 MiB. Agent 1.33.14 (SM-241; SM-362 registered).

## 1.0.71 — 2026-11-10

- A test of 1.0.66 made no token (its body was sent as quoted text) and asked as the owner: it now makes one and asks `/remotes/%zz/ports` with it. No code changed.

## 1.0.70 — 2026-11-10

- Twelve write routes of the control door answered 500, "serviceman broke on this request", to
  a body of `null`, and four of them to one that is no JSON at all; two took a list or a number
  for an empty form and answered 200. Every route reads its body through `body_fields` now: an
  empty body has no fields, and JSON that is no object is a 400. The firewall module's two
  write routes answered 502 with the exception's text, and answer as for an empty form.
  (SM-173)

## 1.0.69 — 2026-11-10

- `GET /modules/__proto__/x` answered 500: the table of the modules' folders was asked for a
  name every object has. It is asked for its own names alone now (`Object.hasOwn`), and
  `__proto__`, `constructor` and `toString` answer 404 as any name that is no module. (SM-172)

## 1.0.68 — 2026-11-10

- A terminal's output was sent on to its pane whatever the pane had taken: `yes` on a machine,
  watched over a slow line, grew serviceman by the difference (93 MB to 354 MB in 8 s), Ctrl-C
  was followed by 47 s of old output, and a shell that printed 50 MB and exited lost its last
  lines. With more than 256 KB waiting for a pane its stream is paused now, so the program
  waits to print, on a machine, in a container and in the web terminal; nothing is dropped. A
  held pane that takes nothing at all for 20 seconds, a laptop asleep, is let go, so it does
  not hold a kept terminal for the others joined to it. (SM-242)

## 1.0.67 — 2026-11-10

- A machine taken out of the config was told "removed", and its agent then deleted its whole
  folder: every app folder under `services/` with its `data/`, the logs, `env`; an agent
  fetched as one file into a home folder took the home folder. Now it stops, leaves systemd
  through the installer's own `bin/uninstall`, and deletes nothing; a token the machine kept is
  set aside as `token.removed`, so a start by hand dials with the token it is given. An agent
  that held a door or a program open no longer stays up after it. The page and the docs say
  what happens. Agent 1.33.13. (SM-216)

## 1.0.66 — 2026-11-10

- `GET /api/v1/remotes/%zz/fs` answered 500, "serviceman broke on this request", with `URI
  malformed` in the log: the name was decoded bare where a module's door is found, where a
  token's right is looked up, and in the three routes of the shared folders. All five decode
  through `route_param` now, and such a word answers as a name that is not there. (SM-171)

## 1.0.65 — 2026-11-10

- Every whole run of the suite left one process behind, the stand-in container a door's test
  wakes (`upstream.js … serviceman-sleepy`), and some 380 temp folders, 220 MB, in `/tmp`.
  That test stops its container and removes its folders now, and `bin/test` gives a run a temp
  folder of its own, removed when the run ends. A test file run by hand still leaves the
  folders its tests do not remove. (SM-337)

## 1.0.64 — 2026-11-10

- A folder copied between machines could write outside the folder it makes, two ways: a link
  one copy planted (`lib -> outside`) was written through by the next (`lib/evil.txt`), and a
  tar's own names landed beside the folder (`sibling.txt`, `.ssh/authorized_keys` into a home).
  Every write of a folder's copy now goes through a disk kept within `<folder copied
  into>/<name>`, and the tar is of the folder itself: a name that leads out, through a link
  too, ends the copy once, with why. A link of the owner's own that leads out of the copied
  folder is refused as well, where it was followed. An agent that cannot keep a root is not
  sent a folder. (SM-351, SM-352)

## 1.0.63 — 2026-11-10

- On the Secrets page a refused secret (a name with a space) emptied both boxes, and the typed
  value was gone; in a service's card the refusal was never read: the card closed, nothing was
  red, and the program started without its secret. A name the door would refuse is now red at
  once with the rule under it and nothing is sent; a refusal that comes all the same is said
  in the door's words, the boxes stay as typed and the card stays open. A secret taken away
  and typed again in one card is kept, where it was written and then deleted. The form open on
  a forward stays as typed when "forget it" is refused. (SM-266)

## 1.0.62 — 2026-11-10

- A card of a service built the entry it saved from its own fields, and the whole entry was
  replaced by it: any Save took `run_args`, `args`, a storage line's `create` and every key
  written by hand out of the file, a program that runs `argv` could not be saved at all, and a
  machine's Settings took its `log_dirs`. A form now saves the file's own entry, changed only
  where the form was changed (`entry_from_form.js`); what was emptied in a card still goes, and
  the preview shows what is sent. A whole entry sent to the API is written as sent, as before.
  (SM-261, SM-262)

## 1.0.61 — 2026-11-10

- `node src/agent/index.js` with no `SERVICEMAN_AGENT_DIR` took `src/agent/` for its folder, and
  three agents of the suite were started so: every whole run left `src/agent/doors/table.json`
  and `status.sock` in the checkout, and the next `bin/test` failed its own check. The agent
  named by its file is the repository too, and keeps its state under `data/agent`, as
  `node src/agent` does; the three get a folder of their own. Agent 1.33.12. (SM-330)

## 1.0.60 — 2026-11-10

- Cancel pressed in the first moment of Install updates stopped nothing: serviceman had begun
  the run and was still asking which containers run on the machine, so the machine was told to
  cancel before it was told to install, answered "nothing is being installed", and the install
  ran to its end. Such a run is stopped by serviceman itself now and never asks. On the
  machine, a Cancel while an Install waits for a fetch of the lists stops that Install, where
  it stopped the fetch and let the Install run. Agent 1.33.11. (SM-360)

## 1.0.59 — 2026-11-10

- A visitor who gave up while a sleeping service was starting, or in the line behind
  `concurrency`, was still given a place when its turn came, and the place was never given
  back: the service never slept again, or answered 504 to everyone, Restart included. A client
  that has left gets no place now, is out of the line at once, and nothing is asked of the
  service for nobody; a websocket handshake the same. (SM-175)

## 1.0.58 — 2026-11-10

- In the File Manager, Rename or Move onto a name that was there replaced it and said
  "renamed"; in a container `mv` also moved into a folder of that name. Every disk refuses a
  taken name now, in a copy's words (`<name> is there already`): the agent gives a file its new
  name as a second one first, so the disk itself refuses; a container's disk looks, then runs
  `mv -n -T`. The page says it before asking when its list holds the name, keeps the question
  open with what was typed on a refusal, and a Move of several goes on past the taken ones and
  says which stay. Agent 1.33.10. (SM-246)

## 1.0.57 — 2026-11-10

- A machine's hello was kept as it came: one with `resources: {}`, or a `stats` message with no
  stats, made `GET /api/v1/status` answer 500 for every machine, and went on doing so with that
  machine gone, until a restart. What it says is checked first (`remote_said_refusal.js`): a
  hello of another shape is refused and nothing of it kept, stats of another shape are left
  out, each said once a link as `remote_link_error`. The remotes list draws a machine with no
  stats yet without a false Memory bar and "up 0ms", and a long word a machine says of itself
  wraps inside its card. (SM-204)

## 1.0.56 — 2026-11-10

- `bin/release` ran `bin/test` alone, pushed every local branch and every tag (`git push --all`,
  `--tags`), and said its usage and "there is changes" on stdout. It runs the linter, the
  suite, the modules' tests and Logline's before anything is written, pushes the branch it is
  made on and the release's own tag, and says a refusal on stderr; the commit is
  `release: v1.2.3`. A test runs it in a scratch repository with an origin of its own. (SM-334)

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
