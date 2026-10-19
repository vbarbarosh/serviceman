#!/usr/bin/env node

// Appends the machine's load every INTERVAL seconds, one JSON object per
// line, to DIR/YYYYMMDD.jsonl, a new file each day, the last DAYS kept: read
// after the server stops answering. Linux only: reads /proc and statfs, and
// pings with the system ping. The agent writes it beside itself and keeps it
// running (agent_servermon); it needs node and nothing else.
const child_process = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DAYS = Number(process.env.DAYS || 30);
const DIR = process.env.DIR || path.join(__dirname, 'logs', 'servermon');
const INTERNET_HOSTS = ['1.1.1.1', '8.8.8.8'];
const INTERVAL = Number(process.env.INTERVAL || 1);
const TZ = process.env.TZ || 'Europe/Chisinau';
// When the machine booted, in seconds: a gap between two lines with different ones is a reboot
const BOOT = boot_read();

main();

async function main()
{
    fs.mkdirSync(DIR, {recursive: true});
    console.error(`servermon: a line every ${INTERVAL} s into ${DIR}`);
    let prev = null;
    let file = null;
    while (true) {
        const next = await snapshot_take();
        const next_file = path.join(DIR, `${day_from_time(next.time)}.jsonl`);
        if (next_file !== file) {
            file = next_file;
            logs_prune(next.time);
        }
        fs.appendFileSync(file, `${json_from_snapshots(prev, next)}\n`);
        prev = next;
        // Waits for the next whole interval: lines stay on :00, :01... and never
        // drift. A timer may wake a millisecond early: then it waits the rest.
        const next_time = (Math.floor(next.time/(INTERVAL*1000)) + 1)*INTERVAL*1000;
        while (Date.now() < next_time) {
            await sleep(next_time - Date.now());
        }
    }
}

// The pings run while the rest is read.
async function snapshot_take()
{
    const time = Date.now();
    const pings = pings_send();
    return {
        time,
        cpu: cpu_read(),
        load: Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]),
        mem: mem_read(),
        pressure: pressure_read(),
        mounts: mounts_read(),
        disks: disks_read(),
        nets: nets_read(),
        temperature: temperature_read(),
        battery: battery_read(),
        tcp: tcp_read(),
        conntrack: conntrack_read(),
        pings: await pings,
    };
}

// btime of /proc/stat: the moment the machine booted, in seconds since 1970
function boot_read()
{
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n').find(v => v.startsWith('btime '));
    return (line === undefined) ? null : Number(line.split(' ')[1]);
}

// The first line of /proc/stat: time spent since boot, in ticks.
// Waiting for the disk (iowait) counts as idle; steal is time the VPS host
// gave to other machines.
function cpu_read()
{
    const ticks = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1, 9).map(Number);
    return {idle: ticks[3] + ticks[4], steal: ticks[7], total: ticks.reduce((a, b) => a + b, 0)};
}

function mem_read()
{
    const kb_by_name = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)/);
        if (m) {
            kb_by_name[m[1]] = Number(m[2]);
        }
    }
    return {
        total: kb_by_name.MemTotal*1024,
        available: kb_by_name.MemAvailable*1024,
        swap_used: (kb_by_name.SwapTotal - kb_by_name.SwapFree)*1024,
    };
}

// The percent of the last 10 seconds some task waited for the CPU, memory
// or disk; null on a kernel without /proc/pressure.
function pressure_read()
{
    if (!fs.existsSync('/proc/pressure')) {
        return null;
    }
    const out = {};
    for (const name of ['cpu', 'memory', 'io']) {
        out[name] = Number(fs.readFileSync(`/proc/pressure/${name}`, 'utf8').match(/avg10=([\d.]+)/)[1]);
    }
    return out;
}

// The root and every mount of a real block device, one line per file
// system: a bind mount or a container's overlay shows the same numbers.
// A ZFS pool is one line too, though its folders (datasets) are mounted
// apart: they share the pool's free room, so the line is their used space
// added up and that room once, at the first of their paths, with the pool
// named. /proc/mounts writes a space in a path as \040; a mount gone before
// it is read is left out.
function mounts_read()
{
    const mount_paths = [];
    const datasets_by_pool = {};
    for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
        const [source, target, type] = line.split(' ');
        if (!source) {
            continue;
        }
        const mount_path = target.replace(/\\([0-7]{3})/g, (_, v) => String.fromCharCode(parseInt(v, 8)));
        if ((type === 'zfs') && !source.includes('@')) {
            const pool = source.split('/')[0];
            datasets_by_pool[pool] = datasets_by_pool[pool] || new Map();
            if (!datasets_by_pool[pool].has(source)) {
                datasets_by_pool[pool].set(source, mount_path);
            }
        }
        else if ((mount_path === '/') || (source.startsWith('/dev/') && !source.startsWith('/dev/loop'))) {
            mount_paths.push(mount_path);
        }
    }
    // The root first, so a disk it shares with a bind mount is named "/"
    const pools = Object.keys(datasets_by_pool);
    if (!pools.some(v => [...datasets_by_pool[v].values()].includes('/'))) {
        mount_paths.splice(0, mount_paths.length, '/', ...mount_paths.filter(v => v !== '/'));
    }
    const out = [];
    const seen_keys = new Set();
    for (const mount_path of mount_paths) {
        const stat = statfs_read(mount_path);
        const key = stat && `${stat.blocks}:${stat.files}:${stat.ffree}`;
        if (stat && !seen_keys.has(key)) {
            seen_keys.add(key);
            out.push({path: mount_path, size: stat.blocks*stat.bsize, free: stat.bavail*stat.bsize});
        }
    }
    for (const pool of pools) {
        const paths = [...datasets_by_pool[pool].values()].sort((a, b) => a.length - b.length);
        let used = 0;
        let free = null;
        for (const dataset_path of paths) {
            const stat = statfs_read(dataset_path);
            if (stat) {
                used += (stat.blocks - stat.bfree)*stat.bsize;
                free = stat.bavail*stat.bsize;
            }
        }
        if (free !== null) {
            out.push({path: paths[0], pool, size: used + free, free});
        }
    }
    return out;
}

function statfs_read(mount_path)
{
    try {
        return fs.statfsSync(mount_path);
    }
    catch {
        return null;
    }
}

// Physical disks only (those with a device/ in /sys/block): no loop, ram
// or device-mapper. busy_ms is the time the disk spent doing I/O; read and written are bytes,
// counted in sectors of 512 bytes whatever the disk's own.
function disks_read()
{
    const names = fs.readdirSync('/sys/block').filter(v => fs.existsSync(`/sys/block/${v}/device`));
    const out = [];
    for (const line of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (names.includes(fields[2])) {
            out.push({name: fields[2], busy_ms: Number(fields[12]), read: Number(fields[5])*512, written: Number(fields[9])*512});
        }
    }
    return out;
}

// Every interface but loopback and the per-container ones Docker adds.
function nets_read()
{
    const out = [];
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
        const m = line.match(/^\s*([^:]+):\s*(.*)$/);
        if (!m || (m[1] === 'lo') || /^(veth|br-|docker|virbr)/.test(m[1])) {
            continue;
        }
        const fields = m[2].split(/\s+/).map(Number);
        out.push({
            name: m[1],
            in_bytes: fields[0],
            out_bytes: fields[8],
            drops: fields[3] + fields[11],
            errors: fields[2] + fields[10],
        });
    }
    return out;
}

// The hottest sensor that reads sanely, in °C, and what it is; null with none
function temperature_read()
{
    let out = null;
    for (const name of names_read('/sys/class/thermal').filter(v => v.startsWith('thermal_zone'))) {
        const c = Math.round(Number(line_read(`/sys/class/thermal/${name}/temp`))/1000);
        if (Number.isFinite(c) && (c > 0) && (c <= 150) && ((out === null) || (c > out.c))) {
            out = {c, of: line_read(`/sys/class/thermal/${name}/type`) || name};
        }
    }
    return out;
}

// The first battery: percent charged and charging, discharging or full; null with none
function battery_read()
{
    for (const name of names_read('/sys/class/power_supply')) {
        const dir = `/sys/class/power_supply/${name}`;
        const percent = Number.parseInt(line_read(`${dir}/capacity`), 10);
        if ((line_read(`${dir}/type`) === 'Battery') && Number.isFinite(percent)) {
            return {percent, status: (line_read(`${dir}/status`) || 'unknown').toLowerCase()};
        }
    }
    return null;
}

function names_read(dir)
{
    try {
        return fs.readdirSync(dir).sort();
    }
    catch {
        return [];
    }
}

function line_read(file)
{
    try {
        return fs.readFileSync(file, 'utf8').trim();
    }
    catch {
        return '';
    }
}

// open: established now; half_open: SYN received, the handshake not
// finished (many of them is a SYN flood); refused: connections dropped at
// a full listen queue since boot.
function tcp_read()
{
    let half_open = 0;
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
        if (fs.existsSync(file)) {
            half_open += fs.readFileSync(file, 'utf8').split('\n').filter(v => v.trim().split(/\s+/)[3] === '03').length;
        }
    }
    return {
        open: counters_read('/proc/net/snmp', 'Tcp').CurrEstab,
        half_open,
        refused: counters_read('/proc/net/netstat', 'TcpExt').ListenDrops,
    };
}

// /proc/net/snmp and /proc/net/netstat: a line of names, then a line of
// values, both starting with the same prefix.
function counters_read(file, prefix)
{
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(v => v.startsWith(`${prefix}:`));
    const names = lines[0].split(/\s+/).slice(1);
    const values = lines[1].split(/\s+/).slice(1).map(Number);
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

// The kernel's table of tracked connections: when full, every new
// connection is dropped without a word. null when the firewall does not
// track connections.
function conntrack_read()
{
    const dir = '/proc/sys/net/netfilter';
    if (!fs.existsSync(`${dir}/nf_conntrack_count`)) {
        return null;
    }
    return {
        count: Number(fs.readFileSync(`${dir}/nf_conntrack_count`, 'utf8')),
        max: Number(fs.readFileSync(`${dir}/nf_conntrack_max`, 'utf8')),
    };
}

// The gateway tells whether the provider's network around the machine is
// up; two internet hosts, so one provider down is not an outage. ms is null
// for a ping lost, or slower than the interval leaves room for.
function pings_send()
{
    const limit_ms = Math.min(1000, (INTERVAL*1000) - 100);
    const targets = [{link: 'gateway', host: gateway_read()}, ...INTERNET_HOSTS.map(v => ({link: 'internet', host: v}))];
    return Promise.all(targets.map(async function (target) {
        return {link: target.link, host: target.host, ms: target.host ? await ping_once(target.host, limit_ms) : null};
    }));
}

// The default route's gateway, from /proc/net/route (hex, little-endian);
// null with no default route or one without a gateway.
function gateway_read()
{
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
        const fields = line.split('\t');
        if ((fields[1] === '00000000') && (fields[7] === '00000000') && (fields[2] !== '00000000')) {
            return [6, 4, 2, 0].map(v => parseInt(fields[2].slice(v, v + 2), 16)).join('.');
        }
    }
    return null;
}

// One ICMP echo with the system ping: its time in ms, or null.
function ping_once(host, limit_ms)
{
    return new Promise(function (resolve) {
        child_process.execFile('ping', ['-n', '-c1', '-W1', host], {timeout: limit_ms}, function (error, stdout) {
            const m = stdout.match(/time=([\d.]+) ms/);
            resolve((!error && m) ? Number(m[1]) : null);
        });
    });
}

// Deletes the day files older than DAYS days.
function logs_prune(time)
{
    const oldest = day_from_time(time - (DAYS*86400*1000));
    for (const name of fs.readdirSync(DIR)) {
        const m = name.match(/^(\d{8})\.jsonl$/);
        if (m && (m[1] < oldest)) {
            fs.rmSync(path.join(DIR, name));
        }
    }
}

// One object: the time in TZ with its offset, then plain numbers: percents
// 0-100, sizes in bytes, disks and network in bytes per second, pings in ms.
// The first line has no line before it: what is counted over the interval
// (cpu, steal, busy, read, write, in, out, drops, errors, refused) is null
// there.
function json_from_snapshots(prev, next)
{
    const seconds = prev ? ((next.time - prev.time)/1000) : null;
    const cpu_total = prev ? (next.cpu.total - prev.cpu.total) : 0;
    const disks = next.disks.map(function (disk) {
        const before = prev && prev.disks.find(v => v.name === disk.name);
        if (!before) {
            return {name: disk.name, busy: null, read: null, write: null};
        }
        return {
            name: disk.name,
            busy: percent_from_ratio((disk.busy_ms - before.busy_ms)/(seconds*1000)),
            read: Math.round((disk.read - before.read)/seconds),
            write: Math.round((disk.written - before.written)/seconds),
        };
    });
    const nets = next.nets.map(function (net) {
        const before = prev && prev.nets.find(v => v.name === net.name);
        if (!before) {
            return {name: net.name, in: null, out: null, drops: null, errors: null};
        }
        return {
            name: net.name,
            in: Math.round((net.in_bytes - before.in_bytes)/seconds),
            out: Math.round((net.out_bytes - before.out_bytes)/seconds),
            drops: net.drops - before.drops,
            errors: net.errors - before.errors,
        };
    });
    return JSON.stringify({
        time: iso_from_time(next.time),
        boot: BOOT,
        cpu: cpu_total ? percent_from_ratio(1 - (next.cpu.idle - prev.cpu.idle)/cpu_total) : null,
        steal: cpu_total ? percent_from_ratio((next.cpu.steal - prev.cpu.steal)/cpu_total) : null,
        load: next.load,
        mem_used: next.mem.total - next.mem.available,
        mem_total: next.mem.total,
        swap_used: next.mem.swap_used,
        wait: next.pressure,
        mounts: next.mounts.map(v => Object.assign({path: v.path, used: v.size - v.free, size: v.size}, v.pool ? {pool: v.pool} : {})),
        disks,
        nets,
        tcp: {open: next.tcp.open, half_open: next.tcp.half_open, refused: prev ? (next.tcp.refused - prev.tcp.refused) : null},
        conntrack: next.conntrack,
        temperature: next.temperature,
        battery: next.battery,
        pings: next.pings,
    });
}

// 2026-10-18T19:53:01+03:00
function iso_from_time(time)
{
    const date = new Date(time);
    const local = date.toLocaleString('sv-SE', {timeZone: TZ}).replace(' ', 'T');
    const offset = new Intl.DateTimeFormat('en', {timeZone: TZ, timeZoneName: 'longOffset'}).formatToParts(date).find(v => v.type === 'timeZoneName').value;
    return `${local}${offset.slice(3) || '+00:00'}`;
}

// 20261018, in TZ: the day a line belongs to
function day_from_time(time)
{
    return new Date(time).toLocaleString('sv-SE', {timeZone: TZ}).slice(0, 10).replaceAll('-', '');
}

function percent_from_ratio(ratio)
{
    return Math.round(Math.min(Math.max(ratio, 0), 1)*1000)/10;
}

function sleep(ms)
{
    return new Promise(v => setTimeout(v, ms));
}
