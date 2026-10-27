# The log

Every line has one shape. The rules are not ours — they are the house rules at
[vbarbarosh/rules](https://github.com/vbarbarosh/rules/blob/main/drafts/logs.md),
and that file is the source of truth; this one says how serviceman follows them.

    [2026-08-21T10:55:23.021Z][c8pox602ru6x][service_start_begin] service=whoami instance=1 type=docker of=["vps1"]

- **the time**, its own field, UTC to the millisecond
- **the group_uid**, a uid of its own: a `c` and eleven letters and digits
- **the sender**, the one place in the code that writes this line
- **the details**, terse and human first, as `key=value`

Three fields and nothing else. How long it took, what it answered and every
other measurement is part of the details.

The time is written to the file, always — a file says nothing else about when a
line was written. A runtime that stamps every line itself, as docker does, does
not need it: `SERVICEMAN_LOG_TIME=off` leaves it off stdout, and the file keeps
it either way.

There is no second, quieter log: every line goes to the daily file and to stdout.
Reading them — searching, following a uid, walking up `parent=` — is Logline's
job, not the control page's: see [Logline](config.md#logline).

## What a value looks like

A value stands bare when it is a plain word — printable ASCII, no space, no
quote, no backslash, no square bracket — so what is in the file is exactly what
was sent, and it can neither run into the next word nor mint a `[tag]` of its
own. Everything else is JSON:

    reason="idle for 4s"        a value with spaces
    text="two\nlines"           a line break, escaped, never written raw
    note=""                     an empty value, still visible
    of=["vps1","vps2"]          a list keeps its shape
    ok=true                     true, false and numbers as they are

A key with nothing behind it is left out rather than written as `null`.

A line is kept under 2k bytes. What does not fit is cut on a character — never
inside a utf-8 sequence — and ends with the bytes left out: `...+4821`. The log
describes an event; it is not payload storage.

## How long it took

A measurement of a piece of work is written in seconds, to the millisecond, the
way the rules write it: `0.008s`, `4.512s`, `30.001s`. That is `request_end`,
`connection_end`, `socket_end_ok`, the `took=` of a start, the `in=` of a
restart that waits, and the `waiting=` of a start that is slow.

Two things keep another shape on purpose. A **human span** — how long a link
held, how long a service has been idle — stays as `4h 2m`, because
`14520.000s` says the same thing and nobody reads it. And **latency** stays in
milliseconds: `0.001s` hides exactly the difference that number exists to
show.

## The laws

1. **One line, three fields.** `[time][group_uid][sender] details` — nothing else. How long it
   took and what it answered belong to the details.
2. **The time is UTC, to the millisecond**, and it is its own field. The file always carries
   it; a runtime that stamps every line itself does not need it.
3. **A sender names the one place in the code that writes it.** Exactly one.
4. **Senders come in complements.** `_begin` is answered by `_end_ok` or `_end_error`, with
   `_tick` or `_progress` in between. A begin with no end means the work never finished —
   which is itself the finding.
5. **The tag holds a uid, not a time.** A uid is twelve characters — a `c` and eleven letters
   and digits, `c8pox602ru6x` — so it is one word to a terminal, a double click takes all of
   it, and it can never be read as a number. Nothing reads a uid, things only match it.
6. **Every group has a uid of its own.** No two are alike, so a tag names one piece of work and
   nothing else.
7. **`group_spawn` is the first line of a group** and names the group it came from. Only one
   group names no parent: the process.
8. **A group is written when it speaks.** The `group_spawn` line comes with the group's first
   real line, so a group that had nothing to say leaves nothing behind, and no uid is ever
   mentioned before it is explained.
9. **A value stands bare when it is a plain word**, and is JSON otherwise.
10. **A line stays under 2k bytes**, cut on a character, ending with the bytes left out.
11. **Nothing secret is ever written**: no tokens — not even a wrong one somebody tried — no
    query values, no bodies, no headers.

## One sender, one place

A sender is written from exactly one line of code, so the log and the source
point at each other:

    grep -rn service_start_end_error src/     # the one line that writes it
    grep service_start_end_error data/logs/*  # every time it ever happened

When two situations deserve two lines they get two senders — never one sender written twice.
Where several causes truly share a line, they share one function too: `remote_link_error` has
five reasons and one home.

Senders come in complements: `_begin` is answered by `_end_ok` or `_end_error`. A begin with no
end means that work never finished, which is worth knowing on its own.

## Traces

The first line of every group is `group_spawn`, and it names the group it came from. **Every
group has a parent, and there is exactly one group with none: the process.** serviceman writes
that one when it starts, and every uid in the file walks up to it.

**Coming up.** The boot group is the trunk of the file: every other group in the run below is a
child of it. The service that must always run is started under it, because the boot is what
asked:

    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_begin] config=/srv/serviceman.json services=3 remotes=1
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_listen] address=127.0.0.1:3400
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_route] host=["whoami.test"] service=whoami type=docker remotes=["vps1"] policy="on demand, sleeps after 2s idle"
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_route] host=["term.test"] service=term type=external remotes=[] policy="always on"
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_route] host=[] service=faller type=shell remotes=["vps1"] policy="always on, restart always"
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_control] host=serviceman.localhost address=127.0.0.1:3401
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_remote] remote=vps1 door="/api/v1/remote, with its token"
    [2026-08-21T10:55:21.071Z][cuj0e3pihkge][serviceman_log] dir=/tmp/claude-1000/-app/1be41a0a-a245-47cb-af28-f5d9e67993ac/scratchpad/demo5/logs
    [2026-08-21T10:55:21.096Z][c3n3yun6pjvg][group_spawn] parent=cuj0e3pihkge
    [2026-08-21T10:55:21.096Z][c3n3yun6pjvg][service_start_begin] service=faller instance=1 type=shell of=["vps1"]

**A visit to a sleeping service**, from the connection to the answer:

    [2026-08-21T10:55:23.020Z][cig5eushuucv][connection_begin] 127.0.0.1:45140
    [2026-08-21T10:55:23.021Z][cqhldlq3xclh][group_spawn] parent=cig5eushuucv
    [2026-08-21T10:55:23.021Z][cqhldlq3xclh][request_begin] GET /hello?token=*** {"from":"","host":"whoami.test","ip":"127.0.0.1"}
    [2026-08-21T10:55:23.021Z][c8pox602ru6x][group_spawn] parent=cqhldlq3xclh
    [2026-08-21T10:55:23.021Z][c8pox602ru6x][service_start_begin] service=whoami instance=1 type=docker of=["vps1"]
    [2026-08-21T10:55:23.021Z][c8pox602ru6x][remote_reserved] service=whoami instance=1 remote=vps1 of=["vps1"]
    [2026-08-21T10:55:23.046Z][c8pox602ru6x][docker_run] service=whoami image=demo/whoami remote=vps1
    [2026-08-21T10:55:23.109Z][c8pox602ru6x][service_start_end_ok] service=whoami instance=1 remote=vps1 upstream=127.0.0.1:35671 inside=8080 answered=200 took=0.088s
    [2026-08-21T10:55:23.112Z][cqhldlq3xclh][request_end] 200 0.091s whoami#1
    [2026-08-21T10:55:23.113Z][cig5eushuucv][connection_end] 0.093s pending=0

Four steps, and each one names the step above it: the container was started **because** a
visitor asked for a page, **on** a connection they opened, **against** this process — which is
`cuj0e3pihkge`, the group of the boot.

The status of the answer already says what happened, so the end of a request is neither an ok
nor an error: `request_end` carries the status, how long it took and the copy that answered,
and `cut_off` stands where the status would be when the visitor left before the answer.
`pending=` on `connection_end` is what was still unfinished on that connection when it closed.

A group may also say it is finished — `group_exit`, which the rules leave optional and
serviceman does not write. Its absence claims nothing; `connection_end` and every `_end_ok`
already say when a piece of work is over.

A tag is one word — a `c` and then letters and digits, nothing in it to break a double click
— so reading the log is a click and a paste:

    grep c8pox602ru6x data/logs/20260821.log   # what that piece of work did
    grep parent=cqhldlq3xclh data/logs/*.log   # everything the request set off
    grep parent=cig5eushuucv data/logs/*.log   # everything that client asked for
    grep docker_run data/logs/*.log            # every container this host ever started
    grep service_start_end_error data/logs/*   # every start that failed, ever
    grep -rn service_start_end_error src/      # the one line of code that writes it

**A browser is not one connection.** It opens several and spreads a page over them, so the
connection does not say which page a script belongs to. The `from` of a request does: it is the
referer, with its query values dropped, and it is empty when a visitor came on their own.

    [2026-08-21T10:55:23.122Z][cb1slkdxrw4e][request_begin] GET /style.css {"from":"http://site.test/","host":"site.test","ip":"127.0.0.1"}
    [2026-08-21T10:55:23.122Z][cb1slkdxrw4e][request_end] 404 0.000s site

What a **timer** causes — a service put to sleep, a remote measured — is a child of the process
group, not of the request that happened to be in flight when the clock struck:

    [2026-08-21T10:55:26.098Z][c2vkwxjpklx9][service_stop_begin] service=whoami instance=1 reason="idle for 3s"
    [2026-08-21T10:55:26.121Z][c2vkwxjpklx9][service_stop_end_ok] service=whoami instance=1

**A program that keeps dying** makes each restart a child of the start it retries, so the chain
says how it got here and the backoff is on the line:

    [2026-08-21T10:55:24.741Z][ce8rw66iyfme][group_spawn] parent=copebmomon3h
    [2026-08-21T10:55:24.741Z][ce8rw66iyfme][service_start_begin] service=faller instance=1 type=shell of=["vps1"]
    [2026-08-21T10:55:24.741Z][ce8rw66iyfme][remote_reserved] service=faller instance=1 remote=vps1 of=["vps1"]
    [2026-08-21T10:55:24.742Z][ce8rw66iyfme][program_begin] service=faller argv="/bin/sh -c node -e 'setTimeout(function () { process.exit(3); }, 300);'"
    [2026-08-21T10:55:24.742Z][ce8rw66iyfme][service_start_end_ok] service=faller instance=1 remote=vps1 took=0.001s
    [2026-08-21T10:55:25.063Z][ce8rw66iyfme][program_end] service=faller how="code 3"
    [2026-08-21T10:55:25.064Z][ce8rw66iyfme][program_restart_wait] service=faller in=4.000s restart=3

**A stranger at the door of a remote.** The address and the reason are kept; the token they
tried is not:

    [2026-08-21T10:55:23.154Z][c1847u2jmc0t][connection_begin] 127.0.0.1:35780
    [2026-08-21T10:55:23.155Z][cv6jqwrvnzwz][group_spawn] parent=c1847u2jmc0t
    [2026-08-21T10:55:23.155Z][cv6jqwrvnzwz][remote_refused] from=127.0.0.1 reason=unknown_token

**Going down.** The programs it started are stopped, the containers are left running, and the
file is flushed before the process leaves — so the last lines are always there:

    [2026-08-21T10:55:27.163Z][cvnuyjizo92h][group_spawn] parent=cuj0e3pihkge
    [2026-08-21T10:55:27.163Z][c7bx3pwfsgr7][group_spawn] parent=cvnuyjizo92h
    [2026-08-21T10:55:27.163Z][c7bx3pwfsgr7][service_stop_begin] service=faller instance=1 reason="serviceman stops"
    [2026-08-21T10:55:27.163Z][c7bx3pwfsgr7][service_stop_end_ok] service=faller instance=1
    [2026-08-21T10:55:27.163Z][cvnuyjizo92h][serviceman_end_ok] signal=SIGTERM containers="left running"

All of it is one run, copied out of the daily file as it was written; only the path of the
config is shortened, because the real one was a scratch folder.

## The senders

### The process

| Sender                   | What it says                                                  |
|--------------------------|---------------------------------------------------------------|
| `serviceman_begin`       | The config it read, and how much is in it.                    |
| `serviceman_listen`      | The address the services are served on.                       |
| `serviceman_control`     | The hostname and the port of the control page.                |
| `remote_dropped`         | A link the host let go on purpose — a changed or removed machine — after telling the agent. |
| `serviceman_route`       | One service: its address, its kind, its policy.               |
| `serviceman_remote`      | One remote, and the door its agent dials.                     |
| `serviceman_log`         | Where these lines are written.                                |
| `serviceman_tag_nowhere` | A service asks for a tag nothing carries yet.                 |
| `serviceman_closed`      | The control page answers this machine only.                   |
| `serviceman_exposed`     | `control.exposed` is on, and what that means.                 |
| `serviceman_error`       | serviceman broke on a request; the reason is in the words.    |
| `serviceman_end_ok`      | It stopped on a signal, and the containers were left running. |
| `serviceman_end_error`   | A program would not stop; it left anyway, and says why.       |
| `group_spawn`            | A group began, and the group it came from.                    |

### Visitors

| Sender             | What it says                                                                |
|--------------------|-----------------------------------------------------------------------------|
| `connection_begin` | A client opened a connection; every request on it is a child of this group. |
| `connection_end`   | It closed, how long it was held, and what was still unfinished on it.       |
| `request_begin`    | The method and the path, then who asked and which page sent them.           |
| `request_end`      | The status, how long it took, and the copy that answered.                   |
| `request_wait`     | The start was slow, so the waiting page was shown.                          |
| `request_timeout`  | No answer within `request_timeout`.                                         |
| `upstream_error`   | The service was reached and did not answer, with a hint.                    |
| `socket_begin`     | A websocket was joined to a copy of a service.                              |
| `socket_end_ok`    | It closed, how long it was held, and by which copy.                         |
| `socket_end_error` | It never got that far.                                                      |

### Services

| Sender                    | What it says                                                |
|---------------------------|-------------------------------------------------------------|
| `service_start_begin`     | An instance is starting, and on what.                       |
| `service_start_end_ok`    | Where it answers now, and how long it took.                 |
| `service_start_end_error` | Why it did not start.                                       |
| `service_start_retry`     | A machine would not take it, so the next one is tried.      |
| `service_start_slow`      | It has been waited for over ten seconds, and what it does.  |
| `service_stop_begin`      | An instance is stopping, and why.                           |
| `service_stop_end_ok`     | It stopped.                                                 |
| `service_stop_end_error`  | It would not stop.                                          |
| `service_adopt_ok`        | It was already running and was kept, not started twice.     |
| `program_killed`          | A program was asked to stop, did not, and was killed.       |
| `container_killed`        | A container took its whole stop timeout, so docker killed it. |
| `secret_written`          | A secret was kept, by name. Never the value.                |
| `secret_removed`          | A secret was taken away.                                    |
| `service_gave_up`         | It failed to start too many times in a row; it is left alone. |
| `service_try_again`       | Something changed, so the count starts over.                |
| `service_scale_up`        | Another copy was warmed: the queue, or the pool being busy. |
| `service_scale_down`      | A copy was stopped: the pool is bigger than the work.       |
| `service_replace_begin`   | An app folder takes the new version sent to `<folder>.new`, and what it was doing. |
| `service_replace_end_ok`  | The new version is in and started; `data_dropped` when it brought a `data/` of its own, set aside. |
| `service_replace_end_error` | What refused or failed: nothing waiting, a `.old` left, `bin/configure` or `bin/build`. |
| `service_zip_begin`       | A new version came as a zip, by `PUT`, and how big.         |
| `service_zip_end_ok`      | Its files went to the machine and the replace is done: how many, their bytes, and the files of its own `data/` left out. |
| `service_zip_end_error`   | Why not: no app in the zip, a token that does not see the machine, or what the replace said. |
| `image_pull_begin`        | An image is missing on a machine and is being fetched.      |
| `image_pull_end_ok`       | It is there now, and how long it took.                      |
| `image_pull_end_error`    | It could not be fetched; the first visitor will try again.  |
| `image_pull_error`        | The pre-pull itself broke, before any image.                |
| `docker_pull_no_pty`      | That machine has no `script`, so the download shows no progress. |
| `docker_stdout`           | A line docker printed, as it printed it.                    |
| `docker_stderr`           | The same, from its error output.                            |
| `docker_run`              | A container was created.                                    |
| `docker_start`            | A container that already existed was started again.         |
| `docker_recreate`         | The definition changed, so the container was replaced.      |
| `volume_create`           | A folder was made for a bind mount, on the remote.          |
| `program_step_begin`      | A lifecycle line is running: `step=install`, `stop`, …      |
| `program_step_end_ok`     | It finished, and how long it took.                          |
| `program_step_end_error`  | It failed, and what it said.                                |
| `program_folder_removed`  | The folder serviceman made for a program went with it.      |
| `program_begin`           | A `shell` service was run, with its command line.           |
| `program_stdout`          | A line the program printed, as it printed it.               |
| `program_stderr`          | And a line on the other stream.                             |
| `program_end`             | It stopped by itself, and how.                              |
| `program_restart_wait`    | The restart policy is waiting before trying again.          |

### The agent

The agent on a remote machine writes the same shape of line, with a group for every attempt to
reach the host — so one dial-in reads as one story on both ends. `SERVICEMAN_LOG_DIR` gives it
daily files of its own — `logs/agent/20260823.txt` beside the agent, because a machine kept up
by systemd has nobody watching its stdout; an agent before 1.20 wrote `logs/20260823.log`, and
moves those days in there when it starts. Its `status` file says what it is doing right now.

    [2026-08-23T00:05:29.424Z][ce0b2bi6rr4b][agent_begin] agent=1.0.0 built=2026-08-22T23:04:46.633Z node=v24.14.1 machine=laptop url=http://serviceman:3001
    [2026-08-23T00:05:29.426Z][cqylf7b4xvwt][agent_connect_begin] url=http://serviceman:3001
    [2026-08-23T00:05:29.431Z][cqylf7b4xvwt][agent_connect_end_ok] remote=laptop
    [2026-08-23T00:05:29.435Z][cqylf7b4xvwt][agent_call_ok] method=program_probe service=writer slot=1 running=false took=0.000s
    [2026-08-23T00:05:32.407Z][cq2i4qoqyokf][group_spawn] parent=cqylf7b4xvwt
    [2026-08-23T00:05:32.407Z][cq2i4qoqyokf][agent_call_begin] method=program_install cwd=serviceman/writer line="git clone … && npm install"
    [2026-08-23T00:05:41.412Z][cq2i4qoqyokf][agent_call_end_ok] method=program_install step=install took=9.005s

**An `_end` line begins with the time it took, and then only what is new.** `0.160s`, and
after it whatever the line that began the work did not already say. The method, the machine,
the command and the folder are one line up under the same uid; repeating them says nothing:

    [c1a2f5fiub6u][agent_call_begin] remote=laptop method=docker argv="image inspect vbarbarosh/notes"
    [c1a2f5fiub6u][agent_call_end_ok] 0.160s

**A line of output is written as it was printed, and nothing else.** `agent_call_stdout`,
`program_stdout` and their stderr twins carry the command's own line, with no `key=` around it
and no `method=` or `remote=` repeated on every one of them: the sender says which stream it
is, the group says which work it belongs to, and the line above it already said the rest.

**A group is worth making when more than one line will hang in it.** The end of the process is
written in the group its start is in; a control request is written in the group of the
connection it came in on; what those cause gets groups of its own, because that is where the
lines are. A group holding a single line is a uid that never appears twice, which is a line
number with extra steps — and it costs two lines to say what one line already said.

**A group is for work worth following, not for every call.** Something that takes seconds — a
docker pull, an install line, a shell line somebody wrote — gets a group under the link and is
bracketed, so a reader sees it start and knows what is being waited for. Everything that is
over before the next line is written takes one line, in the link's own group. A group made for
a single call is a uid that never appears twice, which is no group at all.

`ping`, `stats` and `resources` are left out entirely — the host asks for those every half
minute, and they would bury the rest.

| Sender                    | What it says                                                |
|---------------------------|-------------------------------------------------------------|
| `agent_begin`             | What this agent is: version, build, node, machine, host.    |
| `agent_connect_begin`     | It is dialling the host.                                    |
| `agent_connect_end_ok`    | The host took it, and which remote it is.                   |
| `agent_token_own`         | Joined, the host handed it a token of its own, kept beside the agent. |
| `agent_token_unknown`     | The host does not know the kept token: the next dial is with the one the agent was started with. |
| `agent_connect_end_error` | The host could not be reached, and why.                     |
| `agent_connect_wait`      | How long before it tries again.                             |
| `agent_link_end`          | The link closed, and how long it held.                      |
| `agent_link_error`        | The link failed while it was up.                            |
| `agent_call_ok`           | Something the host asked for is done, in one line.          |
|                           | A sender that says ok never carries `ok=true` beside it.    |
| `agent_call_error`        | It failed here, and why.                                    |
| `agent_call_begin`        | Slow work — a pull, an install, a shell line — is starting.  |
| `agent_call_end_ok`       | That work is over, and how long it took.                    |
| `agent_call_end_error`    | It failed, and what it said.                                |
| `agent_call_stdout`       | One line the command printed, as it printed it.             |
| `agent_call_stderr`       | And one from the other stream.                              |
| `agent_frame_error`       | A frame made no sense, so the agent closed the link.        |
| `forward_listen`          | A forward listens here, and where: a socket file or a port. |
| `forward_listen_error`    | It could not listen, and why; tried again every minute.     |
| `forward_close`           | A forward taken out of the config stopped listening.        |

What an agent says about sending its machine's lines to Logline:

| Sender                   | What it says                                                        |
|--------------------------|---------------------------------------------------------------------|
| `logline_collect_begin`  | Collection began: from which floor, which docker, the spool's cap.  |
| `logline_collect_end`    | It stopped, and why — switched off, or on again from a new floor.   |
| `logline_ship_error`     | A batch was not taken, and why; said once per reason, sent again.   |
| `logline_ship_ok`        | Batches go again after the error above.                             |
| `logline_batch_refused`  | Logline refused a batch outright; it is kept in `refused/`.         |
| `logline_lost`           | A container was removed before a line of it was read.               |
| `logline_docker_error`   | Docker could not be asked; asked again.                             |
| `logline_follow_error`   | Following one container broke; it is followed again.                |
| `logline_collect_error`  | Collection could not start, and why.                                |

What an agent says about keeping its machine's numbers for the charts:

| Sender                 | What it says                                                       |
|------------------------|--------------------------------------------------------------------|
| `agent_metrics_error`  | A sample could not be written, and why; said once, not every 30s.  |
| `agent_metrics_ok`     | Samples are written again after the error above.                   |
| `agent_uptime_error`   | servermon's lines could not be counted, and why; said once.        |
| `agent_uptime_ok`      | They are counted again after the error above.                      |

And about servermon, the machine's load every second (the [remotes](remotes.md) page):

| Sender                  | What it says                                                          |
|-------------------------|-----------------------------------------------------------------------|
| `servermon_begin`       | It was started: its pid, why (none, gone, new version, silent), its folder. |
| `servermon_begin_error` | It could not be started, and why; tried again in a minute.            |

**Everything an agent says, the host says too.** A line written on a machine is sent up its
link and written again here — **keeping its uid**, because that is what a uid is for: one group
is one group, and one `grep` finds it in either file. On this end that group hangs under the
link it came in on, and every line carries `remote=` to say whose words they are. The agent
keeps its own copy, so a machine with no link still writes its log.

### Remotes

| Sender                 | What it says                                                     |
|------------------------|------------------------------------------------------------------|
| `remote_reserved`      | The machine an instance will run on, chosen from its list.       |
| `remote_joined`        | A machine added itself with the join token, and what it claimed. |
| `remote_claimed`       | It dialled with its own token: the join token joins nothing under its name now. |
| `remote_online`        | An agent dialled in, and what its machine is.                    |
| `remote_offline`       | The link dropped, and how long it held.                          |
| `remote_measure_ok`    | How far away it is and how fast the link runs.                   |
| `remote_measure_error` | The first measure after hello failed.                            |
| `remote_ping_error`    | The regular ping failed; `link=` says what became of it.         |
| `remote_refused`       | A token no remote holds, one already in use, or the join token for a machine that joined before. |
| `remote_link_error`    | The link itself misbehaved; the reason is in the words.          |
| `remote_said`          | The agent asked for a line to be written.                        |
| `remote_service_lost`  | A dropped link put a service out of reach.                       |
| `remote_service_error` | Waking that remote's services went wrong.                        |
| `apt_begin`            | Updates began to be installed on the machine.                    |
| `apt_end_ok`           | They are installed; `lines=` how many apt printed.               |
| `apt_end_error`        | apt failed or was cancelled; `reason=` its last line.            |
| `apt_all_begin`        | Install updates on N was pressed: `remotes=` the machines, `held=` the one serviceman runs on, which goes last. |
| `apt_all_end`          | Every one of them ended: `ok=` and `failed=` how many.          |
| `apt_all_error`        | Running them broke, and why.                                     |
| `apt_cancel_error`     | Cancel all could not reach a machine to stop its run.            |

### Forwards

| Sender                | What it says                                                             |
|-----------------------|--------------------------------------------------------------------------|
| `forwards_told`       | A machine was told the forwards it listens for; `failed=` names any that could not. |
| `forwards_tell_error` | Telling it failed, and why; said once per reason.                        |
| `forward_error`       | A connection through a forward could not reach the far end, and why; said once per reason in a row. |
| `forward_here_listen` | serviceman itself listens for a forward, where (a socket file or a port), and `owner=` the socket was given to when it runs as root. |
| `forward_here_listen_error` | It could not, and why; tried again every minute, said once per reason. |
| `forward_here_close`  | A forward set aside, changed or taken out of the config stopped listening here; its socket file is gone. |
| `forward_here_apply_error` | Following the config for those forwards failed, and why; the next change is still applied. |

### Shared folders

| Sender                    | What it says                                                          |
|---------------------------|-----------------------------------------------------------------------|
| `shared_home_begin`       | The home began to be set up on a machine, at its tailnet address.      |
| `shared_home_end_ok`      | Redis and Garage run there, and the volume is made.                    |
| `shared_home_end_error`   | Setting it up failed; `reason=` what the machine said.                 |
| `shared_folder_created`   | A folder was made in the volume.                                       |
| `shared_folder_deleted`   | A folder and its files were deleted, into juicefs's trash for a day.   |
| `shared_mount_set`        | A folder was given a path and a mode on a machine.                     |
| `shared_mount_removed`    | A folder was taken off a machine.                                      |
| `shared_told`             | A machine was told its table of mounts; `mounted=` how many are.       |
| `shared_tell_error`       | Telling it failed, and why; tried again every minute, said once per reason. |
| `root_shared_keep_line`   | On a machine: the root half's minute mounted, unmounted or started something. |
| `root_shared_keep_error`  | On a machine: a mount or the home failed, and why; said once per reason. |

### Logline

| Sender                  | What it says                                                            |
|-------------------------|-------------------------------------------------------------------------|
| `logline_token_issued`  | Logline issued a remote its token, bound to these addresses.            |
| `logline_told`          | A machine was told where its lines go, or that they go nowhere; `floor=` is from when. |
| `logline_tell_error`    | Telling it failed, and why; said once per reason, tried again every minute. |
| `logline_token_revoked` | A remote that left the config had its token taken back.                 |
| `logline_revoke_error`  | Logline could not be reached to take it back; tried again every minute. |
| `logline_sweep_error`   | The minute's round of telling broke before it began.                    |
| `logline_update_begin`  | Update Logline was pressed on Logline's page.                           |
| `logline_update_put`    | The files that differed were put in Logline's folder on its machine; `files=` how many. |
| `logline_update_ok`     | Its project was started again; `restarted=` the services that mount a file that was put. |
| `logline_update_error`  | The update stopped, and why: Logline's machine not found, a file not put, docker failing. |
| `logline_days_forgotten` | The days of lines before `before=` were dropped in Logline from its page; `days=`, `rows=`, `bytes=` what went. |
| `logline_days_forget_error` | Dropping them failed, and why: Logline away or refusing, or ClickHouse refusing a day. |

### Problems

What is wrong, looked at every minute and after every upgrade; the control page shows the same
list, in a bar under its header and first on its Health page.

| Sender                   | What it says                                                            |
|--------------------------|-------------------------------------------------------------------------|
| `problem_begin`          | Something is wrong, seen twice a check apart: where, what, and why.     |
| `problem_end`            | It is mended, and how long it lasted.                                   |
| `problems_check_error`   | A machine could not be looked at, and why; what was wrong there stays.  |
| `security_checked`       | The Security page looked at a machine: `ports=` it listens on, `knocked=` from outside, `answered=`, or `not_knocked=` why not. |
| `security_check_error`   | The look at a machine broke, and why; its row says the same.            |
| `apt_containers_ok`      | After an upgrade, everything that ran before runs again; `started=` names the ones serviceman started. |
| `apt_containers_down`    | After an upgrade, `down=` names what ran before and cannot start now; the upgrade's own lines say why. |
| `apt_containers_unknown` | What ran before the upgrade could not be read, so nothing is brought back after it. |
| `apt_containers_error`   | Bringing them back broke, and why.                                      |

### The control page

| Sender                       | What it says                                                              |
|------------------------------|---------------------------------------------------------------------------|
| `control_change`             | Something was changed, by whom, and where.                                |
| `control_refused`            | A caller that is not this machine was turned away.                        |
| `control_cross_site_refused` | A change sent from a page on another site was turned away.                |
| `control_error`              | An action asked from the page failed.                                     |
| `control_token_refused`      | A request with no token, one nobody holds, or one asking past its rights. |
| `control_token_used`         | An agent's token was used, by its label, and for what.                    |
| `control_token_made`         | An agent's token was made: its label, machines, rights, folders and apps. |
| `control_token_changed`      | Its label, machines, rights, folders or apps were changed; the token stayed. |
| `control_token_rotated`      | It was given a new value; the old one is refused from then on.            |
| `control_token_revoked`      | One was revoked.                                                          |
| `control_signed_in`          | The page was signed in with the owner's token.                            |
| `control_sign_in_refused`    | A token that is not the owner's was tried at the sign-in.                 |
| `config_saved`               | The config was written, with the hash of what went in.                    |
| `config_change`              | What the new config did to the running services.                          |
| `shell_begin`                | A shell was opened inside a container.                                    |
| `shell_end_ok`               | It was closed.                                                            |
| `shell_refused`              | A shell was asked for from somewhere it may not be asked.                 |
| `shell_cross_site_refused`   | A shell asked for by a page on another site was turned away.              |

## What is never written

- **No secrets.** A remote token or a token of the control door never appears, not even the
  wrong one somebody tried.
- **No query values.** `path=/report?token=***` keeps the shape of the request and drops what
  was in it, because a query can carry a visitor's password. `control_token_used` and
  `control_change` keep theirs: they are calls to serviceman's own API by the owner or a token
  let in, whose query is a folder or a machine (`path=/home/user/navplace`), never a secret.
- **No bodies and no headers.** What a service and its visitor say to each other is theirs.
- **No reads of the control page.** It polls every second; only what it *changes* is written.

## Where the lines go

`data/logs/<yyyymmdd>.log`, next to the config, one file a day. The file is closed and flushed
before serviceman exits, so the last lines — the ones that say why it stopped — are always
there. `SERVICEMAN_LOG_DIR` moves the folder; `SERVICEMAN_LOG_DIR=none` writes no files and
leaves stdout as it is.
