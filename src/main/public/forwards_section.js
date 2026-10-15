import fold_table from './fold_table.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import forward_end_parse from './forward_end_parse.js';
import forwards_write from './forwards_write.js';

// A port or a socket of one machine, brought to another: `from` is where the service is, `to`
// is where it shows up. The machine at `to` listens; each connection is carried over its link
// to serviceman, and over the other machine's link to `from`.
// No ssh, no key: the links are already up, and the socket stays while one of them redials.
const forwards_section = {
    template: `
<div class="forwards">
    <h1>Forwards</h1>
    <p class="muted">A port or a socket file of one machine, brought to another, as <code>ssh -L</code> brings one: <code>vps1 → laptop</code> is a service on vps1 that shows up on the laptop. The machine on the right listens — a socket only the agent's user may open, or a port on its loopback — and each connection rides both machines' links through serviceman to the service on the left. No ssh and no key: the links are already up. While a link is down the socket stays, and a connection to it is closed at once.</p>
    <fold-table v-slot="fold" :order="['acts', 'problem', 'through', 'to', 'from']">
        <table>
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Name</th>
                    <th data-fold="from">From</th>
                    <th data-fold="to">Shows up on</th>
                    <th>Now</th>
                    <th v-if="wrongs" data-fold="problem">What is wrong</th>
                    <th data-fold="through">Through it</th>
                    <th data-fold="acts" class="tick">On</th>
                    <th data-fold="acts"></th>
                </tr>
            </thead>
            <tbody>
                <template v-for="item of forwards" :key="item.name">
                    <tr :class="{off: item.off, foldable: (fold.folded.length > 0), open: fold.is_open(item.name)}" @click="fold.toggle(item.name, $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps"><code class="name">{{ item.name }}</code></td>
                        <td data-fold="from"><span class="muted">{{ title_of(item.from.remote) }} · </span><code>{{ end_text(item.from) }}</code></td>
                        <td data-fold="to"><span class="muted">{{ title_of(item.to.remote) }} · </span><code :title="(item.at === null ? '' : item.at)">{{ end_text(item.to) }}</code></td>
                        <td><span class="dot-name" :class="{bad: bad_of(item)}"><span class="dot" :class="dot_of(item)"/>{{ word_of(item) }}</span></td>
                        <td v-if="wrongs" data-fold="problem" :class="(problem_of(item) === null ? 'muted' : 'bad')">{{ wrong_text(item) }}</td>
                        <td data-fold="through" class="muted">{{ through_text(item) }}</td>
                        <td data-fold="acts" class="tick"><input type="checkbox" title="Listening, or set aside for now" :checked="(item.off === false)" :disabled="busy" @change="turn(item, $event.target.checked)"></td>
                        <td data-fold="acts">
                            <button type="button" class="link" :disabled="busy" @click="edit(item)">edit</button>
                            <button type="button" class="link" :disabled="busy" @click="drop(item)">forget it</button>
                        </td>
                    </tr>
                    <tr v-if="fold.is_open(item.name)" class="fold-more">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('from')">
                                    <dt>From</dt>
                                    <dd>{{ title_of(item.from.remote) }} · <code>{{ end_text(item.from) }}</code></dd>
                                </template>
                                <template v-if="fold.folded.includes('to')">
                                    <dt>Shows up on</dt>
                                    <dd>{{ title_of(item.to.remote) }} · <code :title="(item.at === null ? '' : item.at)">{{ end_text(item.to) }}</code></dd>
                                </template>
                                <template v-if="(fold.folded.includes('problem') && wrong_text(item) !== '')">
                                    <dt>What is wrong</dt>
                                    <dd :class="(problem_of(item) === null ? 'muted' : 'bad')">{{ wrong_text(item) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('through')">
                                    <dt>Through it</dt>
                                    <dd class="muted">{{ through_text(item) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('acts')">
                                    <dt>On</dt>
                                    <dd class="fold-actions">
                                        <label><input type="checkbox" :checked="(item.off === false)" :disabled="busy" @change="turn(item, $event.target.checked)"> Listening</label>
                                        <button type="button" class="link" :disabled="busy" @click="edit(item)">edit</button>
                                        <button type="button" class="link" :disabled="busy" @click="drop(item)">forget it</button>
                                    </dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(forwards.length === 0)">
                    <td class="muted" colspan="8">No forwards yet. Add one below: a socket on the laptop, say, answered by a port on a server.</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <div class="rule-add">
        <input v-model.trim="fresh.name" class="short" placeholder="loki" spellcheck="false" title="A name for it: lowercase letters, digits, - and _" @keyup.enter="write">
        <select v-model="fresh.from_remote">
            <option value="">from</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.from" placeholder="3100" spellcheck="false" title="Where the service is: a port on its loopback, an address it reaches (10.0.0.5:3100), or a socket file" @keyup.enter="write">
        <span class="muted">→</span>
        <select v-model="fresh.to_remote">
            <option value="">shows up on</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.to" placeholder="~/repos/loki.sock or 3100" spellcheck="false" title="Where it shows up: a socket file there (~/ is the agent's user's home), or a port on its loopback" @keyup.enter="write">
        <button type="button" :disabled="(busy || fresh.name === '' || fresh.from_remote === '' || fresh.from === '' || fresh.to_remote === '' || fresh.to === '')" @click="write">{{ (editing === null ? 'Add' : 'Save') }}</button>
        <button v-if="(editing !== null)" type="button" :disabled="busy" @click="clear">Cancel</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</div>
`,
    components: {'fold-table': fold_table},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the forward the line below is rewriting, by the name it had
        return {fresh: fresh_empty(), editing: null, note: '', bad: false, busy: false};
    },
    computed: {
        forwards: function () {
            return (((this.state === null) || (this.state.forwards === undefined)) ? [] : this.state.forwards);
        },
        // Whether any forward has something wrong to tell, now or last time: else no column for it
        wrongs: function () {
            return this.forwards.some(v => this.wrong_text(v) !== '');
        },
        machines: function () {
            return ((this.state === null) ? [] : this.state.remotes);
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.title || v.name)}));
        },
    },
    methods: {
        // Where it stands, in a word or two; the whole of it is under What is wrong
        word_of: function (item) {
            const words = {
                ready: 'ready',
                aside: 'set aside',
                old_agent: 'agent too old',
                telling: 'starting',
                from_offline: `${this.title_of(item.from.remote)} offline`,
                cannot_listen: 'cannot listen',
                link_down: `${this.title_of(item.to.remote)} link down`,
                to_offline: `${this.title_of(item.to.remote)} offline`,
            };
            return ((words[item.state] === undefined) ? item.state : words[item.state]);
        },
        dot_of: function (item) {
            if (item.state === 'ready') {
                return 'running';
            }
            if (item.state === 'telling') {
                return 'starting';
            }
            return ((item.state === 'aside') ? '' : 'failed');
        },
        bad_of: function (item) {
            return ['ready', 'aside', 'telling'].includes(item.state) === false;
        },
        // What stands in its way now, in full, where its word on the line does not say it all;
        // null when nothing does
        problem_of: function (item) {
            if ((item.problem === null) || item.off || ['from_offline', 'to_offline'].includes(item.state)) {
                return null;
            }
            return item.problem;
        },
        // What stands in its way now, else the last failure, else nothing
        wrong_text: function (item) {
            const problem = this.problem_of(item);
            if (problem !== null) {
                return problem;
            }
            return ((item.error === null) ? '' : `last failure ${this.ago(item.error_at)}: ${item.error}`);
        },
        through_text: function (item) {
            if (item.total === 0) {
                return 'nothing yet';
            }
            return `${item.open} open · ${item.total} in all · ↑ ${this.bytes(item.bytes_sent)} ↓ ${this.bytes(item.bytes_back)}`;
        },
        title_of: function (name) {
            const found = this.machines.find(v => v.name === name);
            return ((found === undefined) ? name : (found.title || found.name));
        },
        end_text: function (end) {
            if (end.socket !== null) {
                return end.socket;
            }
            return ((end.host === null) ? String(end.port) : `${end.host}:${end.port}`);
        },
        bytes: function (value) {
            return format_bytes(value);
        },
        ago: function (at) {
            return format_ms_ago(this.state.now - at);
        },
        // One forward written, new or the one being edited, which may have been renamed
        write: async function () {
            const fresh = this.fresh;
            const from = forward_end_parse(fresh.from_remote, fresh.from);
            const to = forward_end_parse(fresh.to_remote, fresh.to);
            if (typeof from === 'string') {
                this.report(`from: ${from}`, true);
                return;
            }
            if (typeof to === 'string') {
                this.report(`shows up on: ${to}`, true);
                return;
            }
            if (to.host !== undefined) {
                this.report('shows up on: a port or a socket on that machine — it listens on its loopback, not on an address', true);
                return;
            }
            const editing = this.editing;
            const written = await this.forwards_write(function (forwards) {
                const at = forwards.findIndex(v => v.name === ((editing === null) ? fresh.name : editing.name));
                const kept = (((at === -1) || (editing === null)) ? false : (forwards[at].off === true));
                const forward = Object.assign({name: fresh.name, from, to}, (kept ? {off: true} : {}));
                if ((editing === null) || (at === -1)) {
                    forwards.push(forward);
                    return;
                }
                forwards[at] = forward;
            });
            if (written) {
                this.clear();
            }
        },
        edit: function (item) {
            this.editing = item;
            this.fresh = {name: item.name, from_remote: item.from.remote, from: this.end_text(item.from), to_remote: item.to.remote, to: this.end_text(item.to)};
            this.report('', false);
        },
        clear: function () {
            this.editing = null;
            this.fresh = fresh_empty();
        },
        // Set aside for now, and put back later, without retyping either end
        turn: async function (item, on) {
            await this.forwards_write(function (forwards) {
                const found = forwards.find(v => v.name === item.name);
                if (found === undefined) {
                    return;
                }
                if (on) {
                    delete found.off;
                }
                else {
                    found.off = true;
                }
            });
        },
        drop: async function (item) {
            if ((this.editing !== null) && (this.editing.name === item.name)) {
                this.clear();
            }
            await this.forwards_write(function (forwards) {
                const at = forwards.findIndex(v => v.name === item.name);
                if (at !== -1) {
                    forwards.splice(at, 1);
                }
            });
        },
        forwards_write: async function (change) {
            this.busy = true;
            this.report('', false);
            const error = await forwards_write(change);
            this.busy = false;
            if (error !== null) {
                this.report(error, true);
                return false;
            }
            return true;
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

function fresh_empty()
{
    return {name: '', from_remote: '', from: '', to_remote: '', to: ''};
}

export default forwards_section;
