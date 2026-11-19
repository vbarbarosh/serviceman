import data_table from './data_table.js';
import format_ms_ago from './format_ms_ago.js';
import format_token_section from './format_token_section.js';
import page_head from './page_head.js';
import secret_hidden from './secret_hidden.js';
import step_frame from './step_frame.js';
import to_clipboard from './to_clipboard.js';
import token_level_of from './token_level_of.js';
import token_section_set from './token_section_set.js';
import token_sections from './token_sections.js';

// What each right lets a token do, in a few words
const RIGHTS_SAID = {
    status: 'its machines and what runs on them',
    metrics: 'the charts: CPU, memory, disk, network; the uptime by day',
    processes: 'the process list',
    ports: 'the ports it listens on',
    disks: 'its disks and how full they are',
    packages: 'what is installed, and what waits to be',
    containers: 'its docker containers',
    vulnerabilities: 'the critical CVEs that hit it',
    files_read: 'list, read, download and watch the files within the folders below',
    files: 'the file manager, within the folders below and nothing above them: read and write',
    terminals: 'list, make, join and end its kept terminals: a shell on the machine',
    apps_read: 'list the apps: each one\'s name, kind and address',
    apps: 'send an app of files, new or a new version, as a zip, and list them: serviceman serves each at an address of its own',
    versions: 'send a new version of an app folder on it, as a zip: curl -T app.zip',
    forwards_read: 'read the forwards between its machines',
    forwards: 'read and write the forwards between its machines: a way to what listens there, as ssh -L',
};

// The forwards a revoke or a change set aside, said after what was done, or nothing
function aside_text(loaded)
{
    const aside = Array.isArray(loaded.forwards_set_aside) ? loaded.forwards_set_aside : [];
    if (aside.length === 0) {
        return '';
    }
    return `; set aside, as it may no longer hold ${(aside.length === 1) ? 'it' : 'them'}: ${aside.join(', ')}`;
}

// The tokens of the control door: each one for an agent or a program, with the machines it
// sees and what it may do with them. A token can be copied once, when it is made or given a new
// value by a rotation, and is drawn as dots even then; only its hash is kept. What it may do is
// edited in place, the token staying the same.
const tokens_form = {
    template: `
<article id="detail" class="list form">
    <step-frame v-if="form_open" :title="((editing === null) ? 'New token' : ('Edit ' + editing.label))" :steps="steps" :step="step" :mode="((editing === null) ? mode : 'page')" :switchable="(editing === null)" :can_next="step_ok.ok" :next_title="step_ok.why" :busy="busy" :create_label="((editing === null) ? 'Make the token' : 'Save the changes')" @step="step_go" @mode="mode = $event" @cancel="form_close" @create="create_click">
        <template #who>
            <div class="sf-fields">
                <input id="tk-label" ref="label" class="sf-big" v-model.trim="label" placeholder="the agent of the notes project" spellcheck="false">
                <p class="muted">Who or what holds it: the agent of a project, a script, a person. It names the token here and in the log.</p>
                <p v-if="(editing !== null)" class="muted">The token stays the same: whoever holds it goes on with what is given here from the next request.</p>
            </div>
        </template>
        <template #rights>
            <div class="tk-rights">
                <div class="tk-row">
                    <button type="button" @click="click_all_read_only">All: read only</button>
                    <span class="muted">each section to read, Terminals to none</span>
                </div>
                <div class="tk-sections">
                    <template v-for="section of sections" :key="section.value">
                        <b>{{ section.label }}</b>
                        <span class="seg" role="group" :aria-label="('What it may do with ' + section.label)">
                            <button type="button" :class="{on: (level_of(section) === 'none')}" :aria-pressed="(level_of(section) === 'none')" @click="click_level(section, 'none')">None</button>
                            <button type="button" :class="{on: (level_of(section) === 'read')}" :aria-pressed="(level_of(section) === 'read')" :disabled="(section.read === null)" :title="section.no_read" @click="click_level(section, 'read')">Read</button>
                            <button type="button" :class="{on: (level_of(section) === 'write')}" :aria-pressed="(level_of(section) === 'write')" :disabled="(section.write === null)" :title="section.no_write" @click="click_level(section, 'write')">Write</button>
                        </span>
                        <button type="button" class="tk-fine" :class="{on: (level_of(section) === 'fine')}" :aria-expanded="fine_open.includes(section.value)" :title="('The rights of ' + section.label + ' one by one')" @click="click_fine(section)">fine {{ fine_open.includes(section.value) ? '▾' : '▸' }}</button>
                        <span class="muted tk-said"><template v-if="(level_of(section) === 'fine')">ticked: {{ format_rights_ticked(section) }} · </template>{{ section.said }}<template v-if="(section.read === null)"> · {{ section.no_read }}</template><template v-if="(section.write === null)"> · {{ section.no_write }}</template></span>
                        <div v-if="fine_open.includes(section.value)" class="tk-checks tk-under">
                            <label v-for="right of section.rights" :key="right" class="check"><input type="checkbox" :checked="is_right_held(section, right)" :disabled="is_right_under(section, right)" @change="change_right(right)"> <span><b>{{ right }}</b> {{ said_of(right) }}<template v-if="is_right_under(section, right)">; {{ section.under[right] }} holds it</template></span></label>
                        </div>
                        <div v-if="((section.value === 'files') && files_chosen)" class="tk-under">
                            <label for="tk-folders" class="muted">Folders</label>
                            <textarea id="tk-folders" v-model="folders" rows="3" placeholder="~/visual-agency&#10;~/notes" spellcheck="false"></textarea>
                            <p class="muted">One a line, the same on each of its machines; <code>~</code> is that machine's home. A folder not there yet is made when something is first written into it. A link inside that leads out is refused too.</p>
                        </div>
                        <div v-if="((section.value === 'apps') && rights_chosen.includes('apps'))" class="tk-checks tk-under">
                            <label class="check"><input type="checkbox" v-model="apps_own"> <span><b>only the apps it makes</b> a new name, then that app's new versions; an app someone else has, yours or another token's, is refused</span></label>
                        </div>
                        <div v-if="((section.value === 'apps') && rights_chosen.includes('versions'))" class="tk-checks tk-under">
                            <span class="muted">{{ (services.length === 0) ? 'New versions: no app folder yet' : 'New versions of the app folders ticked; none ticked, of every app folder on its machines' }}</span>
                            <label v-for="name of services" :key="name" class="check"><input type="checkbox" :value="name" v-model="services_chosen"> {{ name }}</label>
                        </div>
                    </template>
                </div>
            </div>
        </template>
        <template #where>
            <div class="tk-checks">
                <label class="check"><input type="checkbox" v-model="every"> <span><b>every machine</b> new ones too</span></label>
                <label v-for="name of remotes" :key="name" class="check" :class="{off: every}"><input type="checkbox" :value="name" v-model="remotes_chosen" :disabled="every"> {{ name }}</label>
                <span v-if="(remotes.length === 0)" class="muted">no machine yet</span>
            </div>
        </template>
        <template #check>
            <div class="check-rows">
                <div v-for="row of check_rows" :key="row.key" class="check-row">
                    <span class="cr-text"><span class="muted">{{ row.title }}</span><span>{{ row.text }}</span></span>
                    <button type="button" class="link" @click="step = row.step">Change</button>
                </div>
            </div>
            <p class="muted">Made, it is shown once to copy: only its hash is kept.</p>
        </template>
        <template #summary>
            <div class="sum-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M11 12h.01M15 12h2"/></svg><b>{{ label || 'no label yet' }}</b></div>
            <p v-for="row of check_rows.slice(1)" :key="row.key" class="sum-line"><span>{{ row.text }}</span></p>
        </template>
        <template #note>
            <span v-if="((step_ok.ok === false) && (note === ''))" class="muted">{{ not_ready_said }}</span>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <page-head category="tokens" :count="tokens.length">
        <template #acts>
            <button type="button" class="primary" @click="new_begin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New token</button>
        </template>
        <template #how>
            <p>Each one lets an agent or a program do what you give it below with the machines it names, through the control socket, with <code>Authorization: Bearer &lt;token&gt;</code>. It never touches the secrets, another machine, the config but the forwards its forwards right writes between its machines and the apps of files its apps right sends, or a service but the one its versions right sends a new version to.</p>
        </template>
    </page-head>
    <p class="muted tk-row">
        <span>This page is signed in with the owner's token, which <code>bin/owner-token</code> prints.<template v-if="(owner_token_file !== null)"> Should it leak, delete <code>{{ owner_token_file }}</code> and restart serviceman: a new one is made, and every page signs in again.</template></span>
        <button type="button" @click="sign_out">Sign out</button>
    </p>

    <div v-if="(made !== null)" class="tk-made">
        <p><b>{{ made.label }}</b>: copy it now. Only its hash is kept, so it cannot be copied later.</p>
        <div class="tk-made-row">
            <code class="tk-hidden">{{ secret_hidden(made.token, made.token) }}</code>
            <button type="button" @click="copy('token', made.token)">{{ (copied === 'token') ? 'Copied' : 'Copy' }}</button>
        </div>
        <p>For an agent's box, as its environment:</p>
        <div class="tk-made-row">
            <code class="tk-hidden">{{ secret_hidden(env_line, made.token) }}</code>
            <button type="button" @click="copy('env', env_line)">{{ (copied === 'env') ? 'Copied' : 'Copy' }}</button>
        </div>
        <p>To check it, on the machine serviceman runs on:</p>
        <div class="tk-made-row">
            <code class="tk-hidden">{{ secret_hidden(check_line, made.token) }}</code>
            <button type="button" @click="copy('check', check_line)">{{ (copied === 'check') ? 'Copied' : 'Copy' }}</button>
        </div>
    </div>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <data-table :columns="columns" :rows="tokens" row_key="id" actions_label="" :actions_fold="9" empty="None yet: + New token makes one, for an agent or a program.">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'label')" class="row-of">
                <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M11 12h.01M15 12h2"/></svg>
                <b>{{ row.label }}</b>
            </span>
            <span v-else-if="(column.key === 'machines')">{{ machines_text(row) }}</span>
            <span v-else-if="(column.key === 'rights')" class="muted"><template v-for="(part, index) of sections_of(row)" :key="part.value">{{ (index > 0) ? ' · ' : '' }}{{ part.said }}<template v-if="((part.value === 'files') && (row.folders.length > 0))"> in <code>{{ row.folders.join(', ') }}</code></template><template v-if="((part.value === 'apps') && (row.services.length > 0))">{{ (part.level === 'fine') ? '' : ', versions' }} of <code>{{ row.services.join(', ') }}</code></template><template v-if="((part.value === 'apps') && row.apps_own)">, only the apps it makes<template v-if="(row.apps.length > 0)">: <code>{{ row.apps.join(', ') }}</code></template><template v-else>, none yet</template></template></template></span>
            <span v-else-if="(column.key === 'used')" class="muted">{{ used_text(row) }}</span>
        </template>
        <template #actions="{row, ask}">
            <button type="button" :disabled="busy" @click="edit_open(row)">Edit…</button>
            <button type="button" :disabled="busy" @click="ask('Rotate ' + row.label + '? It gets a new value with the same rights, and the one it has now stops working at once.', 'Rotate', () => rotate(row))">Rotate…</button>
            <button type="button" class="danger" :disabled="busy" @click="ask('Revoke ' + row.label + '? It stops working at once: whoever uses it is refused, what it holds open is cut, and the forwards it asked for are set aside.', 'Revoke', () => revoke(row))">Revoke…</button>
        </template>
    </data-table>
    </template>
</article>
`,
    components: {'data-table': data_table, 'page-head': page_head, 'step-frame': step_frame},
    emits: [],
    data: function () {
        return {
            tokens: [],
            // The sections a token's rights are given by (token_sections)
            sections: token_sections,
            remotes: [],
            // The app folders a versions right can be kept to
            services: [],
            socket: null,
            port: null,
            owner_token_file: null,
            // The token being changed, or null while the form makes a new one
            editing: null,
            // The form shown in place of the list, the step it is at and how it is shown
            form_open: false,
            step: 0,
            mode: 'steps',
            label: '',
            every: false,
            remotes_chosen: [],
            rights_chosen: [],
            // The sections whose rights show one by one, by value
            fine_open: [],
            folders: '',
            services_chosen: [],
            // Its apps right kept to the apps it makes: a new token starts kept
            apps_own: true,
            // The token just made or rotated, the one time it can be copied: {label, token}
            made: null,
            copied: '',
            busy: false,
            bad: false,
            note: '',
        };
    },
    computed: {
        columns: function () {
            return [
                {key: 'label', label: 'Label', wraps: true},
                {key: 'machines', label: 'Machines', fold: 3},
                {key: 'rights', label: 'Rights', fold: 2, wraps: true},
                {key: 'used', label: 'Used', fold: 1},
            ];
        },
        folders_list: function () {
            return this.folders.split('\n').map(v => v.trim()).filter(v => (v !== ''));
        },
        // A right of the file manager, which is kept within the folders typed
        files_chosen: function () {
            return this.rights_chosen.includes('files') || this.rights_chosen.includes('files_read');
        },
        // Who for, its rights, its machines, then Check; an edit is one page of the first three
        steps: function () {
            const out = [
                {key: 'who', name: 'Who for', question: 'Who is it for?', answer: this.label},
                {key: 'rights', name: 'Rights', question: 'What may it do?', answer: (this.rights_chosen.length === 0) ? '' : this.sections_of(this.form_item).map(v => v.said).join(' · ')},
                {key: 'where', name: 'Where', question: 'On which machines?', answer: this.machines_text(this.form_item)},
            ];
            if ((this.editing === null) && (this.mode === 'steps')) {
                out.push({key: 'check', name: 'Check', question: 'Check, then make it', answer: ''});
            }
            return out;
        },
        // The form's answers as a token is said: for its own lines, and Check's
        form_item: function () {
            return {label: this.label, remotes: this.every ? ['*'] : this.remotes_chosen, rights: this.rights_chosen, folders: this.folders_list, services: this.services_chosen, apps_own: this.apps_own, apps: []};
        },
        check_rows: function () {
            const item = this.form_item;
            return [
                {key: 'who', step: 0, title: 'Who for', text: item.label},
                {key: 'rights', step: 1, title: 'Rights', text: this.sections_of(item).map(v => v.said).join(' · ') + ((this.files_chosen && (item.folders.length > 0)) ? ` · in ${item.folders.join(', ')}` : '')},
                {key: 'where', step: 2, title: 'Where', text: this.machines_text(item)},
            ];
        },
        // What the open step wants before Next
        step_ok: function () {
            const key = (this.mode === 'page') ? 'all' : this.steps[Math.min(this.step, this.steps.length - 1)].key;
            if (((key === 'who') || (key === 'all')) && (this.label === '')) {
                return {ok: false, why: 'It wants a label first.'};
            }
            if ((key === 'rights') || (key === 'all') || (key === 'check')) {
                return {ok: this.ready, why: this.not_ready_said};
            }
            return {ok: true, why: ''};
        },
        ready: function () {
            return this.not_ready_said === '';
        },
        // What the form wants before the token can be made or saved, said beside the button
        not_ready_said: function () {
            if (this.label === '') {
                return 'It wants a label first.';
            }
            if (this.rights_chosen.length === 0) {
                return 'It wants a right first: a section set to read or write.';
            }
            if (this.files_chosen && (this.folders_list.length === 0)) {
                return 'Its files want a folder: one a line, under Files.';
            }
            return '';
        },
        env_line: function () {
            return `SERVICEMAN_TOKEN=${this.made.token}`;
        },
        // The status, asked through the socket when there is one, else the control port
        check_line: function () {
            const auth = `-H "Authorization: Bearer ${this.made.token}"`;
            if (this.socket !== null) {
                return `curl --unix-socket ${this.socket} ${auth} http://localhost/api/v1/status`;
            }
            return `curl ${auth} http://127.0.0.1:${this.port}/api/v1/status`;
        },
    },
    methods: {
        secret_hidden,
        load: async function () {
            const answer = await fetch('/api/v1/tokens', {cache: 'no-store'});
            const body = await answer.json();
            this.tokens = body.tokens;
            this.remotes = body.remotes;
            this.services = body.services;
            this.socket = body.socket;
            this.port = body.port;
            this.owner_token_file = body.owner_token_file;
        },
        said_of: function (right) {
            return (RIGHTS_SAID[right] === undefined) ? '' : RIGHTS_SAID[right];
        },
        level_of: function (section) {
            return token_level_of(section, this.rights_chosen);
        },
        // The rights of a section given a choice of them, as its fine ticks show them
        format_rights_ticked: function (section) {
            return section.rights.filter(v => this.is_right_held(section, v)).join(', ');
        },
        // The sections a token has rights in, each in a few words: {value, level, said}
        sections_of: function (item) {
            return token_sections.map(v => ({value: v.value, level: token_level_of(v, item.rights), said: format_token_section(v, item.rights)})).filter(v => (v.said !== ''));
        },
        // A read alone ticked by the right it is under, which holds it too: files_read by files
        is_right_under: function (section, right) {
            return (section.under[right] !== undefined) && this.rights_chosen.includes(section.under[right]);
        },
        is_right_held: function (section, right) {
            return this.rights_chosen.includes(right) || this.is_right_under(section, right);
        },
        click_level: function (section, level) {
            this.rights_chosen = token_section_set(this.rights_chosen, section, level);
        },
        click_all_read_only: function () {
            let rights = this.rights_chosen;
            for (const section of token_sections) {
                rights = token_section_set(rights, section, (section.read === null) ? 'none' : 'read');
            }
            this.rights_chosen = rights;
        },
        click_fine: function (section) {
            const open = this.fine_open.includes(section.value);
            this.fine_open = open ? this.fine_open.filter(v => (v !== section.value)) : this.fine_open.concat([section.value]);
        },
        change_right: function (right) {
            const chosen = this.rights_chosen.includes(right);
            this.rights_chosen = chosen ? this.rights_chosen.filter(v => (v !== right)) : this.rights_chosen.concat([right]);
        },
        machines_text: function (item) {
            if (item.remotes.includes('*')) {
                return 'every machine';
            }
            return (item.remotes.length === 0) ? 'no machine' : item.remotes.join(', ');
        },
        used_text: function (item) {
            if (item.used_at === null) {
                return 'not used yet';
            }
            return `used ${format_ms_ago(Date.now() - Date.parse(item.used_at))}`;
        },
        // A new token's form, empty, in place of the list, its label to type
        new_begin: function () {
            this.form_reset();
            Object.assign(this, {made: null, note: '', bad: false, form_open: true, step: 0, mode: 'steps'});
            this.$nextTick(() => this.$refs.label.focus());
        },
        step_go: function (index) {
            if ((index > this.step) && (this.step_ok.ok === false)) {
                return;
            }
            this.step = index;
        },
        form_close: function () {
            this.form_open = false;
            this.form_reset();
        },
        // Make the token or save the changes; a step that wants something opens first
        create_click: async function () {
            if (this.ready === false) {
                if ((this.editing === null) && (this.mode === 'steps')) {
                    this.step = (this.label === '') ? 0 : 1;
                }
                return;
            }
            await this.save();
        },
        // The form takes the token's fields, and the page goes to it
        edit_open: function (item) {
            this.editing = item;
            this.label = item.label;
            this.every = item.remotes.includes('*');
            this.remotes_chosen = item.remotes.filter(v => (v !== '*'));
            this.rights_chosen = item.rights.slice();
            // A section given a choice of its rights shows them, ticked as they are
            this.fine_open = token_sections.filter(v => (token_level_of(v, item.rights) === 'fine')).map(v => v.value);
            this.folders = item.folders.join('\n');
            this.services_chosen = item.services.slice();
            // One given the apps right now starts kept, as a new token does
            this.apps_own = item.rights.includes('apps') ? item.apps_own : true;
            this.made = null;
            this.note = '';
            this.bad = false;
            this.step = 0;
            this.mode = 'page';
            this.form_open = true;
        },
        form_reset: function () {
            this.editing = null;
            this.label = '';
            this.every = false;
            this.remotes_chosen = [];
            this.rights_chosen = [];
            this.fine_open = [];
            this.folders = '';
            this.services_chosen = [];
            this.apps_own = true;
        },
        save: async function () {
            const body = {label: this.label, remotes: this.every ? ['*'] : this.remotes_chosen, rights: this.rights_chosen, folders: this.folders_list, services: this.services_chosen, apps_own: this.apps_own};
            const editing = this.editing;
            const loaded = await this.call((editing === null) ? '/api/v1/tokens' : `/api/v1/tokens/${editing.id}`, (editing === null) ? 'POST' : 'PUT', body);
            if (loaded === null) {
                return;
            }
            this.made = (editing === null) ? {label: loaded.item.label, token: loaded.token} : null;
            this.copied = '';
            this.note = (editing === null) ? '' : `${loaded.item.label} is saved${aside_text(loaded)}`;
            this.form_reset();
            this.form_open = false;
            await this.load();
        },
        rotate: async function (item) {
            const loaded = await this.call(`/api/v1/tokens/${item.id}/rotate`, 'POST', null);
            if (loaded === null) {
                return;
            }
            this.made = {label: loaded.item.label, token: loaded.token};
            this.copied = '';
            this.note = '';
            await this.load();
        },
        revoke: async function (item) {
            const loaded = await this.call(`/api/v1/tokens/${item.id}`, 'DELETE', null);
            if (loaded === null) {
                return;
            }
            this.note = `${item.label} is revoked${aside_text(loaded)}`;
            if ((this.editing !== null) && (this.editing.id === item.id)) {
                this.form_reset();
            }
            await this.load();
        },
        // One request of this page: its answer, or null with what went wrong said beside Save
        call: async function (url, method, body) {
            this.busy = true;
            this.bad = false;
            this.note = '';
            try {
                const answer = await fetch(url, (body === null) ? {method} : {method, body: JSON.stringify(body)});
                const loaded = await answer.json();
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = loaded.error;
                    return null;
                }
                return loaded;
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
                return null;
            }
            finally {
                this.busy = false;
            }
        },
        copy: async function (what, text) {
            if (await to_clipboard(text)) {
                this.copied = what;
            }
        },
        sign_out: async function () {
            await fetch('/api/v1/session', {method: 'DELETE'});
            window.location.reload();
        },
    },
    created: function () {
        this.load();
    },
};

export default tokens_form;
