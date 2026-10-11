// Everything kept on this host, in one table: the library, and what each service reads.
//
// A secret made on a service's page is that service's own — it cannot be read by anything else
// and cannot be reused. The library is the place to write a value down once and copy it into
// as many services as need it; copying happens here on the host, so a value never goes out to
// a page and back.
const secrets_form = {
    template: `
<article id="detail" class="form">
    <h1>Secrets</h1>
    <p class="muted">Kept beside what serviceman writes about itself, readable by nobody else, and never in the config. A program asks for one by name — <code>secrets credentials</code> — and gets the one its own service holds.</p>

    <h2>The library</h2>
    <p class="muted">Written down once, to be copied into the services that need it. Nothing reads these directly.</p>
    <dl v-if="(global.length > 0)">
        <template v-for="item of global" :key="item.name">
            <dt>{{ item.name }}</dt>
            <dd>
                <span class="muted">{{ item.length }} characters · {{ users_text(item.name) }}</span>
                <template v-if="(going !== item.name)">
                    <button type="button" @click="going = item.name">Take it away…</button>
                </template>
                <template v-else>
                    <span>Forget {{ item.name }}? Services holding a copy keep theirs.</span>
                    <button type="button" class="danger" :disabled="busy" @click="drop(null, item.name)">Forget it</button>
                    <button type="button" @click="going = ''">Keep it</button>
                </template>
            </dd>
        </template>
    </dl>
    <p v-else class="muted">Nothing here yet.</p>
    <div class="grid">
        <label>Name</label>
        <div><input v-model.trim="name" placeholder="google-oauth" spellcheck="false"></div>
        <label>Value</label>
        <div>
            <textarea v-model="value" rows="3" placeholder='{"web": {"client_id": "…", "client_secret": "…"}}' spellcheck="false"></textarea>
        </div>
    </div>
    <div class="actions">
        <button type="button" :disabled="(busy || name === '' || value === '')" @click="save">Keep it</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>

    <h2>Held by services</h2>
    <p class="muted">Made on a service's own page, and private to it. Two services may both hold a <code>token</code>; they are not the same token.</p>
    <dl v-if="(services.length > 0)">
        <template v-for="item of services" :key="(item.service + '.' + item.name)">
            <dt>{{ item.service }}</dt>
            <dd>
                <code>{{ item.name }}</code> <span class="muted">{{ item.length }} characters</span>
                <template v-if="(going !== item.service + '.' + item.name)">
                    <button type="button" @click="going = item.service + '.' + item.name">Take it away…</button>
                </template>
                <template v-else>
                    <span>Forget it? {{ item.service }} will not find it any more.</span>
                    <button type="button" class="danger" :disabled="busy" @click="drop(item.service, item.name)">Forget it</button>
                    <button type="button" @click="going = ''">Keep it</button>
                </template>
            </dd>
        </template>
    </dl>
    <p v-else class="muted">None yet — a service's page is where they are made.</p>
</article>
`,
    emits: [],
    data: function () {
        return {
            global: [],
            services: [],
            name: '',
            value: '',
            // The one whose "Take it away" has been pressed and not yet answered for
            going: '',
            busy: false,
            bad: false,
            note: '',
        };
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
        save: async function () {
            await this.write({name: this.name, value: this.value}, `${this.name} is kept`);
            this.name = '';
            this.value = '';
        },
        drop: async function (service, name) {
            await this.write({service, name, value: ''}, `${name} is gone`);
            this.going = '';
        },
        write: async function (body, said) {
            this.busy = true;
            this.bad = false;
            this.note = '';
            try {
                const answer = await fetch('/api/v1/secrets', {method: 'POST', body: JSON.stringify(body)});
                const loaded = await answer.json();
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = loaded.error;
                    return;
                }
                this.global = loaded.global;
                this.services = loaded.services;
                this.note = said;
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
            }
            finally {
                this.busy = false;
            }
        },
    },
    created: function () {
        this.load();
    },
};

export default secrets_form;
