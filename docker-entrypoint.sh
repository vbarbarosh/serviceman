#!/bin/sh

# What runs in the serviceman image: a tailscale agent, then serviceman itself.
#
# tailscaled is asked for userspace networking, which needs no TUN device and no NET_ADMIN —
# the connections it receives from the tailnet are dialled to 127.0.0.1 in this container,
# where serviceman is listening. So the machine underneath publishes no port at all, and the
# only way in is the tailnet.
#
# The way out is its proxy: in userspace mode nothing dialled here goes through tailscale, so a
# tailnet address is not routed and a tailnet name does not resolve. TAILNET_PROXY tells
# serviceman where the proxy is, and serviceman uses it to reach Logline.

set -eu

TS_SOCKET=/var/run/tailscale/tailscaled.sock
TS_PROXY=localhost:1055
CONFIG=${SERVICEMAN_CONFIG:-/app/data/serviceman.json}
WAIT_TRIES=100

LOG_DIR=${SERVICEMAN_LOG_DIR:-/app/data/logs}

mkdir -p "$(dirname "$CONFIG")" /var/lib/tailscale /var/run/tailscale

# tailscaled talks in its own file beside serviceman's, so stdout is serviceman's alone.
# With the file log turned off it stays on stdout.
if [ "$LOG_DIR" = none ]; then
    TS_LOG=/dev/stdout
else
    mkdir -p "$LOG_DIR"
    TS_LOG="$LOG_DIR/tailscaled.log"
    echo "serviceman: tailscaled writes to $TS_LOG"
fi

# shellcheck disable=SC2086 -- TS_DAEMON_ARGS is a line of flags, and is meant to be split
tailscaled \
    --tun=userspace-networking \
    --state=/var/lib/tailscale/tailscaled.state \
    --socket="$TS_SOCKET" \
    --outbound-http-proxy-listen="$TS_PROXY" \
    ${TS_DAEMON_ARGS:-} >> "$TS_LOG" 2>&1 &

waited=0
while [ ! -S "$TS_SOCKET" ] && [ "$waited" -lt "$WAIT_TRIES" ]; do
    waited=$((waited + 1))
    sleep 0.1
done

# With a key the machine joins by itself. Without one, `tailscale up` prints a link to open —
# read it with `docker logs serviceman`. serviceman starts either way, which is why this waits
# in the background: a host that is not on the tailnet yet still answers on its own loopback.
join_tailnet()
{
    # shellcheck disable=SC2086 -- TS_EXTRA_ARGS is a line of flags, and is meant to be split
    if [ -n "${TS_AUTHKEY:-}" ]; then
        tailscale up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-serviceman}" ${TS_EXTRA_ARGS:-}
    else
        tailscale up --hostname="${TS_HOSTNAME:-serviceman}" ${TS_EXTRA_ARGS:-}
    fi
    if [ "${TS_SERVE:-}" = 1 ]; then
        # https://<machine>.<tailnet>.ts.net in front of serviceman, on a certificate the
        # tailnet issues — the way to have https here without a public name
        tailscale serve --bg "${TS_SERVE_PORT:-3000}"
    fi
}

join_tailnet &

# A config is the one thing serviceman cannot invent, so a first run gets a starting one. It is
# yours from then on: this never writes over a config that is already there.
#
# It goes in the repo, beside the config a serviceman on the machine itself would read, and it
# begins as a copy of that one — the same services, the same remotes — with the two things
# that are different in here:
#
#   * both doors bind every address, because that is where a published port arrives; what may
#     reach them is decided outside, by what `docker run -p` binds on the machine
#   * the control page is `exposed`, because a request forwarded by docker is a stranger to
#     serviceman however local it was on the machine. Take it out to have the control page over
#     the tailnet only — those connections do arrive on the loopback in here
#
# There is no control socket in it. A socket is a file, and a file inside this container is
# nowhere: to give an agent on this machine a door, mount a folder and put the socket in there.
if [ ! -f "$CONFIG" ]; then
    node -e '
const fs = require("fs");
const [file, neighbour] = process.argv.slice(1);
const near = (fs.existsSync(neighbour) ? JSON.parse(fs.readFileSync(neighbour, "utf8")) : {});
const out = {
    listen: {host: "0.0.0.0", port: 3000},
    control: {host: "serviceman.localhost", bind: "0.0.0.0", port: 3001, exposed: true},
    defaults: near.defaults,
    remotes: near.remotes || [],
    services: near.services || [],
};
fs.writeFileSync(file, `${JSON.stringify(out, null, 4)}\n`);
try {
    // Written by root in here, into somebody\u0027s repo out there: it belongs to whoever owns
    // the folder, or they cannot edit their own config without sudo
    const owner = fs.statSync(require("path").dirname(file));
    fs.chownSync(file, owner.uid, owner.gid);
}
catch (error) {
    console.log(`serviceman: ${file} stays owned by root — ${error.message}`);
}
const from = (near.services === undefined ? "" : ` — ${out.services.length} services and ${out.remotes.length} remotes from ${neighbour}`);
console.log(`serviceman: wrote a first config to ${file}${from}`);
' "$CONFIG" /app/serviceman.json
fi

# A config written before this container, or by hand, may hold what works on a machine and not
# in here. It is not rewritten — it is read, and what will not work is said out loud.
node -e '
const fs = require("fs");
const file = process.argv[1];
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const control = json.control || {};
const said = function (text) {
    console.log(`serviceman: ${text}`);
};
// A path that came in on a volume is a path the machine outside can see too; everything else
// in here belongs to this container alone
const shared = function (name) {
    const dir = require("path").dirname(name);
    const mounts = fs.readFileSync("/proc/self/mounts", "utf8").split("\n").map(v => v.split(" ")[1]).filter(v => v !== undefined && v !== "/");
    return mounts.some(v => dir === v || dir.startsWith(`${v}/`));
};
if (LOOPBACK.includes((json.listen || {}).host || "127.0.0.1")) {
    said(`${file}: listen.host is the loopback of this container, which a published port never reaches. Set it to 0.0.0.0 — what may reach it is decided by docker run -p.`);
}
if (control.port !== null && LOOPBACK.includes(control.bind || "127.0.0.1")) {
    said(`${file}: control.bind is the loopback of this container. Set it to 0.0.0.0 for the control page on a published port.`);
}
if (control.port !== null && control.exposed !== true) {
    said(`${file}: the control page answers this container only, so a published port gets 404. Add "exposed": true, and let docker run -p 127.0.0.1 be its wall.`);
}
if (typeof control.socket === "string") {
    // The folder of a socket has to be there before it can be made. A mounted one already is.
    fs.mkdirSync(require("path").dirname(control.socket), {recursive: true});
}
if (typeof control.socket === "string" && shared(control.socket) === false) {
    said(`${file}: control.socket is ${control.socket}, which is a path inside this container — nothing outside can open that file. Mount a folder and put the socket there.`);
}
' "$CONFIG"

export TAILNET_PROXY="http://$TS_PROXY"
exec node /app/src/main
