# A SIGTERM that never arrives

What was found, as it was written:

```text
TLDR: the server never receives the SIGTERM at all. bin/run builds a 4-process chain — bash → npm start → sh →
node src/http.js — and a SIGTERM to the top kills only the bash script. Nobody forwards the signal, so the node
server keeps running; whoever is stopping it then sits out its full grace timeout and only the SIGKILL escalation
(which serviceman's pgid_kill_grace sends to the whole group after 5s) actually ends it. That grace timeout is
the wait you see.

Measured on the real chain, in this container:

- node src/http.js alone: SIGTERM → dead in 0.05s (the app has no handlers; Node's default applies immediately).
- SIGTERM to the bin/run pid: bash dies, but npm start, sh, and node all survive — 2s later the port is still
  bound and /api/session still answers 200. The server would run forever.
- SIGTERM to the npm start pid directly: same story — npm and sh die, node is orphaned to PPID 1, still serving.
- SIGTERM to the whole process group: dead in 0.05s.

So the delay is not in the app, the cli() keep-alive timer, or open connections — it's purely that bash and npm
both drop the signal on the floor instead of passing it to node. Any supervisor that SIGTERMs one pid and then
waits before SIGKILL pays its full grace period every time (5s for pid_kill_grace/pgid_kill_grace, 10s for docker
stop, 90s for systemd's default).

The fix, when you want it: make bin/run end with exec node src/http.js instead of npm start. That collapses the
chain to a single process — the pid you signal is the server, and SIGTERM stops it in ~50ms. (exec npm start is
not enough; the npm layer swallows the signal too, as measured above.)
```

## What it means for serviceman

serviceman starts a shell line in a process group of its own (`detached: true`), and it signals the
group, not the pid — so `npm` swallowing the signal does not save the program from being asked to
stop. Two things about it were weak, and both are fixed in `program_kill`:

* **It waited for the wrong thing.** The wait was for the process serviceman started — the `bash` of
  the chain — and that one dies at once. Everything under it could still be running, and still
  holding the port, while the service was already called stopped. The next start then met its own
  leftovers on the port. Now the wait is for the *group*: `kill(-pid, 0)` succeeds while any process
  of it is left, and the stop is not over until that fails.
* **The escalation said nothing.** A program that needed the SIGKILL now says so — `program_killed`,
  with how long it was given first. A line like that in the log is what points at a chain like the
  one above.

## The second finding: pid 1 swallows the signal too

What was found next, as it was written:

```text
TLDR: your bin/run patch works — but it promoted node to PID 1 of the container, and Linux discards SIGTERM for
PID 1 unless a handler is installed. So docker stop's signal is ignored, docker waits the full --timeout 10, then
SIGKILLs. The fix is serviceman's to make: add --init to the containers it creates.

- src/program_docker_argv.js — the container command is /bin/sh -c "bin/run". dash execs the sole command, bin/run
  now execs node, so node ends up as PID 1.
- The kernel refuses default signal actions for PID 1 in a namespace (pid_namespaces(7)): a signal with no
  installed handler is simply not delivered — even from outside; only SIGKILL/SIGSTOP punch through. Node installs
  no SIGTERM handler, so the SIGTERM evaporates.
- The log shows precisely that: docker stop --timeout 10 → agent_call_end_ok 10.292s — the SIGTERM did nothing,
  the SIGKILL at the deadline ended it.

With --init, docker inserts tini as PID 1; the command becomes tini's child with normal signal semantics, tini
forwards SIGTERM, and node dies in ~50ms.

Note the bin/run patch stays load-bearing: with the old npm start chain, --init would forward SIGTERM to bash,
which still wouldn't pass it to node. Fast stops need both — exec so the child is the server, --init so PID 1
actually delivers.
```

Done 2026-08-23: both builders (`program_docker_argv.js`, `docker_argv_from_service.js`) pass
`--init` on every `docker run`.

Done 2026-08-24: `docker_spec_hash` carries a **run-line version** (`LINE_VERSION`), bumped to 2
for `--init`. Every container made before it is old at once and is replaced on its next start —
nothing to delete by hand, which is the way Vladimir wants rollouts. The replacement is a
`docker rm` + `docker run`: storage survives it (kept folders and volumes live outside the
container), anything written inside the container goes, which is the standing rule anyway.

This is the same mechanism that caused the notes.localhost incident of August — a hash change
recreating every container. The difference is intent: then it was an accident of adding a key
for one kind, now it is the tool reached for deliberately, with the version there to be bumped
when the run line must reach every container that exists.

## What it means for a program run under serviceman

A `command` that ends in `exec` is a program serviceman can stop in milliseconds instead of seconds.
The group signal makes the difference invisible in the end, but the difference is real: five seconds
per stop, every stop, and a port held for all of it.

    bin/run:  #!/bin/sh
              exec node src/http.js

`exec npm start` is not enough — npm makes its own child and drops the signal.
