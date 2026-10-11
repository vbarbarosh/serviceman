1) agent request "upgrate token"
2) new version is downloaded
3) new vewsion is connected using "ugrade token"
4) new version is verified
5) if ok new version stays; old version is disconnected


  1. Who starts it — the host (it knows both versions) or the agent (it holds the machine)?
  2. Who runs the new process — the old agent spawns it? Then what kills the old one: systemd would take the child with it,
  and the container form runs one process as PID 1.
  3. What "verified" means — it said hello with the new version, or it also answered a ping, reported resources, and ran one
  real docker call?
  4. Requests in flight during the overlap — the old link is still proxying. Do they drain on the old link, or move?
  5. The token itself — one use only, how many seconds, and kept in memory rather than written to the config file.
  Security-first says: never on disk, single use, short life, and useless for anything except attaching a second link to that
  one remote.

  One risk worth naming: the old agent must not exit until the new link is accepted, and a failed verify must leave the old
  one running untouched — which is what step 5 implies, and is the part most likely to go wrong under a bad network.

----

In general all of this is responsibility of host; the tricky part is to spawn
new agent;
    - host could stop sending new reqeust to old agent
    - host cold send SIGTERM to agent
    - host cold send UPGRADE signal to agent
    - host cold await for RUNNING requests
    - upgrade token is a one time token to start new agent
    - What "verified" means --- not yet decided; should be healthcheck; at least sucesful connection + ping + sending version of agent and signal ready to work

---

DOCKER

❯ for docker image: 2 parts; 1) hardway --- when docker image should be replaced; there is no other way to do id with just
  serviceman tools; an image should be pulled; then restarte etc; out of scope; 2) docker image will have "root" service and
  agent; that way agent could be restarted; this is easy and natural; host should know docket image version and agent
  version inside;

  1. Should the upgraded agent survive a recreate? It does if /var/lib/serviceman is a volume. I'd say no — recreate should
  give you exactly what the image says, and the page tells you when that is a downgrade.

  interesting; no it should not rely on survive;
  usually i do "docker down" / "docker up -d"
  that way, when agent starts it should connect,
  enter pending mode, check upgrades for agent.js; if any then download;
  then enter upgrade mode; in case of fail just enter READY mode; in case of
  success exit main thread keeping only upgraded; 
  of course, it should save state somewhere; so next time it will be started
  it will have a chanse to know that latest version as downloaded and
  sucesfully connected; so it could very quicly start without downloaded what
  it already have.

---

NODE.js

plain agent.js could work similar way; it coudl always start as "supervisor";
then spawn itself for work; when necessary spawn a replacement copy;
node.js approach reminds docker flow; actually, it could the the same exact
script.


----------

  1. Does the supervisor re-exec itself from the newest known-good file on boot? Otherwise you run supervisor 1.0.0 with
  worker 1.2.0 forever, and docker down/up is the only thing that ever moves the supervisor. Re-exec makes both the same
  version after one restart.
  2. How does the worker ask the supervisor to spawn the candidate — a node IPC channel on the child (stdio: [..., 'ipc'])? It
  is the only new mechanism in the whole design.
  3. What marks a version bad, so a broken build is not downloaded and tried on every single boot? I'd write the version and
  the reason in the state file and skip it until the host offers a different one.
  4. Where the state dir lives by default — /var/lib/serviceman-agent, with --state to move it?

1) for now lets keep supervisor not re-exec itself;
2) this whole process should be the job of supervisor; worker should be simple;
   it should just start and be ready for work; that way when first worker
   started, we need to give signal to host to popone giving jobs to this
   worker. then either remove this flag, or terminate worker.
3) when worker failed; basically when host was not received READY signal;
   supervisor will check that, and just makred this version as broken.
4) does not matter; home dir should be ok

with this design server will alwasy have 2 version: version of supervisor and
version of active/running worker.



--- claude ---

● You're right, and the complexity is all mine — it comes from one line I took too literally: verified while the old one is 
  still connected. That single requirement is what forces the upgrade token, a second link per remote, a pending phase, host
  endpoints and the whole candidate dance.

  Drop the overlap and it collapses:

  supervisor:
    1. GET /api/v1/agent.js            (public, no token)  → different from what I have?
    2. yes → save it beside the old one
    3. kill the worker, spawn the new file
    4. worker connects within 30s      → remember this version as good
       it does not                     → spawn the previous file again, mark this one broken

  The host learns nothing and changes nothing. A dropped link is not a new situation for it — it is the most exercised path in
  the whole system: containers over there keep running, the remote goes offline, the agent dials in again, running containers
  are adopted. An upgrade is just that path, on purpose, and one second long.

  What disappears: the upgrade token, two links on one remote, the pending phase, the two new HTTP endpoints, the READY
  protocol on the link, the version-negotiation call. What stays: a supervisor role in the same script, a state dir in $HOME,
  and one HTTP GET compared by content hash — no version endpoint needed either, since the file is the version.

  The worker needs no changes at all. Today's agent already connects, reports its version, and retries with backoff. The only
  thing I would add is one line in it: when serviceman accepts the link, process.send({ready: true}) if there is a channel —
  so the supervisor learns "it worked" from a fact rather than from parsing a log line.

  The honest cost: requests riding that link when the swap happens fail, and new ones get the offline answer for about a
  second. If that ever matters, the cheap fix later is one word from the worker — "I am going down" — so the host stops
  sending and waits for the running ones. One message, no tokens, no second link. Add it when you feel the pain, not before.


--- me ---

agent.js could work with 2 modes

1) as supervisor    node agent.js --token=xxx
2) as worker        node agent.js --worker-token=xxx

supervisor will request connect to the server, then request workder token;
with it it will spawn an agent which will start immediately as worker
