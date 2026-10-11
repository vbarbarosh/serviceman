# Serving without serviceman

Status: the agent routes; built 2026-09-26. Started 2026-09-26.

## What is asked

> similar to logline service, echo.example.com -> authwall -> echo should be able to work
> even when serviceman is down; basically this is a new architecture of serviceman; it should be
> just a "management tool / configuratyion tool"

Logline already works this way: the machines send their lines to it themselves, and serviceman
only says where it is and hands out tokens. The same is wanted for traffic.

> similar how logline works!

> echo.example.com -> agent on laptop; 2. agent -> authwall (whatever it is); ONLY if autwall was
> accessible and confirmed request --> echo whatever echo service is; this is final setup;
> basically, agent should perform routing not serviceman;

## What was built

- **The door is the agent's.** `http.sock` is an http server of the agent, open for its whole
  life. Each request is routed by the machine's door table: the name's rule, the wall asked
  first — `/auth/sidecar`, a yes carries `X-Auth-User` on, a no is the sign-in redirect, a wall
  that cannot be asked is a 502 and nothing behind it is touched — then the service
  (`agent_door_answer.js`).
- **Services are found where they run** (`agent_service_target.js`): on this machine, a container
  by `docker port` (started first if it is stopped, which wakes a sleeping service without
  serviceman), a program by its port, an external service by its upstream; on another machine,
  through that machine's agent.
- **Agents reach each other over the tailnet** (`agent_peer_serve.js`): port 7303 on the
  machine's tailnet addresses, a token per machine from serviceman, only for the services that
  run there.
- **serviceman writes the tables** (`doors_table.js`, `doors_tell.js`): at each hello, after a
  config change, and each minute, only when the version differs. The agent keeps its table on
  disk (`doors/table.json`) and routes by it with serviceman down.
- **What a table cannot route goes to serviceman,** over a relay socket beside the door and the
  link, byte for byte as before — names it does not have, services serviceman answers itself.
- **Door traffic keeps services awake:** the agent reports how recently each of its services
  had a request, and serviceman counts it as activity.
- The **Doors** page shows, per machine, whether it routes by itself and holds the latest table.

Tested: `tests/door_route.test.js` — two agents, the wall and the service on the other machine,
the redirect, the wall's own pages, a forged `X-Auth-User` dropped, then serviceman shut down
and the door still serving, then the wall gone and nothing behind it touched.

Where each machine's agent listens for its peers is kept in `data/door_peers.json`, so a
serviceman that starts again writes a machine that has not dialled in yet into its peers' tables
as before. Not yet: a container that never existed still needs serviceman to make it.

## The direction: the Logline way

Asked what to settle first, the answer was the model Logline already follows. Laid over
traffic, that is:

| Logline | Traffic through a door |
|---|---|
| Deployed on its own — its compose file, `restart: unless-stopped` — and up whether serviceman is or not | `authwall` and `echo` run on their machines as containers docker keeps up, whether serviceman is or not |
| Published on its machine's tailnet address, port 3000 | Each published on its machine's tailnet address |
| serviceman tells each machine the endpoint and a token, once | serviceman tells each machine the names its door answers, the service behind each (its tailnet address) and the wall in front (its address) |
| The machine keeps that on its own disk (`logline/settings.json`) and goes on without serviceman | The machine keeps its door table on its own disk and goes on without serviceman |
| The machine POSTs its lines straight to Logline | The door carries each request straight to the wall, then to the service |
| serviceman shows how the sending goes | serviceman shows what each machine serves and whether it has the latest table |

Read this way, the decisions below come out as: D1 yes; D2 is neither (a) nor (b) as written —
the door goes straight to the service's own tailnet address, with no agent on the far side in the
way; D3 is "kept up by docker", not woken on demand; D4 yes, the wall at its own address. D5,
D7 and D8 stand. D6 stands as recommended: serviceman's own addresses stay its own.

## How a request goes today

`echo.example.com`, a door name on `laptop`, answered by `echo` on `server`, behind `authwall`
on `server`:

1. The visitor reaches the web server on `laptop`, which hands the request to `http.sock`, the door
   of `laptop`'s agent.
2. The agent carries it over its link to serviceman. The door stands only while the link does
   (`agent_http_serve.js`): with serviceman away, the web server gets a refused connection and
   answers 502.
3. serviceman looks the name up in `laptop`'s rules (`inbound_rule.js`), and asks `authwall`
   `/auth/sidecar` — over `server`'s link.
4. On a yes, serviceman makes sure `echo` is running — starting its container on `server` if
   it sleeps (`service_ensure_running.js`) — and carries the request to it over `server`'s
   link, and the answer back the way it came.
5. After ten idle minutes serviceman stops `echo` again (`reap_idle.js`).

serviceman is in every step but the first. Down, nothing behind a door answers, and nothing
that sleeps wakes.

## What has to move to the agents

- The rules: which names this machine's door answers, for which service, behind which wall.
- The way to each service: where it runs, and how to reach it from here.
- The asking of the wall.
- Starting a service on its first request, stopping it when idle, starting it again when it
  stops badly — for the services on this machine.
- A copy of all of that on the machine's own disk, so a machine that restarts while serviceman
  is away still knows what it serves.

What stays with serviceman: the config and the page that edits it; telling each machine its
part; showing how everything stands; Logline's tokens; pulls, updates, shells, files — all the
asking a person does.

## Decisions

Each has a recommendation; none is taken yet.

**D1. Each agent keeps its own table and serves from it.** serviceman writes each machine the
part of the config it needs — its door names, its services, the walls in front of them — and the
agent keeps it on disk and serves from it, with or without a link. A change made on the page
reaches the machine the next time it is connected, and the page says which machines have it and
which do not yet.
*Recommended.*

**D2. A door name and its service on different machines.** Your case: the door is `laptop`'s,
`echo` and `authwall` run on `server`. Without serviceman, `laptop` has to reach `server` itself.
- (a) A door name may only name a service on the same machine. To serve `echo` from `laptop`'s
  door, `echo` runs on `laptop`. Simplest; nothing crosses between machines.
- (b) Agents reach each other directly over the tailnet: `server`'s agent listens on its
  tailnet address for its peers, with a token serviceman gives each pair, and `laptop`'s agent
  carries the request there.
- (c) Same machine is served without serviceman; a door name on another machine keeps going
  through serviceman, and so stops when it does.

*Recommended: (a) first — it is what makes your case work soonest, by pointing the door name
at `server`'s door, or by running `echo` and `authwall` on `laptop` — and (b) after it.*

**D3. Who starts and stops services: the agent of the machine they run on.** From the
definitions serviceman wrote: start on the first request, stop after the idle time, restart on
failure. serviceman stops deciding any of it, and shows what the agents report. Without this, a
service asleep when serviceman goes down cannot be woken.
*Recommended.*

**D4. The wall is asked by the agent,** the same way serviceman asks it today — `/auth/sidecar`,
`X-Auth-User` on a yes, `/auth/sign-in` on a no — so authwall does not change. The wall is
reached the way D2 settles: on the same machine under (a).
*Recommended.*

**D5. What the machine serves is versioned.** Every table serviceman writes carries a number;
the agent says which one it serves. The page shows "applied" or "waiting for laptop", and a machine
never serves half of a change.
*Recommended.*

**D6. serviceman's own addresses.** Names serviceman answers at its own port (`echo.localhost`
today) need serviceman up, by definition. Two ways out:
- (a) They stay as they are — a management tool may have a few addresses of its own, and
  anything that must outlive serviceman is given a door name instead.
- (b) The machine serviceman runs on gets an agent like any other, and serviceman's port stops
  serving services at all.

*Recommended: (a) now, (b) when the rest is done.*

**D7. Copies and machines chosen by tag.** Several copies of a service, a pool, a service on
"any `#gpu` machine": placement across machines needs somebody who sees them all. serviceman
decides placement when it is up and writes it into the machines' tables; without it, each
machine keeps serving what it was last told, and nothing moves.
*Recommended.*

**D8. The request lines are the agent's.** `request_begin` and `request_end` for traffic
through a door are written by the agent that served it, and reach Logline with the rest of that
machine's lines.
*Recommended.*

## Order of work

The Logline way, in the order it pays off:

1. **Services that stay up.** A docker service can be marked to live without serviceman: its
   container is made with `--restart unless-stopped` and publishes its port on its machine's
   tailnet address as well, and serviceman does not stop it when idle.
2. **The door table.** serviceman writes each machine its door names, each with the tailnet
   address of the service behind it and of the wall in front; the agent keeps it on disk and the
   page shows which machines have the latest one.
3. **The door serves from the table,** straight to those addresses, asking the wall first — with
   the link up or not. `echo.example.com` → `authwall` → `echo` then works with serviceman
   down.

The phases below were written before the direction was chosen, and stay for reference.

0. This note, and your answers to D2, D3 and D6.
1. **One machine, on its own.** An agent serves its door from its own table: services on the
   same machine, the wall on the same machine, start on demand and stop when idle. serviceman
   writes the table and shows what each machine applied. `echo.example.com` → `authwall` →
   `echo` then works with serviceman down, once the name, `authwall` and `echo` are on one
   machine.
2. **Between machines** (D2 b): agents reach each other over the tailnet.
3. **serviceman as a management tool only** (D6 b): its own machine runs an agent, and
   serviceman serves nothing itself.

## Open questions

- Is a wall always on the same machine as what it guards, or is one `authwall` meant to stand in
  front of services on several machines?
- Should a machine that lost serviceman keep serving its table forever, or stop after some time
  unconfirmed?
- Services that run on serviceman's own machine today (`this host`): do they matter without
  serviceman, or are they the ones allowed to go down with it?
