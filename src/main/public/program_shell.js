import program_place from './program_place.js';
import terminal from 'terminal/terminal.js';

// How long a shell whose link dropped waits for its machine to answer again
const RECONNECT_TRIES = 30;
const RECONNECT_MS = 1000;

// A program's shell: a terminal kept on its machine, named after the service and opened in its
// folder. It is one of the machine's terminals, so its Shell tab lists it too, and leaving the
// page or a restart of the agent leaves it running; one running already keeps its own folder.
const program_shell = {
    template: `
<terminal v-if="(url !== null)" id="detail" :key="url" :url="url" :theme="theme" :restart="false" @ended="closed">
    <template #head>
        <div>
            <h1>{{ view.title || view.name }}</h1>
            <p class="muted">Opened in <code>{{ place.folder }}</code></p>
        </div>
    </template>
</terminal>
<article v-else id="detail" class="terminal">
    <h1>{{ view.title || view.name }}</h1>
    <p v-if="(place.remote === null)" class="muted">{{ place.why }}</p>
    <p v-else-if="(place.remote.phase !== 'online')" class="muted">{{ place.remote.name }} is not connected: its shell opens here when it is back.</p>
    <template v-else-if="ended">
        <p class="muted">The shell ended.</p>
        <p><button type="button" @click="open">Open again</button></p>
    </template>
    <p v-else-if="(error !== null)" class="bad">{{ error }} <button type="button" class="link" @click="open">Try again</button></p>
    <p v-else class="muted"><span class="spin"/>opening…</p>
</article>
`,
    components: {terminal},
    props: ['view', 'remotes', 'theme'],
    data: function () {
        // url: the stream the terminal is joined through; ended: `exit` was typed in it
        return {url: null, ended: false, error: null};
    },
    computed: {
        place: function () {
            return program_place(this.view, this.remotes);
        },
        // A terminal's name is letters, digits, - and _: a service's name, said in those
        term: function () {
            return this.view.name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 64);
        },
        terms_base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.place.remote.name)}/terminals`;
        },
        // The machine to open on, once it can be: a machine that comes back opens it then
        able: function () {
            return (this.place.remote !== null) && (this.place.remote.phase === 'online');
        },
    },
    watch: {
        able: function (next) {
            if (next && (this.url === null) && (this.ended === false)) {
                this.open();
            }
        },
    },
    methods: {
        // Made in the folder, then joined: a terminal of this name running already is only joined
        open: async function () {
            this.url = null;
            this.ended = false;
            this.error = null;
            if (this.able === false) {
                return;
            }
            try {
                const made = await fetch(this.terms_base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: this.term, cwd: this.place.folder})});
                if (made.ok === false) {
                    this.error = (await made.json()).error;
                    return;
                }
                const joined = await fetch(`${this.terms_base}/${encodeURIComponent(this.term)}/join`, {method: 'POST'});
                const body = await joined.json();
                if (joined.ok === false) {
                    this.error = body.error;
                    return;
                }
                this.url = body.url;
            }
            catch (error) {
                this.error = error.message;
            }
        },
        // The shell closed: `exit` was typed in it, or the link to the machine dropped. The
        // machine says which: one still running is joined again once it answers.
        closed: async function () {
            this.url = null;
            for (let i = 0; i < RECONNECT_TRIES; i++) {
                const items = await this.terminals_read();
                if (items !== null) {
                    if (items.some(v => v.name === this.term)) {
                        this.open();
                    }
                    else {
                        this.ended = true;
                    }
                    return;
                }
                await new Promise(v => setTimeout(v, RECONNECT_MS));
            }
            this.error = 'its machine does not answer';
        },
        terminals_read: async function () {
            try {
                const answer = await fetch(this.terms_base, {cache: 'no-store'});
                return answer.ok ? (await answer.json()).items : null;
            }
            catch {
                return null;
            }
        },
    },
    mounted: function () {
        this.open();
    },
};

export default program_shell;
