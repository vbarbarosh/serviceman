import {createApp, markRaw} from 'vue';

const THEME_KEY = 'module-host.theme';

// What each module's component is given here, from this computer: its API is /api/<key>
const MODULE_PROPS = {
    firewall: v => ({base: '/api/firewall', addresses: v.addresses}),
};

// serviceman's modules on this computer: one at a time beside the list of them, each loaded
// from its own page half the first time it is opened
const module_host = {
    template: `
<div class="mh-head">
    <b>{{ ((machine === null) ? 'This computer' : machine.hostname) }}</b>
    <span class="muted">this computer, no serviceman</span>
    <button type="button" class="mh-theme" :title="('Theme: ' + theme)" :aria-label="('Theme: ' + theme)" @click="theme_flip">
        <svg v-if="(theme === 'light')" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
    </button>
</div>
<div class="mh-body">
    <div class="mh-nav">
        <button v-for="item in modules" :key="item.key" type="button" :class="{on: (item.key === key)}" @click="open(item.key)">{{ item.title }}</button>
    </div>
    <div class="mh-main">
        <p v-if="(error !== '')" class="bad">{{ error }}</p>
        <p v-else-if="((loaded === null) || (machine === null))" class="muted">Loading…</p>
        <component v-else :is="loaded" :key="key" v-bind="props"/>
    </div>
</div>
`,
    data: function () {
        return {modules: [], machine: null, key: null, loaded: null, error: '', theme: document.documentElement.dataset.theme};
    },
    computed: {
        props: function () {
            const make = MODULE_PROPS[this.key];
            return ((make === undefined) ? {} : make(this.machine));
        },
    },
    methods: {
        // The module named in the address, or the first; its css and component on first use
        open: async function (key) {
            this.key = key;
            this.loaded = null;
            this.error = '';
            if (location.hash !== `#${key}`) {
                history.replaceState(null, '', `#${key}`);
            }
            try {
                if (document.querySelector(`link[data-module="${key}"]`) === null) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = `/_/${key}/${key}.css`;
                    link.dataset.module = key;
                    document.head.appendChild(link);
                }
                const found = await import(`/_/${key}/${key}.js`);
                if (key === this.key) {
                    this.loaded = markRaw(found.default);
                }
            }
            catch (error) {
                this.error = `Could not load ${key}: ${error.message}`;
            }
        },
        theme_flip: function () {
            this.theme = ((this.theme === 'light') ? 'dark' : 'light');
            document.documentElement.dataset.theme = this.theme;
            try {
                localStorage.setItem(THEME_KEY, this.theme);
            }
            catch {
                // this page only
            }
        },
    },
    mounted: async function () {
        try {
            const [modules, machine] = await Promise.all([fetch('/api/modules'), fetch('/api/machine')].map(async v => (await v).json()));
            this.modules = modules;
            this.machine = machine;
        }
        catch (error) {
            this.error = `Could not read this computer: ${error.message}`;
            return;
        }
        const asked = location.hash.slice(1);
        this.open(this.modules.some(v => v.key === asked) ? asked : this.modules[0].key);
    },
};

createApp(module_host).mount('#app');
