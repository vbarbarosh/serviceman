import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import service_state_word from './service_state_word.js';
import state_pill from './state_pill.js';
import walls_of from './walls_of.js';

// The wall a fleet starts with, and the first word of the name of a wall made for a team
const WALL_NAME = 'authwall';

// A wall's lock, the inside of a 24x24 svg
const LOCK_ICON = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';

// Authwall: how visitors sign in. Not a service like the rest — the thing a door asks before
// anything behind a name is touched — so it has a page of its own: one table of the walls, one
// per team, each an authwall of its own with its own users: what it guards, where it runs, how it
// stands. A wall for another team is made here, as a copy of the wall that runs as a docker image
// (wall_copy on the server); an app picks its wall in its Settings, on Apps, and a name in its
// row on Addresses.
const authwall_pane = {
    template: `
<article id="detail" class="list authwall">
    <page-head category="authwall">
        <template #how>
            <p>How visitors sign in. An app behind a wall (its Settings, on Apps) asks it at every address it has; a door asks the wall <code>/auth/sidecar</code> before anything behind a name is touched: a yes carries the request on with <code>X-Auth-User</code>, a no sends the visitor to <code>/auth/sign-in</code>, and a wall that cannot be asked lets nothing through. Each team may have a wall of its own, with its own users. Who may pass is the wall's own business; serviceman writes nothing into it.</p>
        </template>
        <template v-if="((walls.length > 0) && (form === null))" #acts>
            <button type="button" @click="click_a_wall_for_another_team"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>A wall for another team</button>
        </template>
    </page-head>
    <form v-if="(form !== null)" class="card wall-new form" @submit.prevent="submit_make_the_wall">
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
    <data-table :columns="columns" :rows="rows" row_key="name" :row_class="(row => ((row.edge === '') ? [] : ('dt-' + row.edge)))" :on_row="row_open" :marks="false" framed :total="walls.length" :foot="foot" :empty_icon="ICON" empty_title="No wall yet" empty="A wall is a service, authwall, asked before a name is answered. Add a service called authwall; an app then picks it in its Settings, on Apps, and a name in its row on Addresses.">
        <template #empty_act><button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add service</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="LOCK_ICON" :name="row.name" :line="row.line" :tone="row.tone"/>
            <span v-else-if="(column.key === 'guards')" :class="{muted: (row.guards === 'nothing yet')}">{{ row.guards }}</span>
            <template v-else-if="(column.key === 'machine')">
                <button v-if="(row.machine !== null)" type="button" class="link" @click="$emit('remote', row.machine)">{{ row.machine_title }}</button><span v-else :class="{muted: (row.machine_title === '—')}">{{ row.machine_title }}</span>
            </template>
            <state-pill v-else-if="(column.key === 'state')" :tone="row.pill_tone" :text="row.pill"/>
        </template>
        <template #actions="{row}">
            <button v-if="row.service" type="button" @click="$emit('select', row.name)">Its service page</button>
            <button v-else type="button" @click="$emit('create')">Add service</button>
        </template>
    </data-table>
    <p v-if="(note_below !== '')" :class="(bad ? 'bad' : 'muted')">{{ note_below }}</p>
</article>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill},
    props: {
        state: {type: Object, required: true},
        // Opened from a list of walls, its last option: the form for a new wall is open at once
        creating: {type: Boolean, default: false},
    },
    emits: ['create', 'remote', 'select', 'saved'],
    data: function () {
        // form: the new wall's, while open
        return {form: (this.creating ? form_new() : null), busy: false, note: '', bad: false, WALL_NAME, LOCK_ICON, ICON: CATEGORIES.find(v => v.key === 'authwall').icon};
    },
    computed: {
        walls: function () {
            return walls_of(this.state);
        },
        columns: function () {
            return [
                {key: 'name', label: 'Wall'},
                {key: 'guards', label: 'Guards', fold: 2, phone: 'line'},
                {key: 'machine', label: 'Runs on', fold: 1, phone: 'line'},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        rows: function () {
            return this.walls.map(v => this.row_of(v));
        },
        foot: function () {
            const count = this.walls.length;
            return [{text: `${count} ${(count === 1) ? 'wall' : 'walls'}`, tone: ''}, {text: 'an app picks its wall in its Settings, on Apps; a name, in its row on Addresses', tone: ''}];
        },
        // The wall a new one is a copy of: the one a fleet starts with when serviceman runs it as
        // a docker image, or else the first wall that is; null when no wall can be copied
        base: function () {
            const names = [WALL_NAME].concat(this.walls.map(v => v.name));
            for (const name of names) {
                const found = this.state.services.find(v => v.name === name);
                if ((found !== undefined) && (found.type === 'docker')) {
                    return found.name;
                }
            }
            return null;
        },
        // The wall a fleet starts with, or else the first wall there is: what the form says has
        // no copy when no wall runs as a docker image
        wall_default: function () {
            return (this.walls.length === 0) ? WALL_NAME : this.walls[0].name;
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
        // A wall as its row: its team under its name, what it guards, the machine it runs on and
        // how it stands; a wall something asks and no service is called so, red, the reason under
        // its name; a failed one, its edge red, its team still under its name
        row_of: function (item) {
            const every_app = (this.state.apps !== undefined) && (this.state.apps !== null) && (this.state.apps.auth === item.name);
            const guards = guards_text(item, every_app);
            const service = this.state.services.find(v => v.name === item.name);
            if (service === undefined) {
                const who = (item.names > 0) ? 'a name' : 'an app';
                return {name: item.name, line: `${who} asks it; no service is called so`, tone: 'bad', edge: 'bad', guards, machine: null, machine_title: '—', pill: 'no service', pill_tone: 'bad', service: false};
            }
            const line = (item.team !== '') ? item.team : ((item.name === WALL_NAME) ? 'the wall a fleet starts with' : '');
            const place = this.machine_of(service);
            const word = service_state_word(service);
            const pill_tone = (service.doing !== null) ? 'busy' : ({running: 'run', failed: 'bad', starting: 'busy', stopping: 'busy'}[service.phase] || 'idle');
            return {name: item.name, line, tone: '', edge: ((service.phase === 'failed') ? 'bad' : ''), guards, machine: place.name, machine_title: place.title, pill: word, pill_tone, service: true};
        },
        // The machine a wall runs on, linked when it is one of the remotes: {name, title}
        machine_of: function (service) {
            if (service.type === 'files') {
                return {name: null, title: 'serviceman'};
            }
            const remotes = Array.isArray(service.remotes) ? service.remotes : [];
            if (remotes.length === 0) {
                return {name: null, title: '—'};
            }
            const more = (remotes.length === 1) ? '' : ` +${remotes.length - 1}`;
            const found = this.state.remotes.find(v => v.name === remotes[0]);
            if (found === undefined) {
                return {name: null, title: remotes[0] + more};
            }
            return {name: found.name, title: (found.title || found.name) + more};
        },
        // A click on a wall's row opens its service's page; on a wall no service is called so,
        // Add service, its one action, as a phone's card has no ⋯
        row_open: function (row) {
            if (row.service) {
                this.$emit('select', row.name);
                return;
            }
            this.$emit('create');
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
        // A copy of the base wall under the new name; once it is in, it is a row of the table
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
                this.form = null;
                this.report(`${form.name} is made, a copy of ${this.base}: it starts on its first visit. An app picks it in its Settings, on Apps; who may sign in is in its settings, on its service page.`, false);
                this.$emit('saved');
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

// What a wall stands in front of: every app, services at every address, names of doors;
// every app · 2 names, or nothing yet
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
    return (parts.length === 0) ? 'nothing yet' : parts.join(' · ');
}

export default authwall_pane;
