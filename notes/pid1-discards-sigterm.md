# PID 1 discards the SIGTERM

What was found, as it was written:

```text
TLDR: your bin/run patch works — but it promoted node to PID 1 of the container, and Linux discards SIGTERM for
PID 1 unless a handler is installed. So docker stop's signal is ignored, docker waits the full --timeout 10, then
SIGKILLs. The fix is serviceman's to make: add --init to the containers it creates.

The chain, from your config and serviceman's source:

- serviceman.docker.json:141 — google-docs-writer is a shell service with image: node:24, command: "bin/run".
- src/program_docker_argv.js:38 — the container command is /bin/sh -c "bin/run". dash execs the sole command,
  bin/run now execs node, so node ends up as PID 1.
- The kernel refuses default signal actions for PID 1 in a namespace (pid_namespaces(7)): a signal with no
  installed handler is simply not delivered — even from outside; only SIGKILL/SIGSTOP punch through. Node
  installs no SIGTERM handler, so the SIGTERM evaporates.
- Your log shows precisely that: docker stop --timeout 10 → agent_call_end_ok 10.292s — the SIGTERM did nothing,
  the SIGKILL at the deadline ended it.

None of serviceman's docker argv builders (program_docker_argv.js, docker_argv_from_service.js) pass --init.
With --init, docker inserts tini as PID 1; the command becomes tini's child with normal signal semantics, tini
forwards SIGTERM, and node dies in ~50ms. That fixes stop latency for every container serviceman makes — no
per-app SIGTERM handlers needed.

Note the bin/run patch stays load-bearing: with the old npm start chain, --init would forward SIGTERM to bash,
which still wouldn't pass it to node. Fast stops need both — exec so the child is the server, --init so PID 1
actually delivers.

One caveat for the rollout: docker_spec_hash.js doesn't cover this flag, so existing containers won't be
recreated to pick it up — a one-time docker rm --force serviceman-google-docs-writer on server (or folding an
argv version into the spec hash) is needed.
```

## Verified live (2026-08-24)

Driven through the control socket at `/repos/serviceman.sock`
(`POST /api/v1/services/google-docs-writer/start`, then `/stop`, phase polled
over `/api/v1/status`):

- start: 202, phase `running` after 1.5s (`docker start`, container reused).
- stop: 202, phase `stopped` after **10.54s**.

The event log for that stop:

```text
[21:44:18.716Z] service_stop_begin service=google-docs-writer instance=1 reason="asked from the control page"
[21:44:18.756Z] agent_call_begin remote=server method=docker argv="stop --timeout 10 serviceman-google-docs-writer"
[21:44:29.106Z] agent_call_end_ok 10.352s
[21:44:29.107Z] service_stop_end_ok 10.391s service=google-docs-writer instance=1
```

`docker stop` used its whole 10s budget: the SIGTERM changed nothing, the
SIGKILL at the deadline ended the container. GitHub master of
google-docs-writer already carries the `exec node src/http.js` patch, so this
is the patched chain misbehaving, not the old one.

The websocket shell (`/api/v1/shell`) could not confirm the process tree from
inside: it admits `docker` services only, and this is a `shell` service.
