import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import fold_table from './fold_table.js';

// Every machine's door, and what comes in through it.
//
// A machine's agent carries requests in as well as out: whatever connects to `http.sock` beside
// the agent is answered by serviceman, wherever serviceman runs. That door stands on a public
// address — a web server on that machine in front of it — so what may be reached through it is
// said here, on the host, and never over there.
//
// A rule is a name and the service that answers it. The name is not the service's own address:
// a service keeps whatever it publishes, and a door adds a name rather than renaming anything.
const networking_pane = {
    template: `
<article id="detail" class="form">
    <h1>Doors</h1>
    <p class="muted">Whatever connects to <code>http.sock</code> beside a machine's agent is answered by that agent: it asks the wall in front of the name, and only on a yes carries the request to the service — on its own machine, or through the agent of the machine the service runs on, over the tailnet. serviceman writes each machine the table it routes by and is in none of it: with serviceman down, the doors go on answering. Only what a table cannot route — a service serviceman answers itself — still goes through serviceman.</p>
    <h2>What the doors answer</h2>
    <p class="muted">A name, and the service that takes it. The service keeps its own address as well — this is a name it also answers to, on that machine's front. <code>*.example.com</code> stands for every name under it. A machine with no rule serves nothing, and the control page is not reachable through a door at all.</p>
    <p class="muted"><b>Behind</b> is a service asked before anything else is touched — an authwall. The door asks it <code>/auth/sidecar</code>, carries its <code>X-Auth-User</code> to the service on a yes, and on a no sends the visitor to <code>/auth/sign-in</code> on the name they asked for; a wall that cannot be asked lets nothing through. One wall stands in front of as many names as point at it, and serviceman writes nothing into it: whose email may pass is the wall's own business.</p>
    <fold-table v-slot="fold" :order="['acts', 'behind', 'machine', 'service']">
        <table>
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Name</th>
                    <th data-fold="machine">Door of</th>
                    <th data-fold="service">Answered by</th>
                    <th data-fold="behind">Behind</th>
                    <th class="tick">On</th>
                    <th data-fold="acts"></th>
                </tr>
            </thead>
            <tbody>
                <template v-for="rule of rules" :key="rule_key(rule)">
                    <tr :class="{off: rule.off, foldable: (fold.folded.length > 0), open: fold.is_open(rule_key(rule))}" @click="fold.toggle(rule_key(rule), $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps"><span class="dot-name"><span class="dot" :class="rule_dot(rule)"/><code class="name">{{ rule.host }}</code></span></td>
                        <td data-fold="machine">{{ rule.title }}</td>
                        <td data-fold="service">{{ rule.service }}<span v-if="(known(rule.service) === false)" class="bad"> — no such service</span></td>
                        <td data-fold="behind" :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing' : rule.auth) }}</td>
                        <td class="tick"><input type="checkbox" title="Answering, or set aside for now" :checked="(rule.off === false)" :disabled="busy" @change="turn(rule, $event.target.checked)"></td>
                        <td data-fold="acts">
                            <button type="button" class="link" :disabled="busy" @click="edit(rule)">edit</button>
                            <button type="button" class="link" :disabled="busy" @click="drop(rule)">forget it</button>
                        </td>
                    </tr>
                    <tr v-if="fold.is_open(rule_key(rule))" class="fold-more">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('machine')">
                                    <dt>Door of</dt>
                                    <dd>{{ rule.title }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('service')">
                                    <dt>Answered by</dt>
                                    <dd>{{ rule.service }}<span v-if="(known(rule.service) === false)" class="bad"> — no such service</span></dd>
                                </template>
                                <template v-if="fold.folded.includes('behind')">
                                    <dt>Behind</dt>
                                    <dd :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing — anyone may reach it' : rule.auth) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('acts')">
                                    <dt>Change</dt>
                                    <dd class="fold-actions">
                                        <button type="button" class="link" :disabled="busy" @click="edit(rule)">edit</button>
                                        <button type="button" class="link" :disabled="busy" @click="drop(rule)">forget it</button>
                                    </dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(rules.length === 0)">
                    <td class="muted" colspan="6">No door answers anything yet.</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <div class="rule-add">
        <select v-model="fresh.machine">
            <option value="">which machine</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.host" placeholder="echo.example.com" spellcheck="false" @keyup.enter="write">
        <select v-model="fresh.service">
            <option value="">answered by</option>
            <option v-for="item of service_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="fresh.auth" title="A service asked before this name is answered — an authwall">
            <option value="">nothing in front</option>
            <option v-for="item of auth_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button type="button" :disabled="(busy || fresh.machine === '' || fresh.host === '' || fresh.service === '')" @click="write">{{ (editing === null ? 'Add' : 'Save') }}</button>
        <button v-if="(editing !== null)" type="button" :disabled="busy" @click="clear">Cancel</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    <h2>The doors</h2>
    <p class="muted">A machine has no door until one is asked for. The mode is the asking, and it is also the whole of who may knock: <code>0660</code> and a group lets that machine's web server in, <code>0600</code> nobody but the user the agent runs as. Add the line to the agent's <code>env</code> and start it again:</p>
    <pre class="tail">SERVICEMAN_HTTP_SOCKET_MODE=0660

bin/restart</pre>
    <fold-table v-slot="fold" :order="['path', 'streams', 'door']">
        <table>
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Machine</th>
                    <th data-fold="door">Door</th>
                    <th>Routes</th>
                    <th data-fold="streams">Riding now</th>
                    <th data-fold="path">Where it is</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="item of machines" :key="item.name">
                    <tr :class="{foldable: (fold.folded.length > 0), open: fold.is_open(item.name)}" @click="fold.toggle(item.name, $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps"><span class="dot-name"><span class="dot" :class="(item.phase === 'online' ? 'running' : '')"/><span class="name">{{ item.title || item.name }}</span></span></td>
                        <td data-fold="door" :class="{muted: (door_open(item) === false)}">{{ door_text(item) }}</td>
                        <td :class="routes_of(item).tone" :title="routes_of(item).hint">{{ routes_of(item).text }}</td>
                        <td data-fold="streams" class="muted">{{ streams_text(item) }}</td>
                        <td data-fold="path" class="muted"><code>{{ door_path(item) }}</code></td>
                    </tr>
                    <tr v-if="fold.is_open(item.name)" class="fold-more">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('door')">
                                    <dt>Door</dt>
                                    <dd :class="{muted: (door_open(item) === false)}">{{ door_text(item) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('streams')">
                                    <dt>Riding now</dt>
                                    <dd class="muted">{{ (item.streams === 0 ? 'nothing' : streams_text(item)) }}</dd>
                                </template>
                                <template v-if="(fold.folded.includes('path') && door_path(item) !== '')">
                                    <dt>Where it is</dt>
                                    <dd><code>{{ door_path(item) }}</code></dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(machines.length === 0)">
                    <td class="muted" colspan="5">No machines yet. A door is a machine's own — add a remote first.</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <p class="muted">Then point that machine's web server at the file, keeping the <code>Host</code> header as it came — the door answers by that name and nothing else.</p>
</article>
`,
    components: {'fold-table': fold_table},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the rule the line below is rewriting — the same three boxes, so a rule is
        // changed where it was written rather than in a form of its own
        return {fresh: {machine: '', host: '', service: '', auth: ''}, editing: null, note: '', bad: false, busy: false};
    },
    computed: {
        machines: function () {
            return ((this.state === null) ? [] : this.state.remotes);
        },
        services: function () {
            return ((this.state === null) ? [] : this.state.services);
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.title || v.name)}));
        },
        service_options: function () {
            return this.services.map(v => ({value: v.name, label: (v.title || v.name)}));
        },
        auth_options: function () {
            return this.services.map(v => ({value: v.name, label: `behind ${v.title || v.name}`}));
        },
        // Every rule in the fleet as one list, because that is the question this page answers:
        // which name, on which machine's front, is taken by what
        rules: function () {
            const out = [];
            for (const item of this.machines) {
                const inbound = ((item.inbound === undefined) ? {} : item.inbound);
                for (const host of Object.keys(inbound)) {
                    out.push({machine: item.name, title: (item.title || item.name), host, service: inbound[host].service, off: (inbound[host].off === true), auth: ((inbound[host].auth === undefined) ? null : inbound[host].auth)});
                }
            }
            return out;
        },
    },
    methods: {
        known: function (name) {
            return this.services.some(v => v.name === name);
        },
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        // Answering, set aside, or answered by a service that is not there
        rule_dot: function (rule) {
            if (this.known(rule.service) === false) {
                return 'failed';
            }
            return (rule.off ? '' : 'running');
        },
        streams_text: function (item) {
            if (item.streams === 0) {
                return '';
            }
            return ((item.streams === 1) ? '1 stream' : `${item.streams} streams`);
        },
        door_open: function (item) {
            const door = door_of(item);
            return (door !== null) && (door.mode !== '0600');
        },
        door_text: function (item) {
            const door = door_of(item);
            if (item.phase !== 'online') {
                return 'the link is down';
            }
            if (door === null) {
                return 'none — nothing was asked for';
            }
            return ((door.mode === '0600') ? `${door.mode} · its own user only` : `${door.mode} · open`);
        },
        // Whether its door routes by a table of its own, and whether it holds the latest one
        routes_of: function (item) {
            const doors = ((item.doors === undefined) ? null : item.doors);
            if (doors === null) {
                return {text: 'through serviceman', tone: 'muted', hint: 'An agent from before doors routed by themselves: every request goes through serviceman, and stops when it does'};
            }
            if (doors.error !== null) {
                return {text: 'its table could not be sent', tone: 'bad', hint: doors.error};
            }
            if ((doors.wanted !== null) && (doors.told === doors.wanted)) {
                const peer = ((doors.peer === null) ? 'no peer port' : `peers reach it at ${doors.peer.addresses.join(', ')}:${doors.peer.port}`);
                return {text: 'by itself · latest table', tone: '', hint: `table ${doors.told} · ${peer}`};
            }
            if (item.phase !== 'online') {
                return {text: `by itself · ${(doors.told === null) ? 'no table yet' : 'last table it had'}`, tone: 'muted', hint: 'Not connected: it goes on routing by the table it holds, and is sent the latest when it dials in'};
            }
            return {text: 'by itself · waiting for its table', tone: 'muted', hint: 'The latest table is on its way'};
        },
        door_path: function (item) {
            const door = door_of(item);
            return ((door === null) ? '' : door.path);
        },
        // One rule written, whether it is new or the one being edited. A rule that moved to
        // another machine is taken off the old one in the same breath.
        write: async function () {
            const fresh = this.fresh;
            const editing = this.editing;
            const host = fresh.host.toLowerCase();
            const kept = ((editing === null) ? false : editing.off);
            const written = await this.rules_write(fresh.machine, function (inbound) {
                if ((editing !== null) && (editing.machine === fresh.machine)) {
                    delete inbound[editing.host];
                }
                inbound[host] = door_rule_value(fresh.service, kept, fresh.auth);
            });
            if (written === false) {
                return;
            }
            if ((editing !== null) && (editing.machine !== fresh.machine)) {
                await this.rules_write(editing.machine, function (inbound) {
                    delete inbound[editing.host];
                });
            }
            this.clear();
        },
        edit: function (rule) {
            this.editing = rule;
            this.fresh = {machine: rule.machine, host: rule.host, service: rule.service, auth: ((rule.auth === null) ? '' : rule.auth)};
            this.report('', false);
        },
        clear: function () {
            this.editing = null;
            this.fresh = {machine: '', host: '', service: '', auth: ''};
        },
        // Set aside for now, and put back later. The name stays where it is — retyping one is
        // how a name comes back subtly different.
        turn: async function (rule, on) {
            await this.rules_write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(rule.service, on === false, rule.auth);
            });
        },
        drop: async function (rule) {
            if ((this.editing !== null) && (this.editing.machine === rule.machine) && (this.editing.host === rule.host)) {
                this.clear();
            }
            await this.rules_write(rule.machine, function (inbound) {
                delete inbound[rule.host];
            });
        },
        rules_write: async function (name, change) {
            this.busy = true;
            this.report('', false);
            const error = await door_rules_write(name, change);
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

function door_of(item)
{
    return (((item.machine === null) || (item.machine.door === undefined)) ? null : item.machine.door);
}

export default networking_pane;
