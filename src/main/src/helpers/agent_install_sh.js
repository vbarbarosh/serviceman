// The one command that puts the agent on a machine:
//
//     curl -fsSL https://serviceman.example.com/api/v1/install.sh | sh -s -- --token 0c0f…a91b
//
// It is written here, and not kept as a file, because the address of this host has to be in it:
// the machine that runs it must know where to dial back, and the only address that is certainly
// right is the one it just fetched this script from.
//
// What it does is small enough to read before running it, which is the least a script piped
// into a shell owes anybody: fetch one file, write one env file, and — where systemd is — one
// unit that keeps it up. No package manager, no repository, nothing installed but the agent.
// The node a machine without one is told to fetch: the same as the install page shows
const NODE_VERSION = 'v24.19.0';

function agent_install_sh(url)
{
    return `#!/bin/sh
# serviceman agent installer. Reads: --token, --url, --tag, --machine, --dir, --docker,
# --prefix, --root.
set -eu

# All of it is one function, called on the last line: a shell reading this from curl reads it
# to the end before it runs a line of it, so a download cut short runs nothing, and an early exit
# no longer leaves curl writing into a closed pipe ("curl: (23) Failure writing output")
main() {

url='${url}'
token=''
machine=''
dir=''
docker=''
prefix=''
tags=''
root_half=''

while [ $# -gt 0 ]; do
    case "$1" in
        --token) token=$2; shift 2;;
        --url) url=$2; shift 2;;
        --tag) tags="$tags\${tags:+,}$2"; shift 2;;
        --machine) machine=$2; shift 2;;
        --dir) dir=$2; shift 2;;
        --docker) docker=$2; shift 2;;
        --prefix) prefix=$2; shift 2;;
        --root) root_half=yes; shift;;
        *) echo "serviceman: $1 means nothing here" >&2; exit 1;;
    esac
done

# /opt belongs to root; a person who is not root gets a folder they can write, and the agent
# works the same from either
if [ -z "$prefix" ]; then
    if [ "$(id -u)" = 0 ]; then
        prefix=/opt/serviceman-agent
    else
        prefix=$HOME/serviceman-agent
    fi
fi

if [ -z "$token" ]; then
    echo 'serviceman: --token is required — the token of this machine, or the join token' >&2
    exit 1
fi

# The node that will run the agent, as an absolute path — the unit below is started by systemd,
# which has a PATH of its own, and sudo has another one again. A node in somebody's home is a
# node all the same, so the usual places are looked at before giving up.
node_bin=$(command -v node 2>/dev/null || true)
for candidate in "$HOME/bin/node" "$HOME/.local/bin/node" "\${SUDO_USER:+/home/$SUDO_USER/bin/node}" "\${SUDO_USER:+/home/$SUDO_USER/.local/bin/node}" /usr/local/bin/node /opt/node/bin/node; do
    [ -n "$node_bin" ] && break
    [ -x "$candidate" ] && node_bin=$candidate
done

# Said first and plainly, before the password and before anything is written: node is one file,
# and the command that puts it in ~/bin is given for this machine's own processor
if [ -z "$node_bin" ]; then
    case "$(uname -m)" in
        x86_64|amd64) arch=x64;;
        aarch64|arm64) arch=arm64;;
        armv7l) arch=armv7l;;
        ppc64le) arch=ppc64le;;
        s390x) arch=s390x;;
        *) arch=$(uname -m);;
    esac
    echo 'serviceman: no node on this machine — the agent needs it. Nothing was installed.' >&2
    echo 'serviceman: looked on PATH, in ~/bin, ~/.local/bin, /usr/local/bin and /opt/node/bin' >&2
    echo 'serviceman: node is one file; this puts it in ~/bin:' >&2
    echo '' >&2
    echo "    mkdir -p ~/bin && v=${NODE_VERSION} && curl -fsSL https://nodejs.org/dist/\\$v/node-\\$v-linux-$arch.tar.xz | tar -xJ -C ~/bin --strip-components=2 node-\\$v-linux-$arch/bin/node" >&2
    echo '' >&2
    echo 'serviceman: then run the same install line again' >&2
    exit 1
fi

# The root half is installed by root, and this runs as you: the password is asked for once,
# here, before anything is written — so a no costs nothing and a yes is not asked again below
if [ -n "$root_half" ] && [ "$(id -u)" != 0 ]; then
    echo 'serviceman: --root installs the root half of this machine, which needs sudo once'
    sudo true
fi

mkdir -p "$prefix/bin" "$prefix/logs" "$prefix/services"

# From the host: the agent, the host's signature of it, and the key that checks it, each the
# way this script came, over a port or a socket file
host_get() {
    case "$url" in
        unix://*) curl -fsSL --unix-socket "\${url#unix://}" "http://localhost$1" -o "$2";;
        *) curl -fsSL "$url$1" -o "$2";;
    esac
}
host_get /api/v1/agent.js "$prefix/agent.js.new"
host_get /api/v1/agent.js.sig "$prefix/agent.js.sig.new"
host_get /api/v1/agent.pub "$prefix/host.pub.new"
host_key=$(cat "$prefix/host.pub.new")
rm -f "$prefix/host.pub.new"

# A machine that has an agent takes a new one from the host that installed it and no other:
# the agent already here checks the signature with the key it was given, and that key stays.
# The first install trusts the host this script came from, the moment the token was handed
# over as well. An agent from before signatures cannot check, and takes this one as the first.
if [ -f "$prefix/agent.js" ] && [ -f "$prefix/env" ]; then
    known=$(grep '^SERVICEMAN_HOST_KEY=' "$prefix/env" || true)
    known=\${known#SERVICEMAN_HOST_KEY=}
    if [ -n "$known" ] && "$node_bin" "$prefix/agent.js" --help 2>/dev/null | grep -q -- '--verify'; then
        if ! "$node_bin" "$prefix/agent.js" --verify "$prefix/agent.js.new" "$prefix/agent.js.sig.new" "$known"; then
            rm -f "$prefix/agent.js.new" "$prefix/agent.js.sig.new"
            echo "serviceman: the agent from $url is not signed by the host this machine was installed from — nothing was changed" >&2
            exit 1
        fi
        host_key=$known
    fi
fi
mv "$prefix/agent.js.new" "$prefix/agent.js"
mv "$prefix/agent.js.sig.new" "$prefix/agent.js.sig"

env_file=$prefix/env

# What serviceman writes in there, and what it does not. A line of your own — a PATH for a node
# that lives in a home folder, anything the programs on this machine need — is kept as it was:
# this file is yours as much as it is ours.
mine='^SERVICEMAN_(URL|TOKEN|AGENT_DIR|LOG_DIR|SERVICES_DIR|TAGS|MACHINE|DIR|DOCKER|HOST_KEY)='
yours=''
if [ -f "$env_file" ]; then
    yours=$(grep -Ev "$mine" "$env_file" || true)
fi

umask 077
{
    echo "SERVICEMAN_URL=$url"
    echo "SERVICEMAN_TOKEN=$token"
    # The host's public key, one line: an update over the link is taken only when this host signed it
    echo "SERVICEMAN_HOST_KEY=$host_key"
    echo "SERVICEMAN_AGENT_DIR=$prefix"
    # A machine kept up by systemd has nobody watching its stdout, so the agent keeps its own
    # daily files beside itself
    echo "SERVICEMAN_LOG_DIR=$prefix/logs"
    echo "SERVICEMAN_SERVICES_DIR=$prefix/services"
    [ -n "$tags" ] && echo "SERVICEMAN_TAGS=$tags"
    [ -n "$machine" ] && echo "SERVICEMAN_MACHINE=$machine"
    [ -n "$dir" ] && echo "SERVICEMAN_DIR=$dir"
    [ -n "$docker" ] && echo "SERVICEMAN_DOCKER=$docker"
    [ -n "$yours" ] && echo "$yours"
    true
} > "$env_file.new"
mv "$env_file.new" "$env_file"

if [ -n "$yours" ]; then
    echo "serviceman: kept $(echo "$yours" | wc -l) line(s) of your own in $env_file"
fi

umask 022

cat > "$prefix/README.md" <<'READMEEOF'
# serviceman-agent

This folder is one machine's half of a serviceman host. The agent here dials that host, says
what this machine has, and then does what it is asked: start a container, install and run a
program, carry the requests for it. Nothing listens on this machine — the link goes out — so no
port is open here and no address is needed.

    agent.js       the agent, one file, node and nothing else
    servermon.js   the machine's load every second, written here and kept running by the agent
    env            where the host is, and the token that says which machine this is. Mode 600.
    status.sock    where the agent answers what it is doing right now
    logs/agent/    the agent's log, one file a day, in the same shape as the host's log
    logs/servermon/  servermon's, a JSON line a second, one file a day, 30 days kept
    services/      everything the host asked this machine to install, a folder each
    bin/install    puts the agent under systemd, or says how to run it. Safe to run again.
    bin/install-root  sudo it to give this machine a root half — the same file, run by the
                   system's systemd, answering a socket for the work that has to be root.
                   Run it with --remove to take it away.
    bin/status     asks the agent what it is doing
    bin/restart    starts it again — what a line added to env needs to take
    bin/update     fetches the agent the host serves now, and starts it
    bin/uninstall  stops it and takes it out of systemd

## The everyday things

    bin/status                                  what it is doing
    tail -f logs/agent/$(date +%Y%m%d).txt      what it has done today
    tail -n 60 logs/servermon/$(date +%Y%m%d).jsonl  the machine's last minute
    systemctl status serviceman-agent           when it is kept up by the system's systemd
    systemctl --user status serviceman-agent    when it is kept up by your own

To move this machine to another host, or to change its token, edit env and run bin/install
again. To pick up a newer agent, run bin/update. To take everything away: bin/uninstall, then remove this folder.

## What is in services/

One folder per program the host installed here, made and removed by the agent as the config on
the host changes. A folder in here is the agent's; anything of yours belongs somewhere else.
READMEEOF

cat > "$prefix/bin/install" <<INSTALLEOF
#!/bin/sh

# Puts the agent under systemd — the system's when run by root, your own otherwise — and starts
# it. Run it again after editing ../env or after replacing agent.js: it writes the unit and
# starts what is already here, and nothing else.

set -eu

prefix=$prefix
node_bin=$node_bin
env_file=\\$prefix/env

by_hand() {
    echo "serviceman: nothing was installed to keep it up. Run it with:"
    echo "    env \\\\\\$(cat \\$env_file | xargs) \\$node_bin \\$prefix/agent.js"
    exit 0
}

command -v systemctl >/dev/null 2>&1 || by_hand

# KillMode=process: a restart of the agent stops the agent and nothing else; the programs,
# shells and kept terminals it started go on

unit_body="[Unit]
Description=serviceman agent
After=network-online.target docker.service

[Service]
EnvironmentFile=\\$env_file
ExecStart=\\$node_bin \\$prefix/agent.js
Restart=always
RestartSec=5
KillMode=process

[Install]"

if [ "\\$(id -u)" = 0 ]; then
    echo "\\$unit_body
WantedBy=multi-user.target" > /etc/systemd/system/serviceman-agent.service
    # A systemd that is installed and not running is a container, most of the time
    systemctl daemon-reload 2>/dev/null || by_hand
    systemctl enable --now serviceman-agent
    systemctl restart serviceman-agent
    echo "serviceman: the agent is up — systemctl status serviceman-agent"
    exit 0
fi

# A person's own systemd, for a machine where they are not root. It runs only while they are
# logged in, unless lingering is on: then it starts at boot and stays. So lingering comes first,
# with sudo once when this user may not turn it on alone: the one install line does it all.
# A shell opened with su or sudo has no XDG_RUNTIME_DIR, and systemctl --user then finds no bus
# even while your own systemd runs: where it lives is known, so it is looked for there
export XDG_RUNTIME_DIR=\\\${XDG_RUNTIME_DIR:-/run/user/\\$(id -u)}

user=\\$(id -un)

user_bus() {
    systemctl --user show-environment >/dev/null 2>&1
}

lingers() {
    loginctl show-user "\\$user" --property=Linger 2>/dev/null | grep -q 'Linger=yes'
}

linger() {
    loginctl enable-linger "\\$user" 2>/dev/null && return 0
    command -v sudo >/dev/null 2>&1 || return 1
    sudo -n loginctl enable-linger "\\$user" 2>/dev/null && return 0
    echo "serviceman: lingering keeps your own systemd running with nobody logged in; it needs sudo once"
    sudo loginctl enable-linger "\\$user"
}

lingers || linger || true

# A systemd that lingering has just started answers a moment later
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    user_bus && break
    sleep 1
done

# The unit is written only for a systemd that answers: one left behind sends bin/restart to it
if ! user_bus; then
    echo "serviceman: your own systemd does not answer, and lingering could not be turned on"
    echo "serviceman: to keep the agent up, run once as root: loginctl enable-linger \\$user"
    echo "serviceman: then run this again: \\$prefix/bin/install"
    by_hand
fi

mkdir -p "\\$HOME/.config/systemd/user"
echo "\\$unit_body
WantedBy=default.target" > "\\$HOME/.config/systemd/user/serviceman-agent.service"
systemctl --user daemon-reload 2>/dev/null || by_hand
systemctl --user enable --now serviceman-agent
systemctl --user restart serviceman-agent
echo "serviceman: the agent is up — systemctl --user status serviceman-agent"

if ! lingers; then
    echo "serviceman: lingering is off, so it stops when you log out. To keep it: sudo loginctl enable-linger \\$user"
fi
INSTALLEOF

cat > "$prefix/bin/uninstall" <<UNINSTALLEOF
#!/bin/sh

# Stops the agent and takes it out of systemd. Nothing in this folder is deleted: what the
# agent installed for the host is still in services/, and the last word on it is yours.

set -eu

prefix=$prefix

# A shell opened with su or sudo has no XDG_RUNTIME_DIR, and systemctl --user then finds no bus
# even while your own systemd runs: where it lives is known, so it is looked for there
export XDG_RUNTIME_DIR=\\\${XDG_RUNTIME_DIR:-/run/user/\\$(id -u)}

if command -v systemctl >/dev/null 2>&1; then
    if [ "\\$(id -u)" = 0 ] && [ -f /etc/systemd/system/serviceman-agent.service ]; then
        systemctl disable --now serviceman-agent 2>/dev/null || true
        rm -f /etc/systemd/system/serviceman-agent.service
        systemctl daemon-reload 2>/dev/null || true
        echo "serviceman: the agent is stopped and out of systemd"
    elif [ -f "\\$HOME/.config/systemd/user/serviceman-agent.service" ]; then
        systemctl --user disable --now serviceman-agent 2>/dev/null || true
        rm -f "\\$HOME/.config/systemd/user/serviceman-agent.service"
        systemctl --user daemon-reload 2>/dev/null || true
        echo "serviceman: the agent is stopped and out of your systemd"
    else
        echo "serviceman: no unit of its own was found — stop it however it was started"
    fi
else
    echo "serviceman: no systemd here — stop it however it was started"
fi

# servermon runs on its own, so that a restart of the agent leaves it running: it is stopped here,
# found by its command line
for proc in /proc/[0-9]*; do
    if tr '\\0' '\\n' < "\\$proc/cmdline" 2>/dev/null | grep -qx "\\$prefix/servermon.js"; then
        kill "\\\${proc#/proc/}" && echo "serviceman: servermon is stopped"
    fi
done

echo "serviceman: the host still has this machine in its config. Take it out there too."
if [ -d "\\$prefix/services" ] && [ -n "\\$(ls -A "\\$prefix/services" 2>/dev/null)" ]; then
    echo "serviceman: what the host installed on this machine is still here:"
    ls -1 "\\$prefix/services" | sed 's/^/    services\\//'
fi
echo "serviceman: nothing needs this folder now — remove it with: rm -rf \\$prefix"
UNINSTALLEOF

cat > "$prefix/bin/update" <<UPDATEEOF
#!/bin/sh

# The install command again, from the host this machine already belongs to:
#
#     curl -fsSL <url>/api/v1/install.sh | sh -s -- --token <token>
#
# Everything comes down fresh — the agent, these scripts, the README — and the agent is started
# again at the end. What this machine is called and what it claims is read back out of env, so
# an update never quietly forgets it.

set -eu

prefix=$prefix
env_file=\\$prefix/env

named() {
    sed -n "s/^\\$1=//p" "\\$env_file"
}

url=\\$(named SERVICEMAN_URL)
token=\\$(named SERVICEMAN_TOKEN)
tags=\\$(named SERVICEMAN_TAGS)
machine=\\$(named SERVICEMAN_MACHINE)
dir=\\$(named SERVICEMAN_DIR)
docker=\\$(named SERVICEMAN_DOCKER)

set -- --token "\\$token" --url "\\$url" --prefix "\\$prefix"
[ -n "\\$tags" ] && set -- "\\$@" --tag "\\$tags"
[ -n "\\$machine" ] && set -- "\\$@" --machine "\\$machine"
[ -n "\\$dir" ] && set -- "\\$@" --dir "\\$dir"
[ -n "\\$docker" ] && set -- "\\$@" --docker "\\$docker"

# A name of this run's own: a run still finishing removes its copy, never this one's
script="\\$prefix/install.sh.\\$\\$"
case "\\$url" in
    unix://*)
        curl -fsSL --unix-socket "\\\${url#unix://}" http://localhost/api/v1/install.sh -o "\\$script";;
    *)
        curl -fsSL "\\$url/api/v1/install.sh" -o "\\$script";;
esac

sh "\\$script" "\\$@"
rm -f "\\$script"
UPDATEEOF

cat > "$prefix/bin/install-root" <<INSTALLROOTEOF
#!/bin/sh

# Gives this machine its root half: the same agent, kept up by the system's systemd, dialling
# nowhere and listening on one socket that only the person named below may open. Everything
# the host asks for that has to be root is done there, so nothing needs sudo and no line in
# sudoers says which commands are allowed.
#
# It runs a copy of the agent file and of node that are root's alone, so what the person's
# own user may write is never what root runs; the host's key is pinned beside the copy, and
# an update's new file is taken as the copy only when the host signed it.
#
# Run it with sudo. --remove takes it away again.

set -eu

prefix=$prefix
node_bin=$node_bin
root_dir=/usr/local/lib/serviceman-agent
unit=/etc/systemd/system/serviceman-agent-root.service
socket=/run/serviceman-root.sock

if [ "\\$(id -u)" != 0 ]; then
    echo "serviceman: run this with sudo — the root half is installed by root" >&2
    exit 1
fi

if [ "\\\${1:-}" = "--remove" ]; then
    systemctl disable --now serviceman-agent-root 2>/dev/null || true
    rm -f "\\$unit" "\\$socket"
    systemctl daemon-reload 2>/dev/null || true
    echo "serviceman: the root agent is gone — this machine does what its own user may do"
    exit 0
fi

# Whose agent may ask: the person who ran sudo, or whoever owns the folder it lives in
user=\\\${SUDO_USER:-\\$(stat -c %U "\\$prefix")}

# The copy that is root's alone, unless the folder is root's already, as it is when the agent
# was installed as root: then both halves run the one file
if [ "\\$(stat -c %U "\\$prefix")" = root ]; then
    root_dir=\\$prefix
else
    mkdir -p "\\$root_dir"
    chmod 755 "\\$root_dir"
    cp "\\$node_bin" "\\$root_dir/node.new" && mv "\\$root_dir/node.new" "\\$root_dir/node"
    cp "\\$prefix/agent.js" "\\$root_dir/agent.js.new" && mv "\\$root_dir/agent.js.new" "\\$root_dir/agent.js"
    chmod 755 "\\$root_dir/node" "\\$root_dir/agent.js"
    known=\\$(grep '^SERVICEMAN_HOST_KEY=' "\\$prefix/env" || true)
    printf '%s\\n' "\\\${known#SERVICEMAN_HOST_KEY=}" > "\\$root_dir/host.pub"
    node_bin=\\$root_dir/node
fi

cat > "\\$unit" <<UNITEOF
[Unit]
Description=serviceman agent, the root half
After=network.target

[Service]
ExecStart=\\$node_bin \\$root_dir/agent.js --role root --for \\$user --root-source \\$prefix/agent.js
Restart=always
RestartSec=5
KillMode=process

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now serviceman-agent-root
systemctl restart serviceman-agent-root
echo "serviceman: the root agent answers \\$socket for \\$user"
echo "serviceman: it can be taken away again with: sudo \\$prefix/bin/install-root --remove"
INSTALLROOTEOF

cat > "$prefix/bin/restart" <<RESTARTEOF
#!/bin/sh

# Starts the agent again, under whichever systemd keeps it up. What it is for above all is a
# line added to ../env: the unit reads that file when it starts and never again.

set -eu

command -v systemctl >/dev/null 2>&1 || {
    echo "serviceman: no systemd here — start it however it was started" >&2
    exit 1
}

# A shell opened with su or sudo has no XDG_RUNTIME_DIR, and systemctl --user then finds no bus
# even while your own systemd runs: where it lives is known, so it is looked for there
export XDG_RUNTIME_DIR=\\\${XDG_RUNTIME_DIR:-/run/user/\\$(id -u)}

if [ -f "\\$HOME/.config/systemd/user/serviceman-agent.service" ] && [ "\\$(id -u)" != 0 ]; then
    if ! systemctl --user show-environment >/dev/null 2>&1; then
        echo "serviceman: your own systemd does not answer in this shell — bin/install says why and what to do" >&2
        exit 1
    fi
    systemctl --user restart serviceman-agent
    echo "serviceman: the agent is up — systemctl --user status serviceman-agent"
    exit 0
fi

if [ -f /etc/systemd/system/serviceman-agent.service ]; then
    if [ "\\$(id -u)" != 0 ]; then
        echo "serviceman: it is kept up by the system's systemd — sudo \\$0" >&2
        exit 1
    fi
    systemctl restart serviceman-agent
    echo "serviceman: the agent is up — systemctl status serviceman-agent"
    exit 0
fi

echo "serviceman: no unit of its own was found — bin/install writes one" >&2
exit 1
RESTARTEOF

cat > "$prefix/bin/status" <<STATUSEOF
#!/bin/sh

# Asks the agent what it is doing, right now. There is no file to go stale: the answer comes
# from the agent itself, and no answer means no agent is running here.

set -eu

exec $node_bin $prefix/agent.js --status
STATUSEOF

chmod 755 "$prefix/bin/install" "$prefix/bin/install-root" "$prefix/bin/restart" "$prefix/bin/uninstall" "$prefix/bin/update" "$prefix/bin/status"

echo "serviceman: the agent is in $prefix — read $prefix/README.md"

# The root half first, so the session agent says it is there the moment it dials in
if [ -n "$root_half" ]; then
    if [ "$(id -u)" = 0 ]; then
        "$prefix/bin/install-root"
    else
        sudo "$prefix/bin/install-root"
    fi
fi

exec "$prefix/bin/install"

}

main "$@"
`;
}

module.exports = agent_install_sh;
