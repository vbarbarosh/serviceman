import data_table from './data_table.js';
import secret_name_said from './secret_name_said.js';
import secret_write from './secret_write.js';

// Everything kept on this host, in one table: the library, and what each service reads.
//
// A secret made on a service's page is that service's own — it cannot be read by anything else
// and cannot be reused. The library is the place to write a value down once and copy it into
// as many services as need it; copying happens here on the host, so a value never goes out to
// a page and back.
const secrets_form = {
    template: `
<article id="detail" class="list form">
    <div class="list-head">
        <h1>Secrets</h1>
        <span class="muted">{{ (global.length + services.length) }}</span>
        <div class="list-acts">
            <button type="button" class="primary" :disabled="adding" @click="add_begin">+ New secret</button>
        </div>
    </div>
    <p class="muted">Kept beside what serviceman writes about itself, readable by nobody else, and never in the config. A program asks for one by name — <code>secrets credentials</code> — and gets the one its own service holds. The library is written down once, to be copied into the services that need it; a service's own is made on its page, and private to it.</p>
    <div v-if="adding" class="card list-new">
        <div class="grid">
            <label for="secret-name">Name</label>
            <div>
                <input id="secret-name" ref="name" v-model.trim="name" placeholder="google-oauth" :class="{wrong: (name_said !== '')}" spellcheck="false">
                <p v-if="(name_said !== '')" class="bad">{{ name_said }}</p>
            </div>
            <label for="secret-value">Value</label>
            <div>
                <textarea id="secret-value" v-model="value" rows="3" placeholder='{"web": {"client_id": "…", "client_secret": "…"}}' spellcheck="false"></textarea>
            </div>
        </div>
        <div class="row-of">
            <button type="button" class="primary" :disabled="(busy || name === '' || value === '' || name_said !== '')" @click="save"><span v-if="keeping" class="spin"/>{{ keeping ? 'keeping…' : 'Keep it in the library' }}</button>
            <button type="button" :disabled="busy" @click="adding = false">Cancel</button>
        </div>
    </div>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="find a secret" aria-label="Find a secret by its name or its service" spellcheck="false">
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
    </div>
    <data-table :columns="columns" :rows="rows" row_key="key" actions_label="" :actions_fold="9" :empty="empty_text">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'name')" class="row-of">
                <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>
                <code>{{ row.name }}</code>
            </span>
            <span v-else-if="(column.key === 'kept')" :class="{muted: (row.service === null)}">{{ (row.service === null) ? 'the library' : row.service }}</span>
            <span v-else-if="(column.key === 'length')">{{ row.length }} characters</span>
            <span v-else-if="(column.key === 'users')" class="muted">{{ row.users }}</span>
        </template>
        <template #actions="{row, ask}">
            <button type="button" class="danger" :disabled="busy" @click="ask(row.question, 'Forget it', () => drop(row.service, row.name))">Take it away…</button>
        </template>
    </data-table>
</article>
`,
    components: {'data-table': data_table},
    emits: [],
    data: function () {
        return {
            global: [],
            services: [],
            name: '',
            value: '',
            // The library's form is open, for one more secret
            adding: false,
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
        // What the door would say to the name as it stands, said under its box before it is asked
        name_said: function () {
            return secret_name_said(this.name);
        },
        chips: function () {
            return [
                {value: 'all', label: 'All', count: this.global.length + this.services.length},
                {value: 'library', label: 'The library', count: this.global.length},
                {value: 'services', label: 'Held by services', count: this.services.length},
            ];
        },
        columns: function () {
            return [
                {key: 'name', label: 'Name', wraps: true},
                {key: 'kept', label: 'Kept by', fold: 2},
                {key: 'length', label: 'Length', fold: 1, align: 'right'},
                {key: 'users', label: 'Copies', fold: 3, hide: v => (v.users === '')},
            ];
        },
        // The library first, then each service's own, as the chips and the filter leave them
        rows: function () {
            const wanted = this.filter.toLowerCase();
            const library = (this.show === 'services') ? [] : this.global.map(v => ({key: `library ${v.name}`, name: v.name, service: null, length: v.length, users: this.users_text(v.name), question: `Forget ${v.name}? Services holding a copy keep theirs.`}));
            const own = (this.show === 'library') ? [] : this.services.map(v => ({key: `${v.service} ${v.name}`, name: v.name, service: v.service, length: v.length, users: '', question: `Forget it? ${v.service} will not find it any more.`}));
            return library.concat(own).filter(v => (wanted === '') || `${v.name} ${v.service || ''}`.toLowerCase().includes(wanted));
        },
        empty_text: function () {
            return ((this.global.length + this.services.length) === 0) ? 'None yet: + New secret writes one into the library; a service\'s page makes one of its own.' : 'Nothing matches.';
        },
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
        add_begin: function () {
            this.adding = true;
            this.$nextTick(() => this.$refs.name.focus());
        },
        save: async function () {
            this.keeping = true;
            const kept = await this.write({name: this.name, value: this.value}, `${this.name} is kept`);
            this.keeping = false;
            if (kept) {
                this.name = '';
                this.value = '';
                this.adding = false;
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
