import program_place from './program_place.js';
import service_command_parts from './service_command_parts.js';
import to_clipboard from './to_clipboard.js';

// How many of the lines it said the Overview shows, the newest
const LINES_SHOWN = 6;

// A service's Overview, as drawn: what runs, readable, with Copy and Edit; its newest lines; and
// its addresses, or that it has none. How long it is up and its machine's numbers are in the head
// above it, its failed starts in the note there. Nothing to set is here: its settings are their
// own tab, and Edit or Add leads there.
const service_overview = {
    template: `
<article id="detail" class="list svc-ov">
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
            return {
                globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
            };
        },
        // Whether it runs, so it has its own lines
        driven: function () {
            return (this.view.type === 'docker') || (this.view.type === 'shell');
        },
        // The user a program runs as on its machine: its agent's own; '' while it has not said
        run_user: function () {
            const found = program_place(this.view, this.remotes || []).remote;
            return ((found === null) || (found.machine === null) || (found.machine === undefined) || (typeof found.machine.user !== 'string')) ? '' : found.machine.user;
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
                if (this.run_user !== '') {
                    facts.push({text: 'as the user ', code: this.run_user});
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

export default service_overview;
