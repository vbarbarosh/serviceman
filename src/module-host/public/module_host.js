import {createApp, markRaw} from 'vue';

const THEME_KEY = 'module-host.theme';

// What each module's component is given here, from this computer (its name, user, cores and
// addresses) and the page's theme: its API is /api/<key>, as serviceman gives it a machine's
const MODULE_PROPS = {
    processes: v => ({base: '/api/processes', cores: v.machine.cores}),
    disks: () => ({base: '/api/disks'}),
    packages: () => ({base: '/api/packages'}),
    docker: function (v) {
        return {
            base: '/api/docker',
            theme: v.theme,
            streams: '/api/v1/streams',
            // A container's files, the File Manager's API over a disk inside it
            files_base: vv => `/api/docker/containers/${vv.id}/fs`,
            // A shell in a container, the Terminal module's websocket
            shell_url: vv => `/api/shell?container=${vv.id}`,
        };
    },
    file_manager: v => ({base: '/api/file_manager', theme: v.theme, title: v.machine.hostname, user: v.machine.user, home_title: `The home folder of ${v.machine.user}`, disk: v.machine.hostname, targets: []}),
    // The control page's own terminal tabs, around the Terminal module's pane
    terminal: v => ({view: {name: v.machine.hostname, title: v.machine.hostname}, theme: v.theme, base: '/api/terminal'}),
    firewall: v => ({base: '/api/firewall', addresses: v.machine.addresses}),
    volumes: v => ({machines: [{name: v.machine.hostname, title: v.machine.hostname, base: '/api/volumes', offline: false, user: v.machine.user}]}),
};

// The modules whose page half is a part of a page on serviceman's (Volumes is a section of
// Storage), and is given that page's article here, so it stands where the others do
const WITHIN_PAGE = ['volumes'];

// serviceman's modules on this computer: one at a time beside the list of them, each loaded
// from its own page half the first time it is opened; every module's styles from the start,
// since one module opens another inside it (Docker a container's files and its shell)
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
        <article v-else-if="WITHIN_PAGE.includes(key)" class="list">
            <component :is="loaded" :key="key" v-bind="props"/>
        </article>
        <component v-else :is="loaded" :key="key" v-bind="props"/>
    </div>
</div>
`,
    data: function () {
        return {WITHIN_PAGE, modules: [], machine: null, key: null, loaded: null, error: '', theme: document.documentElement.dataset.theme};
    },
    computed: {
        props: function () {
            const make = MODULE_PROPS[this.key];
            return (make === undefined) ? {} : make({machine: this.machine, theme: this.theme});
        },
    },
    methods: {
        // The module named in the address, or the first; its component on first use
        open: async function (key) {
            this.key = key;
            this.loaded = null;
            this.error = '';
            if (location.hash !== `#${key}`) {
                history.replaceState(null, '', `#${key}`);
            }
            try {
                const found = await import(this.modules.find(v => v.key === key).page);
                if (key === this.key) {
                    this.loaded = markRaw(found.default);
                }
            }
            catch (error) {
                this.error = `Could not load ${key}: ${error.message}`;
            }
        },
        theme_flip: function () {
            this.theme = (this.theme === 'light') ? 'dark' : 'light';
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
            const [modules, machine] = await Promise.all(['/api/modules', '/api/machine'].map(answer_read));
            this.modules = modules;
            this.machine = machine;
            for (const item of modules) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = `/_/${item.key}/${item.key}.css`;
                document.head.appendChild(link);
            }
        }
        catch (error) {
            this.error = `Could not read this computer: ${error.message}`;
            return;
        }
        const asked = location.hash.slice(1);
        this.open(this.modules.some(v => v.key === asked) ? asked : this.modules[0].key);
    },
};

// A refusal says why: a browser that has not the key is told to open the address module-host printed
async function answer_read(url)
{
    const answer = await fetch(url, {cache: 'no-store'});
    const outcome = await answer.json();
    if (answer.ok === false) {
        throw new Error(outcome.error);
    }
    return outcome;
}

createApp(module_host).mount('#app');
