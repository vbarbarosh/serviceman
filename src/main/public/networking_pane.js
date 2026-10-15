import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import forwards_section from './forwards_section.js';

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
    <ul class="fold-list">
        <li v-for="rule of rules" :key="rule_key(rule)" :class="{off: rule.off, open: rule_open(rule)}">
            <button type="button" class="fold-line" :aria-expanded="rule_open(rule)" @click="rule_toggle(rule)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <span class="dot" :class="rule_dot(rule)"/>
                <b class="name" :title="rule.host">{{ rule.host }}</b>
                <span class="route muted" :title="(rule.title + ' → ' + rule.service)">{{ rule.title }} → {{ rule.service }}</span>
                <span class="word" :class="{bad: (known(rule.service) === false), muted: (rule.auth === null && rule.off === false && known(rule.service))}">{{ rule_word(rule) }}</span>
            </button>
            <div v-if="rule_open(rule)" class="fold-details">
                <dl>
                    <dt>Door of</dt>
                    <dd>{{ rule.title }}</dd>
                    <dt>Answered by</dt>
                    <dd>{{ rule.service }}<span v-if="(known(rule.service) === false)" class="bad"> — no such service</span></dd>
                    <dt>Behind</dt>
                    <dd :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing — anyone may reach it' : rule.auth) }}</dd>
                </dl>
                <div class="fold-actions">
                    <label><input type="checkbox" :checked="(rule.off === false)" :disabled="busy" @change="turn(rule, $event.target.checked)"> Answering</label>
                    <button type="button" class="link" :disabled="busy" @click="edit(rule)">edit</button>
                    <button type="button" class="link" :disabled="busy" @click="drop(rule)">forget it</button>
                </div>
            </div>
        </li>
        <li v-if="(rules.length === 0)" class="muted empty">No door answers anything yet.</li>
    </ul>
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
    <ul class="fold-list">
        <li v-for="item of machines" :key="item.name" :class="{open: door_shown(item)}">
            <button type="button" class="fold-line" :aria-expanded="door_shown(item)" @click="door_toggle(item)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <span class="dot" :class="(item.phase === 'online' ? 'running' : '')"/>
                <b class="name" :title="(item.title || item.name)">{{ item.title || item.name }}</b>
                <span class="route muted" :title="door_text(item)">{{ door_text(item) }}</span>
                <span class="word" :class="routes_of(item).tone" :title="routes_of(item).hint">{{ routes_of(item).text }}</span>
            </button>
            <div v-if="door_shown(item)" class="fold-details">
                <dl>
                    <dt>Door</dt>
                    <dd :class="{muted: (door_open(item) === false)}">{{ door_text(item) }}</dd>
                    <dt>Routes</dt>
                    <dd><span :class="routes_of(item).tone">{{ routes_of(item).text }}</span><div class="muted">{{ routes_of(item).hint }}</div></dd>
                    <dt>Riding now</dt>
                    <dd :class="{muted: (item.streams === 0)}">{{ (item.streams === 0 ? 'nothing' : item.streams + (item.streams === 1 ? ' stream' : ' streams')) }}</dd>
                    <template v-if="(door_path(item) !== '')">
                        <dt>Where it is</dt>
                        <dd><code>{{ door_path(item) }}</code></dd>
                    </template>
                </dl>
            </div>
        </li>
        <li v-if="(machines.length === 0)" class="muted empty">No machines yet. A door is a machine's own — add a remote first.</li>
    </ul>
    <p class="muted">Then point that machine's web server at the file, keeping the <code>Host</code> header as it came — the door answers by that name and nothing else.</p>
    <forwards-section :state="state"/>
</article>
`,
    components: {'forwards-section': forwards_section},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the rule the line below is rewriting — the same three boxes, so a rule is
        // changed where it was written rather than in a form of its own
        // `rules_opened` and `doors_opened` are the lines whose details are shown
        return {fresh: {machine: '', host: '', service: '', auth: ''}, editing: null, note: '', bad: false, busy: false, rules_opened: {}, doors_opened: {}};
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
        rule_open: function (rule) {
            return (this.rules_opened[this.rule_key(rule)] === true);
        },
        rule_toggle: function (rule) {
            this.rules_opened = Object.assign({}, this.rules_opened, {[this.rule_key(rule)]: (this.rule_open(rule) === false)});
        },
        // Where a rule stands, in a word or two for its one line
        rule_word: function (rule) {
            if (this.known(rule.service) === false) {
                return 'no such service';
            }
            if (rule.off) {
                return 'set aside';
            }
            return ((rule.auth === null) ? 'no wall' : `behind ${rule.auth}`);
        },
        rule_dot: function (rule) {
            if (this.known(rule.service) === false) {
                return 'failed';
            }
            return (rule.off ? '' : 'running');
        },
        door_shown: function (item) {
            return (this.doors_opened[item.name] === true);
        },
        door_toggle: function (item) {
            this.doors_opened = Object.assign({}, this.doors_opened, {[item.name]: (this.door_shown(item) === false)});
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
