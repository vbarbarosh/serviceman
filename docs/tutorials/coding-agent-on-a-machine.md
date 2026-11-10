# A coding agent on a machine

Claude or Codex working on a project on another machine, a VPS or a laptop, in ai-box, from
the control page alone. No ssh: everything below is typed in the machine's **Shell** tab.
The project here is [space-worlds-game](https://github.com/vbarbarosh/space-worlds-game); put
your own in its place.

What you have at the end:

- ai-box set up and built on the machine
- the project cloned there, with a key that may push to that repository and no other
- a coding agent in it that goes on when the page is closed, the link drops or the ServiceMan
  agent restarts, and that you join again from any browser

## Before you start

- A machine with the ServiceMan agent dialled in: [Remotes](../remotes.md), **+ Add remote**
  and the command from its **Install** tab. Here it is called `vps1`.
- Ubuntu, and a user on it with `sudo`: the agent's own user, which is the one the Shell opens
  as. ai-box runs as that user and needs no root after setup.
- Write access to the repository on GitHub, to add a key to it.

Open `vps1` on the control page, then its **Shell** tab, and press **+**: that opens a
terminal, a login shell in the agent user's home. A terminal is kept running by the machine,
not by the page: closing the tab or the browser leaves it as it is, and the Shell tab shows it
again later, with what it printed meanwhile. It ends when its shell does (`exit`) or with the
**×** on its tab. [Terminals from another program](../terminals.md) says how they are kept.

## 1. Set up ai-box

```
sudo apt install -y git
git clone https://github.com/vbarbarosh/ai-box ~/ai-box
~/ai-box/bin/configure
```

`bin/configure` installs podman and what rootless podman needs, loads `fuse` and `tun`, and
grants your user the subuids. Run it as yourself, not under `sudo`: it asks for your password
once, and only when something is missing. Running it again changes nothing and says what is
already there. `~/ai-box/bin/self-check` lists what is still missing without changing anything.

## 2. Build the image

The build takes a while:

```
~/ai-box/bin/build
```

Close the page if you like: the terminal goes on, and the Shell tab shows it again later with
what the build printed, the last megabyte of it. The image is called `ai-box`. Rebuild it
often, since Claude and Codex change every few days:

```
cd ~/ai-box && git pull && bin/build
```

Its logins, history and image store are in `~/ai-box/data/`, which a pull and a build leave
alone.

## 3. A key that may push

A **deploy key**: an ssh key that GitHub accepts for one repository only. One key per machine
and repository, so taking one machine's access away is deleting one key on GitHub, and a key
copied off that machine reaches nothing else.

On the machine:

```
ssh-keygen -t ed25519 -N '' -C 'vps1 space-worlds-game' -f ~/.ssh/space-worlds-game
cat ~/.ssh/space-worlds-game.pub
```

`-N ''` leaves it without a passphrase: nobody is there to type one when the agent's work is
pushed, and ai-box's `push` asks the machine's git with no terminal at all. The key is
mode 600 in `~/.ssh`, and no box sees it: ai-box mounts the project folder, never your home.

On GitHub, in the repository: **Settings → Deploy keys → Add deploy key**. Title `vps1`, the
line `cat` printed as the key, tick **Allow write access**, **Add key**. Or from a computer
where `gh` is logged in, with the `.pub` file copied there:

```
gh repo deploy-key add space-worlds-game.pub -R vbarbarosh/space-worlds-game --allow-write --title vps1
```

Back on the machine, give the key a host name of its own, so git uses it for this repository
and your other keys for everything else:

```
cat >> ~/.ssh/config <<'EOF'

Host github.com-space-worlds-game
    HostName github.com
    User git
    IdentityFile ~/.ssh/space-worlds-game
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T github.com-space-worlds-game
```

The first `ssh` asks whether to trust github.com. Say yes only if the fingerprint it shows is
on [GitHub's list](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
(ed25519: `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`). Then it answers:

    Hi vbarbarosh/space-worlds-game! You've successfully authenticated, but GitHub does not provide shell access.

The repository's name in that line, not yours, is how a deploy key looks.

## 4. Clone the project

```
mkdir -p ~/work
git clone github.com-space-worlds-game:vbarbarosh/space-worlds-game ~/work/space-worlds-game
cd ~/work/space-worlds-game
git config user.name 'Your Name'
git config user.email 'you@example.com'
git push --dry-run origin main
```

The address is the host name from step 3, so this clone pushes with that key. The dry run
asks GitHub for write access and sends nothing: `Everything up-to-date` is the answer you want.
`ERROR: The key you are authenticating with has been marked as read only` means **Allow write
access** was not ticked.

Keep projects out of `~/repos`: ai-box mounts that folder into every box it opens.

Install the project's own dependencies inside the box, where its toolchain is:

```
~/ai-box/bin/run bin/configure
```

## 5. Log in, once per machine

```
cd ~/work/space-worlds-game
~/ai-box/bin/run claude
```

The first time, Claude asks you to log in: it prints an address, you open it on your laptop,
and paste the code back into the Shell. For Codex, open the box with `~/ai-box/bin/run` and type
`codex login --device-auth` in it: it prints a code to type on the laptop. Both are the
subscriptions' logins, no API key.

The logins are kept in `~/ai-box/data/` on this machine, so every box opened here is logged
in from now on. Another machine logs in on its own; copying the files over is what ServiceMan's
synced files are for, and they are not built yet ([terminal services](../../notes/terminal-services.md)).

Leave Claude with `/exit`: the box closes with it. A box opened with a bare `bin/run` closes with `exit`.

## 6. Start the agent so it stays

The coding agent gets a terminal of its own: press **+** in the Shell tab, and in the terminal
that opens:

```
cd ~/work/space-worlds-game
~/ai-box/bin/run claude
```

- **The machine keeps the terminal**, not the page: the agent goes on working with the tab
  closed and the link down.
- **A restart leaves it running**, of serviceman and of the ServiceMan agent alike: the
  terminal belongs to a small process of its own, which neither of them takes along.
- **Joining it again** shows what it printed meanwhile, the last megabyte of it, and the page
  scrolls back through it.

No tmux is needed for any of this.

Leave it running: just close the tab. Later, from any browser, open `vps1` and its **Shell**
tab again: every terminal of the machine has a tab there, whoever opened it.

When Claude exits, the shell in the project folder is still there; `exit` there, or the **×**
on the tab, ends the terminal.

## 7. Push

ai-box opens `.git` read-only, so the agent changes files and you make the commits, in a second
terminal (**+** in the Shell tab):

```
cd ~/work/space-worlds-game
git status
git add -p
git commit
git push
```

`git push` uses the deploy key from step 3.

ai-box is getting two commands for the agent itself: `commit`, which takes one patch and
makes one commit of it, and `push`, which pushes the branch the box was started on and nothing
else. A commit made that way is never rewritten. Both ask the machine's git outside the box, so
they will push with this same key: nothing here changes when they arrive.

## Not here yet

- **The Visual Notes note** of the project, at `/notes` in the box: it lives on your computer,
  and copying it to the machine and back is ServiceMan's part of
  [terminal services](../../notes/terminal-services.md), still a specification.
- **Sessions from the control page**: a list of the coding agents on every machine, started
  and attached with a click, the box rebuilt on a clock. The same specification.
- **One login for every machine**: synced files, the same specification.
