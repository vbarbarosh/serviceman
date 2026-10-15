import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import forward_end_parse from './forward_end_parse.js';
import forwards_write from './forwards_write.js';

// A port or a socket on one machine, answered on another. The machine at `from` listens; each
// connection is carried over its link to serviceman, and over the other machine's link to `to`.
// No ssh, no key: the links are already up, and the socket stays while one of them redials.
const forwards_section = {
    template: `
<section class="forwards">
    <h1>Forwards</h1>
    <p class="muted">A port or a socket file on one machine, answered by a port or a socket on another. The machine on the left listens — a socket only the agent's user may open, or a port on its loopback — and each connection rides both machines' links through serviceman to the right. No ssh and no key: the links are already up. While a link is down the socket stays, and a connection to it is closed at once.</p>
    <div class="wide-scroll">
        <table class="grid-table rules forwards">
            <colgroup>
                <col width="120">
                <col>
                <col>
                <col width="230">
                <col width="150">
                <col width="50">
                <col width="130">
            </colgroup>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Listens on</th>
                    <th>Carried to</th>
                    <th>Now</th>
                    <th>Through it</th>
                    <th class="tick">On</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="item of forwards" :key="item.name" :class="{off: item.off}">
                    <td><code>{{ item.name }}</code></td>
                    <td><span class="muted">{{ title_of(item.from.remote) }} · </span><code :title="(item.at === null ? '' : item.at)">{{ end_text(item.from) }}</code></td>
                    <td><span class="muted">{{ title_of(item.to.remote) }} · </span><code>{{ end_text(item.to) }}</code></td>
                    <td>
                        <span class="dot-name" :class="{bad: (item.problem !== null && item.off === false)}"><span class="dot" :class="(item.problem === null ? 'running' : 'stopped')"/>{{ (item.problem === null ? 'ready' : item.problem) }}</span>
                        <div v-if="(item.error !== null)" class="muted small" :title="item.error">last failure {{ ago(item.error_at) }}: {{ item.error }}</div>
                    </td>
                    <td v-if="(item.total === 0)" class="muted">nothing yet</td>
                    <td v-else class="muted">
                        <div>{{ item.open }} open · {{ item.total }} in all</div>
                        <div title="sent to the far end, and back">↑ {{ bytes(item.bytes_to) }} ↓ {{ bytes(item.bytes_from) }}</div>
                    </td>
                    <td class="tick"><input type="checkbox" title="Listening, or set aside for now" :checked="(item.off === false)" :disabled="busy" @change="turn(item, $event.target.checked)"></td>
                    <td>
                        <button type="button" class="link" :disabled="busy" @click="edit(item)">edit</button>
                        <button type="button" class="link" :disabled="busy" @click="drop(item)">forget it</button>
                    </td>
                </tr>
                <tr v-if="(forwards.length === 0)">
                    <td class="muted" colspan="7">No forwards yet. Add one below: a socket on the laptop, say, answered by a port on a server.</td>
                </tr>
            </tbody>
        </table>
    </div>
    <div class="rule-add">
        <input v-model.trim="fresh.name" class="short" placeholder="loki" spellcheck="false" title="A name for it: lowercase letters, digits, - and _" @keyup.enter="write">
        <select v-model="fresh.from_remote">
            <option value="">listens on</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.from" placeholder="~/repos/loki.sock or 3100" spellcheck="false" title="A socket file there (~/ is the agent's user's home), or a port on its loopback" @keyup.enter="write">
        <span class="muted">→</span>
        <select v-model="fresh.to_remote">
            <option value="">carried to</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.to" placeholder="3100" spellcheck="false" title="A port on its loopback, an address it reaches (10.0.0.5:3100), or a socket file" @keyup.enter="write">
        <button type="button" :disabled="(busy || fresh.name === '' || fresh.from_remote === '' || fresh.from === '' || fresh.to_remote === '' || fresh.to === '')" @click="write">{{ (editing === null ? 'Add' : 'Save') }}</button>
        <button v-if="(editing !== null)" type="button" :disabled="busy" @click="clear">Cancel</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</section>
`,
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
        machines: function () {
            return ((this.state === null) ? [] : this.state.remotes);
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.title || v.name)}));
        },
    },
    methods: {
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
                this.report(`listens on: ${from}`, true);
                return;
            }
            if (typeof to === 'string') {
                this.report(`carried to: ${to}`, true);
                return;
            }
            if (from.host !== undefined) {
                this.report('listens on: a port or a socket on that machine — it listens on its loopback, not on an address', true);
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
