# firewall

What one machine listens on and what its firewall, ufw, lets through, for a web page. First the
ports, each with how far its address reaches and what the firewall does to it, **Allow** or
**Close** from its row; then ufw's rules, on or off, its defaults, a row to add one, and × to
delete one with Undo. A change shows at once, marked while the machine makes it.

It has two halves and knows nothing of where the machine is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler that asks the host for two things: to **run ufw** with a list of words, as root, on the
machine, and for the **ports** it listens on. The host gives those, mounts the handler at the
base, and decides who may ask.

serviceman is the first host: its Remote page has a Firewall tab (which took in the Ports tab
there was), ufw runs in the machine's root half, or with `sudo -n` where it has none, and the
ports are the list its agent reads with `ss`.

## Layout

    server/firewall_serve.js      the HTTP API, given run(argv) and ports()
    ui/firewall.js                the component
    ui/firewall_ports.js          the ports as rows: how far each reaches, what the firewall does
    ui/firewall.css               the component's rules
    tests/firewall_serve.test.js  the API over a fake ufw, or a real one (below)
    tests/firewall_ports.test.js  what each kind of port and rule comes to
    tests/fake_ufw.js             ufw as far as the module asks it, saying what ufw 0.36 says

## The rules are the ones ufw lists as added

`ufw status` lists no rules while the firewall is off, and every rule twice (v4 and v6) while it
is on. The module reads `ufw show added` instead: one line a rule, each the command that made it,
the same on as off. So a rule is deleted by what it is (`ufw delete allow 22/tcp`), never by a
number that moves under it, and Undo is the same command again, at its old place
(`ufw insert <n> …`), since the first rule that matches is the one ufw goes by.

## The API

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/firewall`.
Every answer about the firewall that succeeds is the firewall as it is now:

    {installed, active, defaults: {incoming, outgoing, routed} or null while off, logging,
     ssh_open, rules: [{command, action, direction, port, proto, from, to, on, app, comment}]}

| Door | What it does |
|---|---|
| `GET <base>` | the firewall; `installed: false` on a machine without ufw |
| `GET <base>/ports` | what the host's `ports()` answers: `{items: [{proto, address, port, state, users: [{name, pid}]}], commands}`; 501 without one |
| `POST <base>/rules` `{action, direction, port, proto, from, comment}` | a rule from the form, added last |
| `POST <base>/rules` `{command, at}` | a rule as the list gave it, put back at its place: Undo |
| `POST <base>/rules/delete` `{command}` | one rule of the list gone; answers `undo: {command, at}` |
| `POST <base>/enable` | on (`ufw --force enable`: ufw's question about ssh answered ahead) |
| `POST <base>/disable` | off; the rules are kept |

- **The form:** `action` is allow, deny, reject or limit; `direction` in or out; `port` a
  number, a range (`8000:8100`) or a list (`80,443`); `proto` tcp, udp or any (a range or a list
  needs one of the first two); `from` an address or a network, empty for anywhere; `comment`
  one line, no `'`. It is checked before ufw is asked: a 400 says what is wrong.
- **ssh_open** says whether a rule lets ssh (22) in; the page warns before the firewall is
  turned on without one.
- **Refusals:** a rule ufw has already, or one that is gone from the list since the page read
  it, is a 409. ufw that cannot be run, or a sudo that wants a password, is a 502 that says so.

## What a port comes to

`ui/firewall_ports.js` makes the rows the page shows, from the ports, the machine's own
addresses and the firewall:

- **One row per port and holder:** v4 and v6 of one program are one row, as exposed as the most
  exposed of its addresses; the most exposed come first.
- **How far its address reaches:** the internet (a public address, or every address of a
  machine that has a public one), a network (private, link-local, the tailnet's
  `100.64.0.0/10`, a multicast group or a broadcast), or this machine only (loopback).
- **What the firewall does:** the first rule for the port (its protocol or both, the port in
  its list or range, a rule for every port, ssh by name for 22) that holds for everyone decides,
  as ufw goes by the first match; rules for one source are said beside it; with none, the
  default (deny while ufw is off, since its status does not say). While the firewall is off the
  row says what it will be once on.
- **Close** is offered only where the rule that lets a port in is about that port alone; a range,
  a service by name or the default is changed in the rules.

## Plugging it into a host

    const firewall_serve = require('../modules/firewall/server/firewall_serve');

    // every request under /firewall goes to the module; the host checks who may ask first
    await firewall_serve(req, res, {
        run: argv => run_as_root(['ufw'].concat(argv)),    // -> {ok, code, stdout, stderr}
        ports: () => listening_ports(),                     // -> {items, commands}
        tail: '/rules',                                     // the address after the base
        log: function (event, fields) {
        },
    });

The page half: the host serves `ui/` and maps it in its import map:

    <link rel="stylesheet" href="/modules/firewall/firewall.css">
    {"imports": {"firewall/": "/modules/firewall/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import firewall from 'firewall/firewall.js';

    <firewall base="/firewall" :offline="false" :addresses="['203.0.113.7']"/>

`addresses` are the machine's own, for how far a port on every address reaches; without them
such a port is taken for open to the internet.

The host page gives the colours, as `--panel`, `--line`, `--muted`, `--fg` and `--accent`, and
the classes the component shares with it: `card`, `list-head`, `list-acts`, `list-table`, `dot`,
`muted`, `bad`, `primary`, `link`, `pill`, `chip`, and `--run`, `--busy`, `--bad` for the
colours of open, warned and kept out.

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/firewall…` to
  `firewall_serve`, after its own refusals: no such machine, not connected, an agent from before
  the firewall; its `ports()` is the agent's `port_list`, asked of the root half where there is
  one so every holder is named
- the agent's `ufw` call (`src/agent/src/agent_ufw.js`) runs ufw with the words given, only its
  own subcommands (status, show, allow, deny, reject, limit, delete, insert, enable, disable),
  with no shell between: in the root half where the machine has one, else as `sudo -n ufw`, so
  a sudoers line may name ufw and nothing else; `--ufw` (`SERVICEMAN_UFW`) names another ufw; a
  root half older than this says it is updating rather than falling back to sudo
- `src/main/public/remote_firewall.js` is the Firewall tab, which wraps the component and gives
  it the machine's addresses; an old `/remotes/<name>/ports` address opens it

## Tests

    node --test modules/firewall/tests/*.test.js

Against a real ufw, which they reset: as root, in a container that may change its firewall,

    podman run --rm --cap-add NET_ADMIN --cap-add NET_RAW -e UFW=ufw -v $PWD:/app:ro alpine \
        sh -c 'apk add ufw nodejs && node --test /app/modules/firewall/tests/firewall_serve.test.js'
