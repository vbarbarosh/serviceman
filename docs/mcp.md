# Apps from a coding agent

A coding agent in a box, a container with node in it and little else, makes a page or a small
app, and someone wants to open it. serviceman-mcp is how the agent puts it on serviceman: an MCP
server the agent starts, with one tool, `app_send`, that sends a folder as an app and answers its
link. The same name sent again is a new version, at the same link.

The box needs node, serviceman's control socket and a token, and nothing of serviceman's
repository: serviceman hands the server out as one file, with no dependencies. The call it makes
is the one the page's **Apps** makes,
[An app sent to serviceman](config.md#an-app-sent-to-serviceman), with a token that may send
apps and nothing more.

## The tool

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
of another kind is a `409` too.

## The token

On serviceman's page, **Tokens**: a label that says whose it is (`the box of the notes
project`), no machines, the right **apps** and nothing else, then **Make the token**. It is
shown once, so copy it then: only its hash is kept. **Rotate…** gives it a new value and
**Revoke…** ends it at once, as for any token
([A token for every caller](deploy.md#a-token-for-every-caller)).

An `apps` token sends an app of files, a new one or a new version, and adds an app on a socket
(`PUT /api/v1/apps/<name>/socket`). It touches no machine, no secret and no other kind of
service. Give each box a token of its own: the log names the token of every send
(`control_token_used token="the box of the notes project"`), and one box is stopped without the
others.

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

- **A token kept to the apps it made.** Today an `apps` token sends under any name, and a name
  serviceman already has for an app of files is that app: the send replaces it, whoever made it,
  another box or the owner. The tool's description asks the agent to pick a name of its own and
  keep it for the next versions; nothing holds it to that.
- No tool lists the apps or takes one away: that is the owner's, on serviceman's page.
- The link opens on the computer serviceman runs on. From anywhere else, the name outside is the
  one, once the config has an apps domain.

## Checked by

`tests/serviceman_mcp.test.js`: an agent sends a folder and gets its link, then sends it again
and the same link answers the new version, `.git` and `.env` files left out and named. A folder
with no `index.html`, a link, a folder that is not there and a token without the right are
refused in words, and nothing is made. The one file, taken through the socket with no token and
run by node from an empty folder with nothing in its environment but the token and the socket,
answers `initialize` and `tools/list` with serviceman's version, and sends an app.
