# Knowing whether a machine is there

**Push, not poll.** A machine's health is the machine's own to report: the agent beats every
few seconds and says goodbye, with a reason, when it stops or goes to sleep. The host does not
ask a fleet that is already talking — it asks only what has gone quiet, and calls a machine
gone only after a deadline no blink can reach. One event, one line in the log.

The pull that is left is a fallback, not the mechanism: it exists for the machine that stopped
pushing, and the only thing it decides is whether the silence is worth acting on.

It is the shape promtail has, not the one prometheus has. Prometheus is told where every
machine is and scrapes it, which needs a list of addresses, a route to each of them, and
something to keep that list true. Promtail dials out and pushes, and the server keeps no list
of where anything is. serviceman is the second kind for the same reason it was built that way
to begin with: a laptop behind NAT has no address worth writing down, and nothing on it should
have to listen.

## Why it changed

The first design was the other way round: the host pinged every machine every 30s, gave it 10s,
and dropped the link on a single unanswered ping. That is quick — a machine switched off is
noticed inside 40s — and it is thin. The same 10s of silence is a shutdown, a relay hiccup, a
suspended laptop, and a machine too busy to be scheduled. All four looked identical, and each
one cost the same three lines and a fleet of `lost` services.

Watched on 2026-08-28, with tailscale's own noise interleaved:

```text
[remote_ping_error] remote=phone reason="remote phone did not answer within 10s" link=dropped
[remote_offline]    remote=phone held="2m 9s"
[connection_end]    129.434s pending=0
magicsock: derp-4 does not know about peer [4292z], removing route      ← tailscaled, not us
```

Those two machines had been shut down, so the answer was right. The reasoning was not: nothing
in it knew the difference between a machine that left and a machine that went quiet.

## What the agent does

| It says          | When                                    | Carries        |
|------------------|-----------------------------------------|----------------|
| `beat`           | every 10s                               | nothing        |
| `stats`          | every 30s                               | the numbers    |
| `bye stopping`   | SIGTERM or SIGINT — a stop, a shutdown  | why it is going |
| `bye suspending` | logind says sleep is coming             | why it is going |

Beats are one small frame: the machine is the thing that knows it is alive, and saying so costs
it nothing. A goodbye is the important one — it turns a guess into a fact, and it is the only
way the host can tell a laptop closing its lid from a laptop falling off the network.

Suspend is heard from `systemd-logind`: `PrepareForSleep(true)` is broadcast before the machine
sleeps, and the agent watches for it with `gdbus monitor`. No logind, no gdbus, no line — the
machine simply never says it is sleeping, and the deadline below covers it.

Nothing is asked of a machine that has just woken. Its link is dead, it dials again, and the
host sees it come back.

## What the host does

| Silence     | What it means            | What the host does            |
|-------------|--------------------------|-------------------------------|
| under 25s   | the machine is talking   | nothing at all                |
| 25s to 60s  | it has gone quiet        | one ping, 10s to answer       |
| over 60s    | nothing is coming        | drop the link, say why        |
| a `bye`     | it said it was going     | drop it now, with the reason  |

Every frame is proof of life — a beat, a reply, a line of streamed output. The clock only looks
at what has been quiet, so a fleet of busy machines is a fleet nobody pings. A beat is answered
with a beat: the agent hangs up on a link that carries nothing from the host for 90s.

The throughput measurement keeps its own ten-minute clock. That one is a real transfer, and it
is not evidence of anything except speed.

## What the log says

One event, one line, with the reason in it:

```text
[remote_offline] remote=phone held=2m9s reason="it said it was shutting down"
[remote_offline] remote=desktop  held=4h1m  reason="nothing heard for 62s"
```

A failed ping is not an event. It is one round trip that did not come back, and the deadline is
what decides. Writing a line for it was writing down the working, not the answer.

## What it does not fix

**Tailscale's own noise.** `magicsock: derp-4 does not know about peer …` comes from tailscaled
in the same container, on the same stdout, in its own format. It belongs in its own file — the
entrypoint should send it there, and then serviceman's log is serviceman's.

**A machine that lies.** An agent wedged in a way that keeps beating but answers nothing is
online by this measure. The calls it fails to answer are the evidence, and they are the caller's
to report — a health check that asks nothing real is only a heartbeat with more steps.

**A host that dies.** The agent's own loop covers it: dial, drop, dial again, backing off to
30s. It does not need to know whether the host is down or unreachable; the answer is the same.
The one refusal it acts on is `serviceman-refused: removed`, which is the host saying this
machine is not part of it any more.
