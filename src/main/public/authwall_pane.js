import data_table from './data_table.js';
import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import page_head from './page_head.js';
import walls_of from './walls_of.js';

// The wall a fleet starts with, and the first word of the name of a wall made for a team
const WALL_NAME = 'authwall';

// Authwall: how visitors sign in. Not a service like the rest — the thing a door asks before
// anything behind a name is touched — so it has a page of its own: the walls, one per team, each
// an authwall of its own with its own users, and what the one picked stands in front of. A wall
// for another team is made here, as a copy of the wall that runs as a docker image (wall_copy on
// the server); an app picks its wall in its Settings, on Apps.
const authwall_pane = {
    template: `
<article id="detail">
    <page-head category="authwall">
        <template #how>
            <p>How visitors sign in. An app behind a wall (its Settings, on Apps) asks it at every address it has; a door asks the wall <code>/auth/sidecar</code> before anything behind a name is touched: a yes carries the request on with <code>X-Auth-User</code>, a no sends the visitor to <code>/auth/sign-in</code>, and a wall that cannot be asked lets nothing through. Each team may have a wall of its own, with its own users. Who may pass is the wall's own business; serviceman writes nothing into it.</p>
        </template>
    </page-head>
    <div v-if="(walls.length === 0)" class="card svc-status">
        <div class="row-of svc-state">
            <span class="pill">None yet</span>
            <span class="muted">A wall is a service — authwall — asked before a name is answered. Add a service called <code>authwall</code>, and the names to guard are then picked here.</span>
        </div>
        <div class="actions">
            <button type="button" class="primary" @click="$emit('create')">Add service</button>
        </div>
    </div>
    <template v-else>
        <div class="wall-list" role="list">
            <button v-for="item of walls" :key="item.name" type="button" class="wall-card" :class="{on: (item.name === wall)}" role="listitem" :aria-pressed="(item.name === wall)" @click="click_wall(item.name)">
                <svg class="wall-lock" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                <span class="wall-card-words"><code class="name">{{ item.name }}</code><span class="muted">{{ wall_words(item) }}</span></span>
            </button>
        </div>
        <div v-if="(form === null)" class="actions">
            <button type="button" @click="click_a_wall_for_another_team">+ A wall for another team</button>
        </div>
        <form v-else class="card wall-new form" @submit.prevent="submit_make_the_wall">
            <h2>A wall for another team</h2>
            <p v-if="(base === null)" class="muted">{{ wall_default }} is not a docker image serviceman runs, so there is no wall to copy: a team's wall is added as a service of its own.</p>
            <p v-else class="muted">A copy of <code>{{ base }}</code>: the same image, machines and settings, who may sign in among them; its own address, storage and secret, and the first user below. Its users are its own.</p>
            <label class="wall-new-row">
                <span class="wall-new-label">Team</span>
                <input ref="team" v-model.trim="form.team" placeholder="team A" maxlength="60" autocomplete="off" :disabled="busy">
            </label>
            <label class="wall-new-row">
                <span class="wall-new-label">Name</span>
                <input v-model.trim="form.name" spellcheck="false" autocomplete="off" maxlength="63" aria-describedby="wall-new-name-says" :disabled="busy" @input="form.named = true">
            </label>
            <p id="wall-new-name-says" class="muted wall-new-says">a service called so; a name that starts with <code>{{ WALL_NAME }}-</code> is listed here from the start</p>
            <div class="wall-new-row">
                <span class="wall-new-label">First user</span>
                <div class="wall-new-user">
                    <input v-model.trim="form.username" placeholder="name" spellcheck="false" autocomplete="off" aria-label="Its first user's name" :disabled="busy">
                    <input v-model="form.password" type="password" placeholder="password" autocomplete="new-password" aria-label="Its first user's password" :disabled="busy">
                    <input v-model.trim="form.email" type="email" placeholder="user@example.com" spellcheck="false" autocomplete="off" aria-label="Its first user's email" :disabled="busy">
                </div>
            </div>
            <p class="muted wall-new-says">optional: a wall with no user lets nobody in until one signs up, if its settings let them</p>
            <div class="actions">
                <button v-if="(base === null)" type="button" class="primary" @click="$emit('create')">Add service</button>
                <button v-else type="submit" class="primary" :disabled="busy">{{ (busy ? 'Making…' : 'Make the wall') }}</button>
                <button type="button" :disabled="busy" @click="click_cancel">Cancel</button>
                <span :class="(bad ? 'bad' : 'muted')" role="status">{{ note }}</span>
            </div>
        </form>
        <div class="card svc-status wall-status">
            <div class="row-of svc-state">
                <span class="pill" :class="head.pill">{{ head.text }}</span>
                <span class="muted">{{ head.detail }}</span>
            </div>
            <div class="actions">
                <button v-if="(service !== null)" type="button" @click="$emit('select', service.name)">Its service page</button>
            </div>
        </div>
        <h2>What {{ wall }} guards</h2>
        <p v-if="guards_apps" class="muted">The page of every app too, and every app sent from now on: the top of Apps.</p>
        <data-table v-if="(behind.length > 0)" :columns="behind_columns" :rows="behind" row_key="name" actions_label="Change">
            <template #cell="{row, column}">
                <button v-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.name)">{{ row.title || row.name }}</button>
                <template v-else-if="(column.key === 'where')"><span class="muted">every address it has:</span> <code v-for="(host, i) of hosts_of(row)" :key="host" class="name">{{ host }}{{ (i < hosts_of(row).length - 1 ? ' ' : '') }}</code></template>
            </template>
            <template #actions="{row}">
                <span v-if="(row.auth_from === 'apps')" class="muted">with every app: the top of Apps</span>
                <button v-else type="button" :disabled="busy" @click="unwall(row)">Stop guarding</button>
            </template>
        </data-table>
        <data-table v-if="((guarded.length > 0) || (behind.length === 0))" :columns="guarded_columns" :rows="guarded" :row_key="rule_key" :row_class="v => (v.off ? 'off' : [])" actions_label="Change" empty="Nothing yet — pick a name below, or an app's Settings on Apps.">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'host')"><code class="name">{{ row.host }}</code><span v-if="row.off" class="muted"> · set aside</span></template>
                <template v-else-if="(column.key === 'machine')">{{ row.title }}</template>
                <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
            </template>
            <template #actions="{row}">
                <button type="button" :disabled="busy" @click="guard(row, null)">Stop guarding</button>
            </template>
        </data-table>
        <h2>Not behind it</h2>
        <data-table :columns="open_columns" :rows="open" :row_key="rule_key" :row_class="v => (v.off ? 'off' : [])" actions_label="Change" :empty="((rules.length === 0) ? 'No door answers a name yet.' : ('Every name a door answers is behind ' + wall + '.'))">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'host')"><code class="name">{{ row.host }}</code><span v-if="row.off" class="muted"> · set aside</span></template>
                <template v-else-if="(column.key === 'machine')">{{ row.title }}</template>
                <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
                <span v-else-if="(column.key === 'behind')" :class="{muted: (row.auth === null)}">{{ behind_text(row) }}</span>
            </template>
            <template #actions="{row}">
                <button type="button" :disabled="busy" @click="guard(row, wall)">Guard with {{ wall }}</button>
            </template>
        </data-table>
    </template>
    <p :class="(bad ? 'bad' : 'muted')">{{ note_below }} <template v-if="(note_below === '')">A name is given to a door on the <button type="button" class="link" @click="$emit('doors')">Doors</button> page.</template></p>
</article>
`,
    components: {'data-table': data_table, 'page-head': page_head},
    props: {
        state: {type: Object, required: true},
        // Opened from a list of walls, its last option: the form for a new wall is open at once
        creating: {type: Boolean, default: false},
    },
    emits: ['create', 'doors', 'select', 'saved'],
    data: function () {
        // picked: the wall looked at, null for the usual one; form: the new wall's, while open
        return {picked: null, form: (this.creating ? form_new() : null), busy: false, note: '', bad: false, WALL_NAME};
    },
    computed: {
        walls: function () {
            return walls_of(this.state);
        },
        // The tables' columns, each that may fold with when
        guarded_columns: function () {
            return [
                {key: 'host', label: 'Name', wraps: true},
                {key: 'machine', label: 'Door of', fold: 2},
                {key: 'service', label: 'Answered by', fold: 1},
            ];
        },
        behind_columns: function () {
            return [
                {key: 'service', label: 'App or service'},
                {key: 'where', label: 'Where', wraps: true, fold: 1},
            ];
        },
        // Whether Apps puts the page of apps and every app behind this wall
        guards_apps: function () {
            return (this.state.apps !== undefined) && (this.state.apps !== null) && (this.state.apps.auth === this.wall) && (this.wall !== null);
        },
        // The services behind this wall wherever they are asked, by a pick of their own (an app's
        // Settings) or as every app (the top of Apps): every address they have, not a name of a
        // door
        behind: function () {
            return this.state.services.filter(v => (v.auth === this.wall));
        },
        open_columns: function () {
            return [
                {key: 'host', label: 'Name', wraps: true},
                {key: 'machine', label: 'Door of', fold: 3},
                {key: 'service', label: 'Answered by', fold: 2},
                {key: 'behind', label: 'Behind', fold: 1},
            ];
        },
        // Every name a machine's door answers, with the wall in front of it; a name of a service
        // that stands behind a wall at every address is that service's, in its row above
        rules: function () {
            return this.rules_all.filter(v => this.walled_names.includes(v.service) === false);
        },
        rules_all: function () {
            const out = [];
            for (const item of this.state.remotes) {
                const inbound = (item.inbound === undefined) ? {} : item.inbound;
                for (const host of Object.keys(inbound)) {
                    const rule = (typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host];
                    out.push({machine: item.name, title: item.title || item.name, host, service: rule.service, off: (rule.off === true), auth: (rule.auth === undefined) ? null : rule.auth});
                }
            }
            return out;
        },
        walled_names: function () {
            return this.state.services.filter(v => (v.auth !== null) && (v.auth !== undefined)).map(v => v.name);
        },
        // The one called authwall, or else the first wall there is
        wall_default: function () {
            return (this.walls.length === 0) ? null : this.walls[0].name;
        },
        wall: function () {
            return (this.picked === null) ? this.wall_default : this.picked;
        },
        service: function () {
            return this.state.services.find(v => v.name === this.wall) || null;
        },
        // The wall a new one is a copy of: the one looked at when serviceman runs it as a docker
        // image, or else authwall when it does; null when no wall can be copied
        base: function () {
            for (const name of [this.wall, WALL_NAME]) {
                const found = this.state.services.find(v => v.name === name);
                if ((found !== undefined) && (found.type === 'docker')) {
                    return found.name;
                }
            }
            return null;
        },
        head: function () {
            const item = this.walls.find(v => v.name === this.wall);
            const guards = (item === undefined) ? 'guards nothing yet' : guards_text(item, this.guards_apps);
            if (this.service === null) {
                return {pill: 'failed', text: 'no such service', detail: `Names are behind ${this.wall}, and no service is called that: a door lets nothing through them.`};
            }
            const name = (Array.isArray(this.service.remotes) && (this.service.remotes.length > 0)) ? this.service.remotes[0] : null;
            const found = this.state.remotes.find(v => v.name === name);
            const where = (found === undefined) ? '' : ` on ${found.title || found.name}`;
            const team = ((item === undefined) || (item.team === '')) ? '' : ` · ${item.team}`;
            return {pill: this.service.phase, text: this.service.phase, detail: `${this.service.name}${where}${team} · ${guards}`};
        },
        guarded: function () {
            return this.rules.filter(v => v.auth === this.wall);
        },
        open: function () {
            return this.rules.filter(v => v.auth !== this.wall);
        },
        // What was said, under the page; while the form is open it is said beside its buttons,
        // where it was asked
        note_below: function () {
            return (this.form === null) ? this.note : '';
        },
    },
    watch: {
        // The name follows the team until it is typed by hand: team A is authwall-team-a
        'form.team': function (team) {
            if ((this.form !== null) && (this.form.named === false)) {
                this.form.name = name_of_team(team);
            }
        },
    },
    methods: {
        click_wall: function (name) {
            this.picked = (name === this.wall_default) ? null : name;
        },
        click_a_wall_for_another_team: function () {
            this.form = form_new();
            this.report('', false);
            this.$nextTick(() => this.$refs.team.focus());
        },
        click_cancel: function () {
            this.form = null;
            this.report('', false);
        },
        // A copy of the base wall under the new name; once it is in, it is the one looked at
        submit_make_the_wall: async function () {
            const form = this.form;
            if ((form === null) || this.busy || (this.base === null)) {
                return;
            }
            const problem = form_problem(form, this.walls);
            if (problem !== null) {
                this.report(problem, true);
                return;
            }
            const user = ((form.username === '') && (form.email === '') && (form.password === '')) ? null : {username: form.username, password: form.password, email: form.email};
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch('/api/v1/walls', {method: 'POST', body: JSON.stringify({from: this.base, name: form.name, title: form.team, user})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.picked = form.name;
                this.form = null;
                this.report(`${form.name} is made, a copy of ${this.base}: it starts on its first visit. An app picks it in its Settings, on Apps; who may sign in is in its settings, on its service page.`, false);
                this.$emit('saved');
            }
            catch (error) {
                this.report(error.message, true);
            }
            this.busy = false;
        },
        // A wall's team and what it stands in front of, in a few words
        wall_words: function (item) {
            const guards = guards_text(item, (this.state.apps !== undefined) && (this.state.apps !== null) && (this.state.apps.auth === item.name));
            const words = [item.team, guards, (item.service ? '' : 'no such service')].filter(v => v !== '');
            return words.join(' · ');
        },
        // A service's own addresses, then the names doors give it
        hosts_of: function (service) {
            const doors = this.rules_all.filter(v => v.service === service.name).map(v => v.host);
            return service.publish.hosts.concat(doors.filter(v => service.publish.hosts.includes(v) === false));
        },
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        behind_text: function (rule) {
            return (rule.auth === null) ? 'nothing — anyone may reach it' : rule.auth;
        },
        // The wall put in front of a name, or taken away; the name keeps everything else it has
        guard: async function (rule, auth) {
            this.busy = true;
            this.report('', false);
            const problem = await door_rules_write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(rule.service, rule.off, auth);
            });
            this.busy = false;
            if (problem !== null) {
                this.report(problem, true);
            }
        },
        // A service out from behind the wall: it answers its addresses as before, and a door's
        // rule that names a wall still has that one asked
        unwall: async function (row) {
            this.busy = true;
            this.report('', false);
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === row.name);
                if (entry === undefined) {
                    throw new Error(`${row.name} is not in the config any more`);
                }
                const service = Object.assign({}, entry);
                delete service.auth;
                const answer = await fetch(`/api/v1/services/${encodeURIComponent(row.name)}`, {method: 'PUT', body: JSON.stringify({service})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
            }
            catch (error) {
                this.report(error.message, true);
            }
            this.busy = false;
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

function form_new()
{
    return {team: '', name: `${WALL_NAME}-`, named: false, username: '', password: '', email: ''};
}

// team A is authwall-team-a: lowercase letters, digits and dashes, as a service is named
function name_of_team(team)
{
    const slug = team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63 - WALL_NAME.length - 1);
    return `${WALL_NAME}-${slug}`;
}

// What stops a new wall before it is sent, or null
function form_problem(form, walls)
{
    if (/^[a-z0-9][a-z0-9_-]*$/.test(form.name) === false) {
        return 'A name of lowercase letters, digits, - and _: authwall-team-a.';
    }
    if ((form.name === `${WALL_NAME}-`) || form.name.endsWith('-')) {
        return 'Name the team, or the wall: authwall-team-a.';
    }
    if (walls.some(v => v.name === form.name)) {
        return `${form.name} is a wall already.`;
    }
    const user = (form.username !== '') || (form.email !== '') || (form.password !== '');
    if (user && (form.password === '')) {
        return 'Its first user needs a password.';
    }
    if (user && (form.username === '') && (form.email === '')) {
        return 'Its first user needs a name or an email.';
    }
    return null;
}

// What a wall stands in front of: every app, services at every address, names of doors
function guards_text(item, every_app)
{
    const parts = [];
    if (every_app) {
        parts.push('every app');
    }
    else if (item.apps > 0) {
        parts.push((item.apps === 1) ? '1 service' : `${item.apps} services`);
    }
    if (item.names > 0) {
        parts.push((item.names === 1) ? '1 name' : `${item.names} names`);
    }
    return (parts.length === 0) ? 'guards nothing yet' : parts.join(', ');
}

export default authwall_pane;
