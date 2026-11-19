import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import secret_name_said from './secret_name_said.js';
import secret_write from './secret_write.js';
import service_kind from './service_kind.js';
import state_read from './state_read.js';
import step_frame from './step_frame.js';

// Everything kept on this host, in one table: the library, and what each service reads.
//
// A secret made on a service's page is that service's own — it cannot be read by anything else
// and cannot be reused. The library is the place to write a value down once and copy it into
// as many services as need it; copying happens here on the host, so a value never goes out to
// a page and back.
const secrets_form = {
    template: `
<article id="detail" class="list form">
    <!-- A new one, step by step: its name and value, then the services given a copy of it -->
    <step-frame v-if="adding" title="New secret" :steps="steps" :step="step" :mode="mode" :can_next="value_ok.ok" :next_title="value_ok.why" :busy="busy" create_label="Create secret" @step="step_go" @mode="mode = $event" @cancel="adding = false" @create="save">
        <template #value>
            <div class="sf-field">
                <label for="secret-name">Name</label>
                <input id="secret-name" ref="name" v-model.trim="name" class="sf-mono" placeholder="google-oauth" :class="{wrong: (name_said !== '')}" spellcheck="false">
                <p v-if="(name_said !== '')" class="sf-hint bad">{{ name_said }}</p>
                <p v-else class="sf-hint">a program asks for it by name: <code>secrets {{ name || 'google-oauth' }}</code></p>
            </div>
            <div class="sf-field">
                <span class="sf-label-row">
                    <label for="secret-value">Value</label>
                    <span class="row-of">
                        <button type="button" class="link" @click="shown = (shown === false)">{{ shown ? 'Hide' : 'Show' }}</button>
                        <button type="button" class="link" @click="$refs.file.click()">From a file…</button>
                        <input ref="file" type="file" hidden @change="value_from_file">
                    </span>
                </span>
                <textarea id="secret-value" v-model="value" rows="4" class="sf-mono" :class="{'secret-hidden': (shown === false)}" placeholder='{"web": {"client_id": "…", "client_secret": "…"}}' spellcheck="false" autocomplete="off"></textarea>
            </div>
        </template>
        <template #given>
            <div v-if="((programs !== null) && (programs.length > 0))" class="sf-list" role="group" aria-label="The services given a copy">
                <label v-for="item of programs" :key="item.name" class="sf-li" :class="{on: given.includes(item.name)}">
                    <input v-model="given" type="checkbox" :value="item.name" :aria-label="('Given to ' + item.name)">
                    <b>{{ item.name }}</b>
                    <span class="muted">{{ item.what }}</span>
                </label>
            </div>
            <p v-if="(programs === null)" class="sf-hint"><span class="spin"/>reading the services…</p>
            <p v-else-if="(programs.length === 0)" class="sf-hint">No service yet: it waits in the library.</p>
        </template>
        <template #summary>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg><span class="mono">{{ name || 'no name yet' }}</span></p>
            <p class="sum-line"><span>{{ (value === '') ? 'no value yet' : (value.length + ' characters, in the library') }}</span></p>
            <p class="sum-line"><span>{{ (given.length === 0) ? 'given to no service yet' : ('a copy for ' + given.join(', ')) }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <page-head category="secrets" :count="(global.length + services.length)">
        <template #acts>
            <button type="button" class="primary" :disabled="adding" @click="add_begin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New secret</button>
        </template>
        <template #how>
            <p>Kept beside what serviceman writes about itself, readable by nobody else, and never in the config. A program asks for one by name — <code>secrets credentials</code> — and gets the one its own service holds. The library is written down once, to be copied into the services that need it; a service's own is made on its page, and private to it.</p>
        </template>
    </page-head>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <data-table :columns="columns" :rows="rows" row_key="key" framed :total="(global.length + services.length)" :foot="foot" :empty_icon="SECRETS_ICON" empty_title="No secrets yet" empty="A secret is written down once into the library and copied into the services given it; a service's own is made on its page.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a secret" aria-label="Find a secret by its name or its service" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #empty_act><button type="button" class="primary" :disabled="adding" @click="add_begin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New secret</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="SECRETS_ICON" :name="row.name" :line="((row.service === null) ? 'the library' : ('held by ' + row.service))" mono/>
            <span v-else-if="(column.key === 'length')">{{ row.length }} characters</span>
            <span v-else-if="(column.key === 'users')" class="muted">{{ row.users }}</span>
        </template>
        <template #actions="{row, ask}">
            <button type="button" class="danger" :disabled="busy" @click="ask(row.question, 'Forget it', () => drop(row.service, row.name))">Take it away…</button>
        </template>
    </data-table>
    </template>
</article>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'step-frame': step_frame},
    emits: ['form'],
    data: function () {
        return {
            SECRETS_ICON: CATEGORIES.find(v => v.key === 'secrets').icon,
            global: [],
            services: [],
            name: '',
            value: '',
            // The library's form is open, for one more secret: its step, how it is shown, the
            // value shown or dots, the services given a copy, and the services there are
            adding: false,
            step: 0,
            mode: 'steps',
            shown: false,
            given: [],
            programs: null,
            filter: '',
            show: 'all',
            busy: false,
            // While Keep it is on its way to the door, which its button then says
            keeping: false,
            bad: false,
            note: '',
        };
    },
    computed: {
        // The form open, as the crumbs name it after the category; '' when none is
        form_crumb: function () {
            return this.adding ? 'New secret' : '';
        },
        // What the door would say to the name as it stands, said under its box before it is asked
        name_said: function () {
            return secret_name_said(this.name);
        },
        steps: function () {
            return [
                {key: 'value', name: 'Value', question: 'What is the secret?', says: 'Kept by serviceman only, never in the config.', answer: this.name},
                {key: 'given', name: 'Given to', question: 'Which services get it?', says: 'Each gets a copy of its own, under the same name; none is fine, it waits in the library.', answer: (this.given.length === 0) ? 'the library alone' : this.given.join(', ')},
            ];
        },
        value_ok: function () {
            if (this.name === '') {
                return {ok: false, why: 'A name first'};
            }
            if (this.name_said !== '') {
                return {ok: false, why: this.name_said};
            }
            return (this.value === '') ? {ok: false, why: 'Its value first'} : {ok: true, why: ''};
        },
        chips: function () {
            return [
                {value: 'all', label: 'All', count: this.global.length + this.services.length},
                {value: 'library', label: 'The library', count: this.global.length},
                {value: 'services', label: 'Held by services', count: this.services.length},
            ];
        },
        // Its name over where it is kept, its length, who has a copy; on a phone the copies a
        // line of their own
        columns: function () {
            return [
                {key: 'name', label: 'Name'},
                {key: 'length', label: 'Length', fold: 1, align: 'right', phone: 'hide'},
                {key: 'users', label: 'Given to', fold: 2, hide: v => (v.users === ''), phone: 'row'},
            ];
        },
        // The footer: how many, in the library and held by services
        foot: function () {
            const all = this.global.length + this.services.length;
            return [{text: `${all} ${(all === 1) ? 'secret' : 'secrets'}`, tone: ''}, {text: `${this.global.length} in the library`, tone: ''}, {text: `${this.services.length} held by services`, tone: ''}];
        },
        // The library first, then each service's own, as the chips and the filter leave them
        rows: function () {
            const wanted = this.filter.toLowerCase();
            const library = (this.show === 'services') ? [] : this.global.map(v => ({key: `library ${v.name}`, name: v.name, service: null, length: v.length, users: this.users_text(v.name), question: `Forget ${v.name}? Services holding a copy keep theirs.`}));
            const own = (this.show === 'library') ? [] : this.services.map(v => ({key: `${v.service} ${v.name}`, name: v.name, service: v.service, length: v.length, users: '', question: `Forget it? ${v.service} will not find it any more.`}));
            return library.concat(own).filter(v => (wanted === '') || `${v.name} ${v.service || ''}`.toLowerCase().includes(wanted));
        },
    },
    watch: {
        // The crumbs name the form while it is open
        form_crumb: function (title) {
            this.$emit('form', title);
        },
    },
    beforeUnmount: function () {
        this.$emit('form', '');
    },
    methods: {
        load: async function () {
            const answer = await fetch('/api/v1/secrets', {cache: 'no-store'});
            const body = await answer.json();
            this.global = body.global;
            this.services = body.services;
        },
        // This page is told how long a value is and never what it is, so it cannot say who
        // holds a copy of one — two secrets of a size are not the same secret. It says what it
        // does know, which is enough to find the one you meant.
        users_text: function (name) {
            const found = this.global.find(v => v.name === name);
            const users = [...new Set(this.services.filter(v => v.length === found.length).map(v => v.service))];
            if (users.length === 0) {
                return 'no service holds one this long';
            }
            return `${users.join(', ')} ${(users.length === 1) ? 'holds' : 'hold'} one this long`;
        },
        // The boxes are emptied for the next one only when the door has this one: what it did
        // not take stays as it was typed, to be put right
        add_begin: async function () {
            Object.assign(this, {adding: true, step: 0, name: '', value: '', shown: false, given: [], note: '', bad: false});
            this.$nextTick(() => this.$refs.name.focus());
            try {
                const state = await state_read();
                this.programs = state.services.map(v => ({name: v.name, what: [service_kind(v).word, ((v.remotes === undefined) || (v.remotes.length === 0)) ? '' : v.remotes[0]].filter(vv => vv !== '').join(' · ')}));
            }
            catch {
                this.programs = [];
            }
        },
        step_go: function (index) {
            if ((index > this.step) && (this.value_ok.ok === false)) {
                return;
            }
            this.step = index;
        },
        value_from_file: async function (event) {
            const file = event.target.files[0];
            if (file !== undefined) {
                this.value = await file.text();
            }
            event.target.value = '';
        },
        // The library first, then a copy for each service ticked, each from the library by name
        save: async function () {
            this.keeping = true;
            const name = this.name;
            let kept = await this.write({name, value: this.value}, `${name} is kept`);
            for (const service of this.given) {
                if (kept === false) {
                    break;
                }
                kept = await this.write({service, name, copy_from: name}, `${name} is kept, and given to ${this.given.join(', ')}`);
            }
            this.keeping = false;
            if (kept) {
                this.name = '';
                this.value = '';
                this.given = [];
                this.adding = false;
            }
            else {
                // What the door refused is shown where it was typed
                this.step = 0;
            }
        },
        drop: async function (service, name) {
            await this.write({service, name, value: ''}, `${name} is gone`);
        },
        // Answers with whether the door did it; what it said instead is the note
        write: async function (body, said) {
            this.busy = true;
            this.bad = false;
            this.note = '';
            const kept = await secret_write(body);
            this.busy = false;
            if (kept.error !== undefined) {
                this.bad = true;
                this.note = kept.error;
                return false;
            }
            this.global = kept.global;
            this.services = kept.services;
            this.note = said;
            return true;
        },
    },
    created: function () {
        this.load();
    },
};

export default secrets_form;
