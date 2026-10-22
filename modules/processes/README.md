# processes

Everything running on one machine, for a web page: every process as the tree it is, each
under the one that started it, with its user, CPU, memory, how long it has run and its state. A
branch folds away, Fold all leaves the roots, a filter keeps every match in its place in the
tree, and Top CPU and Top memory put the heaviest first. A command too long for its row reads
whole when the row opens.

It has two halves and knows nothing of where the machine is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler that asks the host to **read** the list. The host gives the read, mounts the handler at
the base, and decides who may ask.

serviceman is the first host: its Processes tab of a machine is this component, and the read is
`ps` run over there by the machine's agent.

## Layout

    server/processes_serve.js     the HTTP API, given read()
    ui/processes.js               the component
    ui/processes.css              the component's rules
    tests/processes_serve.test.js the API over a fake read

## Read when asked

The list is read when the component opens and when Read again is pressed, never on a clock: a
table this long, read again every second, would be a machine talking about itself all day, and
a tree that moves under the hand is one nobody can read. The folds are kept, by pid, across a
read that brings the same tree back.

## The API

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/processes`.

| Door | What it does |
|---|---|
| `GET <base>` | what the host's `read()` answers, below |

    {at, cpu_window_ms, commands: ['ps -eo …'],
     items: [{pid, ppid, user, cpu, mem, rss, elapsed_ms, state, command}]}

- `cpu` is the share of one core over the last `cpu_window_ms`, as top shows it: 100 is a whole
  core. `cpu_window_ms: null` says it is what ps prints, each process's average over its life.
- `mem` is the share of the machine's memory, `rss` bytes, `state` ps's STAT.
- `commands` are what was run, for the page's copy button; without them there is none.
- **Refusals:** a read that throws is a 502 with its message, or the status the error carries;
  any other door or method is a 404.

## Plugging it into a host

    const processes_serve = require('../modules/processes/server/processes_serve');

    // every request under /processes goes to the module; the host checks who may ask first
    await processes_serve(req, res, {
        read: () => ask_the_machine('proc_list'),   // -> {at, cpu_window_ms, items, commands}
        tail: '',                                    // the address after the base
    });

The page half: the host serves `ui/` and maps it in its import map:

    <link rel="stylesheet" href="/modules/processes/processes.css">
    {"imports": {"processes/": "/modules/processes/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import processes from 'processes/processes.js';

    <processes base="/processes" :offline="false" :cores="4" :connected_at="1761164000000"/>

`cores` is how many the machine has: the processes' CPU together is a share of them all.
`connected_at` changes each time the machine dials back in, and a read that failed while it was
away is read again then. `offline` greys Read again.

The host page gives the colours, as `--panel`, `--line`, `--fg` and `--accent`, and the classes
the component shares with it: `seg`, `load`, `meter`, `muted`, `bad`; its table is the page's
`data_table.js` and its copy button the page's `command_copy.js`, imported from beside it.

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/processes…` to
  `processes_serve`, after its own refusals: no such machine, not connected, an agent from
  before the process list; its `read()` is the agent's `proc_list`
- the agent's `proc_list` (`src/agent/src/agent_proc_list.js`) runs ps as the agent's own user,
  and measures CPU from `/proc` over half a second
- `src/main/public/remote_processes.js` is the Processes tab, which wraps the component and says
  why there is no list for a machine not seen yet or an agent older than it

## Tests

    node --test modules/processes/tests/*.test.js
