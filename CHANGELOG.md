# Changelog

Every change raises the patch version and is said here in short, the newest first.

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
