import clock_of from './clock_of.js';
import format_ms from './format_ms.js';
import machine_shares from './machine_shares.js';
import overview_icons from './overview_icons.js';
import service_command_parts from './service_command_parts.js';
import size_words from './size_words.js';
import to_clipboard from './to_clipboard.js';

// How many of the lines it said the Overview shows, the newest
const LINES_SHOWN = 6;

// A service's Overview, as drawn: four tiles (how long it is up, its last start or its requests,
// how often it failed to start and what it does then, and its machine's numbers), then what runs,
// readable, with Copy and Edit; its newest lines; and its addresses, or that it has none. Nothing
// to set is here: its settings are their own tab, and Edit or Add leads there.
const service_overview = {
    template: `
<article id="detail" class="list svc-ov">
    <div class="ov-tiles">
        <div v-for="tile of tiles" :key="tile.label" class="card ov-tile" :class="(tile.tone === '') ? '' : ('ov-' + tile.tone)">
            <span class="ov-label"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icons[tile.icon]"/>{{ tile.label }}</span>
            <b>{{ tile.text }}<small v-if="(tile.unit !== '')">{{ tile.unit }}</small></b>
            <small class="muted">{{ tile.note }}</small>
        </div>
        <div v-if="(machine !== null)" class="card ov-tile svc-machine">
            <span class="ov-label"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icons.server"/>{{ machine.name }}</span>
            <span v-for="row of machine.rows" :key="row.label" class="svc-meter-row"><span>{{ row.label }}</span><span class="meter"><i :style="{width: (Math.round(row.share*100) + '%')}"/></span><span>{{ Math.round(row.share*100) }}%</span></span>
            <small class="muted">{{ machine.note }}</small>
        </div>
    </div>
    <div class="svc-ov-grid">
        <section class="card svc-runs">
            <div class="card-head">
                <h2><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>What runs</h2>
                <span class="svc-head-acts">
                    <button v-if="(runs.line !== '')" type="button" class="link" @click="line_copy"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>{{ copied ? 'Copied' : 'Copy' }}</button>
                    <button type="button" class="link" @click="$emit('settings', 'runs')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/></svg>Edit</button>
                </span>
            </div>
            <div class="svc-facts">
                <span v-for="fact of runs.facts" :key="fact.text">{{ fact.text }}<code v-if="(fact.code !== '')">{{ fact.code }}</code></span>
            </div>
            <div class="svc-command">
                <div class="svc-program"><span v-if="(runs.lead !== '')" class="muted">{{ runs.lead + ' ' }}</span><span class="svc-program-name">{{ runs.program }}</span></div>
                <div v-if="(runs.options.length > 0)" class="svc-chips">
                    <code v-for="(option, index) of runs.options" :key="index" class="svc-chip"><span class="muted">{{ option.flag }}</span>{{ ((option.flag !== '') && (option.value !== '')) ? ' ' : '' }}{{ option.value }}</code>
                </div>
            </div>
        </section>
        <div class="svc-ov-side">
            <section v-if="lines_shown" class="card svc-lines">
                <div class="card-head">
                    <h2><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 11h11M4 16h16M4 21h8"/></svg>Its newest lines</h2>
                    <button type="button" class="link" @click="$emit('logs')">All logs →</button>
                </div>
                <pre v-if="(lines.length > 0)" class="svc-tail">{{ lines.join('\\n') }}</pre>
                <p v-else class="muted svc-none">Nothing said yet{{ (view.phase === 'running') ? '' : ': it says its lines once it runs' }}.</p>
            </section>
            <section class="card svc-addr">
                <template v-if="(addresses.length > 0)">
                    <div class="card-head">
                        <h2><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icons.globe"/>Addresses</h2>
                        <button type="button" class="link" @click="$emit('settings', 'address')">+ Add</button>
                    </div>
                    <div v-for="item of addresses" :key="item.key" class="svc-addr-row" :class="{muted: item.off}">
                        <a v-if="(item.url !== '')" class="mono" :href="item.url" target="_blank" rel="noopener">{{ item.host }}</a>
                        <code v-else>{{ item.host }}</code>
                        <span class="muted">{{ item.said }}</span>
                    </div>
                </template>
                <div v-else class="svc-addr-none">
                    <span class="kt-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icons.globe"/></span>
                    <span><b>No address</b><span class="muted">{{ none_said }}</span></span>
                    <button v-if="(view.type !== 'files')" type="button" class="link" @click="$emit('settings', 'address')">+ Add</button>
                </div>
                <div v-for="item of forwards" :key="item.label" class="svc-addr-row">
                    <span>its port → <template v-if="item.to.here">this host</template><button v-else type="button" class="link" @click="$emit('remote', item.to.remote)">{{ item.to.remote }}</button></span>
                    <code class="muted">{{ end_text(item.to) }}</code>
                </div>
            </section>
        </div>
    </div>
</article>
`,
    // original: its entry in the config, for what runs as it is written; forwards: the
    // forwards of the status that bring its port over
    props: ['view', 'original', 'remotes', 'port', 'forwards'],
    emits: ['logs', 'remote', 'settings'],
    data: function () {
        return {copied: false};
    },
    computed: {
        icons: function () {
            return Object.assign({}, overview_icons, {
                server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>',
                globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
                bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
                again: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 2.5v4.2h-4.2"/>',
            });
        },
        // Whether it runs, so it has a time up, a last start and its own lines
        driven: function () {
            return (this.view.type === 'docker') || (this.view.type === 'shell');
        },
        // Up for, its last start or its requests, its failed starts: each {label, icon, text,
        // unit, note, tone}
        tiles: function () {
            const view = this.view;
            const out = [];
            if (this.driven) {
                if ((view.phase === 'running') && (view.uptime_ms !== null)) {
                    const up = parts_of(view.uptime_ms);
                    // Several copies at once: how many run of how many it may have
                    const copies = (view.policy.instances.max > 1) ? ` · ${view.instances_running} of ${view.policy.instances.max} copies` : '';
                    out.push({label: 'Up for', icon: 'clock', text: up.n, unit: up.unit, note: `${(view.started_at === null) ? '' : `since ${clock_of(view.started_at)}`}${copies}`, tone: ''});
                }
                else {
                    out.push({label: 'Up for', icon: 'clock', text: '—', unit: '', note: ((view.stopped_at === null) || (view.stopped_at === undefined)) ? 'not running' : `stopped since ${clock_of(view.stopped_at)}`, tone: 'off'});
                }
            }
            if (view.publish.hosts.length > 0) {
                out.push({label: 'Requests', icon: 'link', text: count_words(view.requests), unit: '', note: `served · ${view.inflight} in flight${(view.queue > 0) ? ` · ${view.queue} waiting` : ''}`, tone: ''});
            }
            else if (this.driven) {
                const took = (view.cold_start_ms === null) ? null : parts_of(view.cold_start_ms);
                out.push({label: 'Last start', icon: 'bolt', text: (took === null) ? '—' : took.n, unit: (took === null) ? '' : took.unit, note: (took === null) ? 'not started since serviceman began' : 'from Start to running', tone: (took === null) ? 'off' : ''});
            }
            if (this.driven) {
                out.push({label: 'Failed starts', icon: 'again', text: String(view.failures || 0), unit: '', note: `in a row · ${restart_said(view.policy.restart)}`, tone: ((view.failures || 0) > 0) ? 'bad' : ''});
            }
            return out;
        },
        // Its machine's numbers, the whole machine's, labelled so; null with none to show
        machine: function () {
            if ((this.driven === false) || (this.view.remotes.length === 0)) {
                return null;
            }
            const remote = (this.remotes || []).find(v => v.name === this.view.remotes[0]);
            if ((remote === undefined) || (remote.phase !== 'online') || (remote.machine === null) || (remote.machine === undefined)) {
                return null;
            }
            const shares = machine_shares(remote.machine);
            const rows = [{label: 'CPU', share: shares.cpu}, {label: 'Memory', share: shares.memory}, {label: 'Disk', share: shares.disk}].filter(v => v.share !== null);
            if (rows.length === 0) {
                return null;
            }
            const mem = remote.machine.mem;
            const note = ((mem.free === null) || (mem.total === null)) ? 'the whole machine' : `the whole machine: ${size_words(mem.total - mem.free)} of ${size_words(mem.total)} memory`;
            return {name: remote.name, rows, note};
        },
        // What runs, readable: its facts in a line, the program on a line of its own, each
        // option with its value as a chip; line is what Copy takes
        runs: function () {
            const view = this.view;
            const entry = (this.original === null) ? {} : this.original;
            if (view.type === 'shell') {
                const line = ((typeof entry.command === 'string') && (entry.command !== '')) ? entry.command : ((Array.isArray(entry.argv)) ? entry.argv.join(' ') : view.source.text);
                const parts = service_command_parts(line);
                const facts = [];
                if ((view.folder !== null) && (view.folder !== undefined)) {
                    facts.push({text: 'in ', code: view.folder});
                }
                if (parts.group !== '') {
                    facts.push({text: 'as the group ', code: parts.group});
                }
                facts.push({text: 'on the machine itself, no image', code: ''});
                facts.push({text: (parts.options.length === 1) ? '1 option' : `${parts.options.length} options`, code: ''});
                return {line, lead: parts.lead, program: parts.program, options: parts.options, facts};
            }
            if (view.type === 'docker') {
                const args = Array.isArray(entry.args) ? entry.args : [];
                const facts = [{text: 'the image ', code: view.image}];
                if (view.publish.port !== null) {
                    facts.push({text: `port ${view.publish.port} inside`, code: ''});
                }
                return {line: [view.image].concat(args).join(' '), lead: '', program: view.image, options: service_command_parts(args.join(' ')).options, facts};
            }
            return {line: '', lead: '', program: view.source.text, options: [], facts: [{text: view.source.label, code: ''}]};
        },
        lines_shown: function () {
            return this.driven;
        },
        lines: function () {
            return ((this.view.said === undefined) ? [] : this.view.said).slice(-LINES_SHOWN);
        },
        // Its own addresses and the names machines' doors answer for it, each with who may open it
        addresses: function () {
            const out = [];
            const wall = (this.view.auth === null) ? 'anyone' : `signed in only · ${this.view.auth}`;
            const doors = this.door_names;
            for (const host of this.view.publish.hosts.filter(v => doors.every(vv => vv.host !== v))) {
                out.push({key: `own ${host}`, host, url: this.address_of(host), said: wall, off: false});
            }
            for (const item of doors) {
                out.push({key: `door ${item.machine} ${item.host}`, host: item.host, url: item.host.startsWith('*') ? '' : `https://${item.host}`, said: `via ${item.machine}${(item.auth === null) ? '' : ` · behind ${item.auth}`}${item.off ? ' · off' : ''}`, off: item.off});
            }
            return out;
        },
        // The names a machine's door answers for this service, beside its own
        door_names: function () {
            const out = [];
            for (const item of (this.remotes || [])) {
                const inbound = (item.inbound === undefined) ? {} : item.inbound;
                for (const host of Object.keys(inbound)) {
                    const rule = (typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host];
                    // The wall it stands behind at every address comes first: the door's is not asked
                    const auth = (this.view.auth !== null) ? this.view.auth : ((rule.auth === undefined) ? null : rule.auth);
                    if (rule.service === this.view.name) {
                        out.push({machine: item.name, host, off: (rule.off === true), auth});
                    }
                    // A rule of "*" answers each of its names with the service whose own address it is
                    if (rule.service === '*') {
                        for (const own of this.view.publish.hosts.map(v => v.split('/')[0]).filter(v => (v === host) || (host.startsWith('*.') && v.endsWith(host.slice(1)) && (v.length > host.length - 1)))) {
                            out.push({machine: item.name, host: own, off: (rule.off === true), auth});
                        }
                    }
                }
            }
            return out;
        },
        none_said: function () {
            if (this.view.type === 'files') {
                return 'nothing reaches its files';
            }
            return 'it only runs; nothing reaches it from outside its machine';
        },
    },
    methods: {
        address_of: function (host) {
            const mark = host.indexOf('/');
            const hostname = (mark === -1) ? host : host.slice(0, mark);
            const prefix = (mark === -1) ? '' : host.slice(mark);
            return (this.port === 80) ? `http://${hostname}${prefix}` : `http://${hostname}:${this.port}${prefix}`;
        },
        // One end of a forward as the config writes it: a socket file, or a port on the loopback
        end_text: function (forward_end) {
            if (forward_end.socket !== null) {
                return forward_end.socket;
            }
            return (forward_end.host === null) ? String(forward_end.port) : `${forward_end.host}:${forward_end.port}`;
        },
        line_copy: async function () {
            if (await to_clipboard(this.runs.line)) {
                this.copied = true;
                setTimeout(this.copied_forget, 1500);
            }
        },
        copied_forget: function () {
            this.copied = false;
        },
    },
};

// A time as a tile says it, its number and its unit apart: {n: '58', unit: 's'}
function parts_of(ms)
{
    const said = format_ms(ms);
    const found = /^([\d.]+)\s*([a-zµ]+)(.*)$/i.exec(said);
    return (found === null) ? {n: said, unit: ''} : {n: found[1], unit: `${found[2]}${found[3]}`};
}

// A count as a tile says it: 4100 is 4.1k
function count_words(n)
{
    if (n >= 1000000) {
        return `${(n/1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n/1000).toFixed(1)}k`;
    }
    return String(n);
}

// What it does when it stops badly, in words
function restart_said(restart)
{
    if ((restart === 'no') || (restart === false) || (restart === null)) {
        return 'it stays stopped when it stops badly';
    }
    if (restart === 'always') {
        return 'it restarts whenever it stops';
    }
    return 'it restarts when it stops badly';
}

export default service_overview;
