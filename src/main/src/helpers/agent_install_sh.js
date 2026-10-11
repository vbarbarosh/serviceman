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
function agent_install_sh(url)
{
    return `#!/bin/sh
# serviceman agent installer. Reads: --token, --url, --tag, --machine, --dir, --docker,
# --prefix, --root.
set -eu

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

# The root half is installed by root, and this runs as you: the password is asked for once,
# here, before anything is written — so a no costs nothing and a yes is not asked again below
if [ -n "$root_half" ] && [ "$(id -u)" != 0 ]; then
    echo 'serviceman: --root installs the root half of this machine, which needs sudo once'
    sudo true
fi

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

if [ -z "$node_bin" ]; then
    echo "serviceman: node is not on this machine, and the agent is a node program — looked on PATH ($PATH), in ~/bin, ~/.local/bin, /usr/local/bin and /opt/node/bin" >&2
    exit 1
fi

mkdir -p "$prefix/bin" "$prefix/logs" "$prefix/services"
curl -fsSL "$url/api/v1/agent.js" -o "$prefix/agent.js.new"
mv "$prefix/agent.js.new" "$prefix/agent.js"

env_file=$prefix/env

# What serviceman writes in there, and what it does not. A line of your own — a PATH for a node
# that lives in a home folder, anything the programs on this machine need — is kept as it was:
# this file is yours as much as it is ours.
mine='^SERVICEMAN_(URL|TOKEN|AGENT_DIR|LOG_DIR|SERVICES_DIR|TAGS|MACHINE|DIR|DOCKER)='
yours=''
if [ -f "$env_file" ]; then
    yours=$(grep -Ev "$mine" "$env_file" || true)
fi

umask 077
{
    echo "SERVICEMAN_URL=$url"
    echo "SERVICEMAN_TOKEN=$token"
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
    env            where the host is, and the token that says which machine this is. Mode 600.
    status.sock    where the agent answers what it is doing right now
    logs/          one file a day, in the same shape as the host's log
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
    tail -f logs/$(date +%Y%m%d).log            what it has done today
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

# A person's own systemd, for a machine where they are not root. It stops at logout unless
# lingering is on, which is the one thing here that may ask for a password.
mkdir -p "\\$HOME/.config/systemd/user"
echo "\\$unit_body
WantedBy=default.target" > "\\$HOME/.config/systemd/user/serviceman-agent.service"
systemctl --user daemon-reload 2>/dev/null || by_hand
systemctl --user enable --now serviceman-agent
systemctl --user restart serviceman-agent
echo "serviceman: the agent is up — systemctl --user status serviceman-agent"

if loginctl show-user "\\$(id -un)" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
    exit 0
fi
if loginctl enable-linger "\\$(id -un)" 2>/dev/null; then
    echo "serviceman: lingering is on, so it keeps running when you log out"
    exit 0
fi
echo "serviceman: it stops when you log out. To keep it: sudo loginctl enable-linger \\$(id -un)"
INSTALLEOF

cat > "$prefix/bin/uninstall" <<UNINSTALLEOF
#!/bin/sh

# Stops the agent and takes it out of systemd. Nothing in this folder is deleted: what the
# agent installed for the host is still in services/, and the last word on it is yours.

set -eu

prefix=$prefix

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

# Gives this machine its root half: the same agent file, kept up by the system's systemd,
# dialling nowhere and listening on one socket that only the person named below may open.
# Everything the host asks for that has to be root is done there, so nothing needs sudo and
# no line in sudoers says which commands are allowed.
#
# Run it with sudo. --remove takes it away again.

set -eu

prefix=$prefix
node_bin=$node_bin
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

cat > "\\$unit" <<UNITEOF
[Unit]
Description=serviceman agent, the root half
After=network.target

[Service]
ExecStart=$node_bin $prefix/agent.js --role root --for \\$user
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

if [ -f "\\$HOME/.config/systemd/user/serviceman-agent.service" ] && [ "\\$(id -u)" != 0 ]; then
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
`;
}

module.exports = agent_install_sh;
