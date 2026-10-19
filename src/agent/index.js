#!/usr/bin/env node

const agent_built = require('./src/agent_built');
const agent_bye = require('./src/agent_bye');
const agent_connect = require('./src/agent_connect');
const agent_doors_read = require('./src/agent_doors_read');
const agent_doors_state = require('./src/agent_doors_state');
const agent_http_serve = require('./src/agent_http_serve');
const agent_logline = require('./src/agent_logline');
const agent_metrics = require('./src/agent_metrics');
const agent_peer_serve = require('./src/agent_peer_serve');
const agent_programs_adopt = require('./src/agent_programs_adopt');
const agent_root_serve = require('./src/agent_root_serve');
const agent_root_socket = require('./src/agent_root_socket');
const agent_say = require('./src/agent_say');
const agent_serve = require('./src/agent_serve');
const agent_servermon = require('./src/agent_servermon');
const agent_sleep_watch = require('./src/agent_sleep_watch');
const agent_status_ask = require('./src/agent_status_ask');
const agent_status_serve = require('./src/agent_status_serve');
const agent_uninstall = require('./src/agent_uninstall');
const agent_uptime = require('./src/agent_uptime');
const agent_version = require('./version.json');
const format_seconds = require('../helpers/format_seconds');
const log_uid = require('../helpers/log_uid');
const os = require('os');
const timers = require('timers/promises');

const AGENT_VERSION = agent_version.version;
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 5000;

const USAGE = `serviceman-agent --url <serviceman> --token <secret>

Runs on a machine that should carry services for a serviceman host. It dials the host,
says what this machine has, and waits for orders. Nothing listens here: the link goes out,
so this machine needs no open port and no public address.

The token says which remote this machine is — one token, one machine — so there is no name
to give and none to get wrong.

  --url     where serviceman answers (env SERVICEMAN_URL):
              http://host:port, https://host:port, or a socket file as
              unix:///run/serviceman.sock — which is what an ssh forward gives you
  --token   the token of this machine, or the join token of the fleet
            (env SERVICEMAN_TOKEN)
  --tag     what this machine is, for a service that asks for a tag instead of a
            name: --tag gpu --tag eu. Only read when joining with the join token,
            and only the tags that config allows are kept (env SERVICEMAN_TAGS,
            comma separated)
  --machine which machine this is, so it takes its own entry again when it comes
            back (env SERVICEMAN_MACHINE, default the hostname)
  --dir     the folder whose free space is reported (env SERVICEMAN_DIR, default /)
  --docker  the docker command on this machine (env SERVICEMAN_DOCKER, default docker)
  --apt     what apt-get is on this machine (env SERVICEMAN_APT). Without one,
            "sudo -n apt-get", or "apt-get" where the agent is root — so a
            sudoers line on that machine may name apt-get and nothing else
  --ufw     what ufw is on this machine (env SERVICEMAN_UFW). Without one, "sudo -n
            ufw", or "ufw" where the agent is root
  --screenshot
            the line that writes a png of this screen, with %f for the file
            (env SERVICEMAN_SCREENSHOT). Without one, the usual ways are tried
            in turn and the answer says what each of them said
  --http-socket-mode
            opens the http socket beside this agent, and says who may knock at
            it, as a file mode (env SERVICEMAN_HTTP_SOCKET_MODE). Without one
            there is no socket: carrying requests in is off until it is asked
            for. Each request is routed by this machine's door table — to the
            wall in front of the name, then to the service, here or on another
            machine — with serviceman connected or not; what the table does not
            route goes to serviceman over the link. 0660 and a group is the
            usual way to let one in; 0600 is this user alone
  --peer-port
            the port other machines' agents reach this one on, over the tailnet,
            for the services that run here (env SERVICEMAN_PEER_PORT, default
            7303; 0 is none)
  --peer-host
            the address that port is opened on (env SERVICEMAN_PEER_HOST); by
            default every tailnet address this machine has, and nothing else
  --once    dial once and exit when the link drops, instead of dialling again
  --status  ask the agent running in this folder what it is doing, and print it

The same file is also the root half of a machine, and then it dials nowhere:

  --role root
            listen on a socket for the agent in the person's session and do what
            it asks, as root. Nothing reaches it from another machine: it has no
            link and no port. Kept up by the system's systemd, installed once
            with sudo on that machine.
  --for     who may ask — the socket is given to that person and to nobody else
            (env SERVICEMAN_ROOT_FOR, default $SUDO_USER)
  --root-socket
            where that socket is (env SERVICEMAN_ROOT_SOCKET,
            default /run/serviceman-root.sock). The session agent reads the same
            one, and asks it for the work that has to be root.
`;

main();

async function main()
{
    const argv = process.argv.slice(2);
    if (argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    if (argv.includes('--status')) {
        // Not an agent this time: the one that is running is asked, and what it says is printed
        process.exitCode = await agent_status_ask();
        return;
    }
    const options = options_from_argv(argv);
    if (options.role === 'root') {
        // The root half answers a socket on this machine and nothing else — no url, no token,
        // nothing to dial
        agent_root_serve(options);
        return;
    }
    const missing = missing_option(options);
    if (missing !== null) {
        console.error(`serviceman-agent: ${missing}\n\n${USAGE}`);
        process.exit(1);
    }
    // What this agent is, before it says anything else — the version and the day it was built
    // are the first questions asked of a program that runs on a machine nobody logs in to
    const boot = log_uid();
    // A group says when it began, even with no parent to name — the first thing it has to say
    // may come long after
    agent_say(boot, 'group_spawn', undefined);
    agent_say(boot, 'agent_begin', {
        agent: AGENT_VERSION,
        built: agent_built,
        node: process.version,
        machine: options.machine,
        url: options.url,
        logs: process.env.SERVICEMAN_LOG_DIR || null,
    });
    // What this agent is doing, on the machine it is doing it on. The file is refreshed as
    // things happen and on a clock besides, so a stale one means the agent itself is stuck.
    const status = {
        agent: AGENT_VERSION,
        built: agent_built,
        pid: process.pid,
        machine: options.machine,
        url: options.url,
        started_at: Date.now(),
        phase: 'dialling',
        remote: null,
        since: Date.now(),
        error: null,
        programs: {},
        // Whether this machine has a root half, asked again whenever the status is
        root: false,
        root_socket: agent_root_socket(options),
        // servermon's state: running, off, failed, with its pid and folder (agent_servermon)
        servermon: null,
    };
    agent_status_serve(status, options);
    // What an agent before this one started goes on running; it is taken back, not started again
    agent_programs_adopt(status.programs, boot);
    // What this machine collects for Logline goes on whether serviceman is there or not: the
    // settings are on its disk, and so are the lines until Logline has them
    agent_logline(options);
    // And so do its numbers: the charts of the hours serviceman was away are kept here
    agent_metrics(boot);
    // And so does servermon, the machine's load every second, written beside the agent and kept
    // running by it: it is read after the machine stopped answering, the agent included
    agent_servermon(status, boot);
    // And its uptime, counted from servermon's lines into a file of its own
    agent_uptime(boot);
    // And so does its door: the table it routes by is on its disk, and the door and the way its
    // peers reach it stand for the life of the agent, not of a link
    agent_doors_state.table = agent_doors_read();
    agent_http_serve(options, boot);
    agent_peer_serve(options, boot);
    // The machine says when it is going, and why. Silence is the one thing a host cannot read:
    // a stop, a shutdown and a network that blinked all look the same from over there.
    watch_leaving(boot);
    agent_sleep_watch(function (reason) {
        agent_say(boot, 'agent_leaving', {reason});
    });
    let wait_ms = FIRST_WAIT_MS;
    for (;;) {
        // One attempt to reach serviceman is one group: every line about this link carries its
        // uid, the way the host writes the other end of the same story
        const group = log_uid();
        agent_say(group, 'group_spawn', undefined);
        let up_at = null;
        try {
            agent_say(group, 'agent_connect_begin', {url: options.url});
            status.phase = 'dialling';
            status.since = Date.now();
            const link = await agent_connect(options);
            wait_ms = FIRST_WAIT_MS;
            up_at = Date.now();
            agent_say(group, 'agent_connect_end_ok', {remote: link.name});
            status.phase = 'online';
            status.remote = link.name;
            status.since = up_at;
            status.error = null;
            await agent_serve(options, link.socket, group, status);
            agent_say(group, 'agent_link_end', {held: format_seconds(Date.now() - up_at)});
            status.phase = 'the link closed';
        }
        catch (error) {
            agent_say(group, (up_at === null) ? 'agent_connect_end_error' : 'agent_link_end_error', {reason: error.message});
            status.phase = 'not connected';
            status.error = error.message;
            // The host says this machine is no longer part of it. Dialling again would be
            // asking the same question forever, so this agent stops — and takes itself off
            // the machine, which is what nobody being left to manage it means.
            if (error.refused === 'removed') {
                const uninstalled = await agent_uninstall(options);
                agent_say(group, uninstalled.removed ? 'agent_uninstall_ok' : 'agent_uninstall_refused', uninstalled);
                return;
            }
        }
        if (options.once) {
            return;
        }
        agent_say(group, 'agent_connect_wait', {in: format_seconds(wait_ms)});
        await timers.setTimeout(wait_ms);
        wait_ms = Math.min(wait_ms*2, LONGEST_WAIT_MS);
    }
}

// systemd asks a unit to stop with SIGTERM, and that is what a shutdown looks like from in
// here. The link is told before this process ends, so the host writes down why rather than
// waiting for the silence to run out.
function watch_leaving(group)
{
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, function () {
            agent_say(group, 'agent_leaving', {reason: 'stopping', signal});
            agent_bye('stopping');
            // Long enough for the frame to leave, and no longer: whoever sent the signal is
            // waiting
            setTimeout(function () {
                process.exit(0);
            }, 150);
        });
    }
}

function options_from_argv(argv)
{
    const env = process.env;
    return {
        url: text_after(argv, '--url', env.SERVICEMAN_URL),
        token: text_after(argv, '--token', env.SERVICEMAN_TOKEN),
        machine: text_after(argv, '--machine', env.SERVICEMAN_MACHINE || os.hostname()),
        tags: tags_from_argv(argv, env),
        dir: text_after(argv, '--dir', env.SERVICEMAN_DIR || '/'),
        docker: text_after(argv, '--docker', env.SERVICEMAN_DOCKER || 'docker'),
        apt: text_after(argv, '--apt', env.SERVICEMAN_APT || ''),
        ufw: text_after(argv, '--ufw', env.SERVICEMAN_UFW || ''),
        role: text_after(argv, '--role', env.SERVICEMAN_ROLE || ''),
        root_for: text_after(argv, '--for', env.SERVICEMAN_ROOT_FOR || ''),
        root_socket: text_after(argv, '--root-socket', env.SERVICEMAN_ROOT_SOCKET || ''),
        screenshot: text_after(argv, '--screenshot', env.SERVICEMAN_SCREENSHOT || ''),
        http_socket_mode: text_after(argv, '--http-socket-mode', env.SERVICEMAN_HTTP_SOCKET_MODE || ''),
        peer_port: text_after(argv, '--peer-port', env.SERVICEMAN_PEER_PORT || ''),
        peer_host: text_after(argv, '--peer-host', env.SERVICEMAN_PEER_HOST || ''),
        once: argv.includes('--once'),
    };
}

// Every --tag on the line, and SERVICEMAN_TAGS when there is none
function tags_from_argv(argv, env)
{
    const tags = [];
    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--tag') && (i + 1 < argv.length)) {
            tags.push(argv[i + 1]);
        }
    }
    const tags_env = String(env.SERVICEMAN_TAGS || '').split(',').map(v => v.trim()).filter(v => v !== '');
    return (tags.length === 0) ? tags_env : tags;
}

function text_after(argv, name, fallback)
{
    const at = argv.indexOf(name);
    if ((at === -1) || (at + 1 >= argv.length)) {
        return (fallback === undefined) ? '' : fallback;
    }
    return argv[at + 1];
}

function missing_option(options)
{
    if (options.url === '') {
        return '--url is required: where serviceman answers';
    }
    if (options.token === '') {
        return '--token is required: the token of this machine, from the serviceman config';
    }
    return null;
}

