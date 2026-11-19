# Apps from a coding agent

A coding agent in a box, a container with node in it and little else, makes a page or a small
app, and someone wants to open it. serviceman-mcp is how the agent puts it on serviceman: an MCP
server the agent starts, with two tools. `app_send` sends a folder as an app and answers its
link; the same name sent again is a new version, at the same link. `app_list` lists the apps the
agent may send to, with their links.

The box needs node, serviceman's control socket and a token, and nothing of serviceman's
repository: serviceman hands the server out as one file, with no dependencies. The call it makes
is the one the page's **Apps** makes,
[An app sent to serviceman](config.md#an-app-sent-to-serviceman), with a token that may send
apps and nothing more.

## The tools

`app_send` takes two arguments:

- `name`: the app's name, lowercase letters, digits, `-` and `_`, such as `notes`. Its link is
  made of it, and a new version is sent under it.
- `dir`: the app's folder, the one with its `index.html`, at its top or in its one folder. An
  absolute path is safest; a relative one is read from the folder the server was started in.

It zips the folder, sends it through the socket (`PUT /api/v1/apps/<name>`), and answers what
the agent is to pass on, in a few lines:

    notes is a new app on serviceman, of 3 files.
    Link: http://notes.localhost:8080/ (it opens in a browser on the computer serviceman runs on)
    Outside: notes.apps.example.com
    A new version goes the same way, under the name notes.

`Link` is the name beside serviceman's own, which the computer serviceman runs on opens with no
DNS to change. `Outside` is its name under the apps domain, or, without one, `No name outside:
serviceman has no apps domain.` A new version says so, and that its link is the same: the
version before it is gone, replaced whole, so a visitor meets one version or the other, never
half of each.

What failed is an answer too, marked as an error: one sentence the agent can act on, never a
stack. When serviceman refused the app, the sentence is serviceman's own:

    serviceman answered 400: notes.zip has no index.html, at its top or in its one folder: a page starts with it.
    serviceman answered 403: the token "a box" may not send an app of files

A token kept to the apps it makes ([The token](#the-token), below) sends under its own names and
new ones alone. Another's name is refused, and that app stays as it was:

    serviceman answered 403: the token "a box" may not send a new version of wiki: it sends only the apps it made, notes

`app_list` takes no arguments. It asks serviceman for the apps the token may send to
(`GET /api/v1/apps`) and answers a line each, with its link:

    The apps this token made, 2, the only ones it may send to:
    notes: http://notes.localhost:8080/, outside notes.apps.example.com
    board: http://board.localhost:8080/, outside board.apps.example.com
    app_send under one of these names sends its new version, at the same link; a name of your own makes a new app.
    A link opens in a browser on the computer serviceman runs on.

The agent reads it to find the name of an app it sent before, and to see which names are taken.
For a token that is not kept, the apps are every app of files on serviceman, and the answer says
that each is someone's: a send under one of their names replaces that app. An app on a socket
is listed too, marked as one `app_send` does not send to. With none, it says how one is made:
`This token has made no app yet, and it sends only the apps it makes: app_send under a name of
your own makes one.`

## What is sent

The whole folder goes, every file at every depth, hidden ones too. Whoever opens the link can
fetch every file sent, so the folder is the app, its built one (`dist/`), not a project with its
sources, its secrets and its `node_modules`; the tool's description tells the agent so.

- **Never sent:** a `.git`, and a `.env` or `.env.<anything>` (`.env.local`), at any depth,
  whoever asks. They are left out, and the answer names them by their paths:
  `Left out, never sent: .env, .git/, guide/.env.local.`
- **Refused:** a link in the folder, which is never followed out of it (`config.json is a link,
  and links are not sent: put the file it points at in its place`), and whatever is neither a
  file nor a folder. Nothing is sent then.
- **Limits:** 65535 files and 256 MiB, counted before the zip, which is made in memory on its
  way. A folder that holds more is refused before anything is sent, with a word to send the
  built folder, not the project around it.
- A file keeps no time and no mode: serviceman writes each one fresh, to be read.

serviceman checks the rest as it checks any zip: an `index.html`, nothing that leads outside
the folder, one zip at a time for one app (`409` for a second), and a name that is a service
of another kind is a `409` too; to a token kept to the apps it makes, a `403`, as any name not
its own.

## The token

On serviceman's page, **Tokens**, **+ New token**, step by step: **Who for**, a label that says
whose it is (`the box of the notes project`); **Rights**, **Machines** set to none, and under
**Apps** its **fine ▸** with the right **apps** alone ticked and **only the apps it makes** under
it, as it is for a new token; **Where**, no machine; then **Check**, and **Make the token**. **Apps** set to write would give it `versions` too, of no use to a box
with no machine. It is shown once, so copy it then: only its hash is kept. **Rotate…** gives it a new value and **Revoke…** ends it at once,
as for any token ([A token for every caller](deploy.md#a-token-for-every-caller)).

An `apps` token sends an app of files, a new one or a new version, adds an app on a socket
(`PUT /api/v1/apps/<name>/socket`) on a machine it sees alone and at the socket named after the
app, and lists the apps it may send to (`GET /api/v1/apps`). An app of files touches no machine,
and the token no secret and no other kind of service. Give each box a token of its own:
the log names the token of every send (`control_token_used token="the box of the notes
project"`), and one box is stopped without the others.

**Only the apps it makes** keeps the token to its own. A name serviceman has not seen makes the
app, an app of files or one on a socket, and goes on the token's list; a name on that list takes
the new version. Every other name is an app someone else has, the owner's or another token's,
or a service of another kind, and is refused with a `403` before its zip is read, the app left
as it was. The list is kept with the token in `data/control_tokens.json`, so a restart keeps it.
A rename of the app on its **Settings** carries the name on the list; an app removed leaves it,
and the same name made again later is its new maker's. The token's row says it:
`apps · only the apps it makes: notes, board`, or `none yet`.

Without the tick, as a token made before it was there, an `apps` token sends under any name: a
name serviceman has for an app of files is that app, and the send replaces it, whoever made it.
What it makes goes on its list all the same, so the tick given later on **Edit…** keeps it to
the apps it made.

## In a box

| Variable            | What it is                                                                  |
|---------------------|-----------------------------------------------------------------------------|
| `SERVICEMAN_TOKEN`  | The token, sent with every call. Without it, a send fails and says so.      |
| `SERVICEMAN_SOCKET` | serviceman's control socket; `/sockets/serviceman.sock` when it is not set. |

The socket is the file `control.socket` names in the config, mounted into the box. Its
`socket_mode`, `0600` by default, decides who may open it: the box's user must be one who may.

The box takes the file through that socket. It is public code, the same as in this repository,
with no secret in it, so serviceman hands it to anyone who asks, with no token, as it hands out
the agent:

    curl --unix-socket /sockets/serviceman.sock --create-dirs -o ~/.local/share/serviceman-mcp.js http://localhost/api/v1/serviceman-mcp.js

Then adds it to Claude Code, with the token in its environment:

    claude mcp add serviceman --scope user --env SERVICEMAN_TOKEN="$SERVICEMAN_TOKEN" -- node ~/.local/share/serviceman-mcp.js

- `--scope user` makes it the box's in every folder; without it, it is the folder's it was added
  in. The token is kept with the rest of Claude Code's settings in the box, `~/.claude.json`.
  `--scope project` would write it into the project's `.mcp.json`, where git can take it: it is
  not for this.
- A socket somewhere else is one more `--env SERVICEMAN_SOCKET=/run/serviceman.sock`.
- `claude mcp list` says whether it starts and answers.

The file is the server of the serviceman it came from, made from its modules at every ask: take
it again after serviceman is updated. Its first lines say its version, and so does its answer to
`initialize`; `node serviceman-mcp.js --help` prints how it is added.

## From a checkout

`bin/serviceman-mcp` is the same server, run from `src/mcp` as it is:

    claude mcp add serviceman --env SERVICEMAN_TOKEN="$SERVICEMAN_TOKEN" -- ~/serviceman/bin/serviceman-mcp

The one file is made by `src/mcp/bundler/mcp_bundle.js` with the agent's bundler
(`src/helpers/bundle_sources_read.js`, `render_bundle.js`). It carries the modules `src/mcp`
reaches, with its version written in where the checkout reads `package.json`. serviceman-mcp
requires node's own modules and its own files alone: a package from npm would not be in the file.

## Not there yet

- No tool takes an app away: that is the owner's, on serviceman's page.
- A token's list holds the apps it made and nothing else: the owner cannot hand a box an app
  made by someone else, other than by a token without the tick.
- The link opens on the computer serviceman runs on. From anywhere else, the name outside is the
  one, once the config has an apps domain.

## Checked by

`tests/serviceman_mcp.test.js`: an agent sends a folder and gets its link, then sends it again
and the same link answers the new version, `.git` and `.env` files left out and named. A folder
with no `index.html`, a link, a folder that is not there and a token without the right are
refused in words, and nothing is made. `app_list` answers a box's own apps, none at first, and
every app for a token without the tick; `app_send` under another box's name is refused in
serviceman's words, and that app serves its own files. The one file, taken through the socket
with no token and run by node from an empty folder with nothing in its environment but the token
and the socket, answers `initialize` and `tools/list` with serviceman's version, sends an app and
lists it.

`tests/apps_own.test.js`: a token kept to the apps it makes sends its own, of files and on a
socket, and is refused the owner's app, another box's and a service of another kind, each left
as it was; `GET /api/v1/apps` answers each token its own and the owner every app; the list
survives a restart, follows a rename and loses an app removed, and a name kept in the file for
an app removed by hand is the owner's once the owner makes it. A token without the tick sends
under any name, as before.
