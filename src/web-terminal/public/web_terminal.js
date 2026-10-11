import terminal from 'terminal/terminal.js';

import {createApp} from 'vue';

const SESSIONS_EVERY_MS = 5000;

// One terminal over the whole window. The path says which: /<name> is a kept session, / is a
// shell of its own. The head lists the kept sessions, so one is a click away from another.
const web_terminal = {
    template: `
<terminal id="page" :url="url" :theme="theme" :restart="true">
    <template #head>
        <header>
            <h1>{{ title }}</h1>
            <nav>
                <span class="muted">Kept:</span>
                <span v-if="(sessions.length === 0)" class="muted">none yet</span>
                <a v-for="item in sessions" :key="item.name" :href="('/' + item.name)" :class="{now: (item.name === name)}" :title="(item.attached + ' attached')">{{ item.name }}</a>
            </nav>
            <button type="button" class="theme" :title="('Switch to ' + (theme === 'dark' ? 'light' : 'dark'))" @click="theme_toggle">{{ (theme === 'dark' ? 'Dark' : 'Light') }}</button>
        </header>
    </template>
</terminal>
`,
    components: {terminal},
    data: function () {
        return {
            theme: document.documentElement.dataset.theme,
            sessions: [],
        };
    },
    computed: {
        url: function () {
            return location.pathname;
        },
        name: function () {
            return location.pathname.replace(/^\/|\/$/g, '');
        },
        title: function () {
            return ((this.name === '') ? 'A terminal of its own' : this.name);
        },
    },
    methods: {
        sessions_load: async function () {
            try {
                const answer = await fetch('/_/sessions', {cache: 'no-store'});
                this.sessions = (await answer.json()).sessions;
            }
            catch {
                // The list waits for the next round; the terminal does not depend on it
            }
        },
        theme_toggle: function () {
            this.theme = ((this.theme === 'dark') ? 'light' : 'dark');
            document.documentElement.dataset.theme = this.theme;
            try {
                localStorage.setItem('web-terminal.theme', this.theme);
            }
            catch {
                // A page without storage keeps the choice until it closes
            }
        },
    },
    mounted: function () {
        document.title = ((this.name === '') ? 'Terminal' : `${this.name} · Terminal`);
        this.sessions_load();
        this.timer = setInterval(() => this.sessions_load(), SESSIONS_EVERY_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
};

createApp(web_terminal).mount('#app');
