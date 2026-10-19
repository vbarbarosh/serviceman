import command_copy from './command_copy.js';
import terminal from 'terminal/terminal.js';

// How often the list of kept terminals is asked again while the tab is open
const TERMINALS_POLL_MS = 5000;

// How long a terminal whose link dropped waits for its machine to answer again
const RECONNECT_TRIES = 30;
const RECONNECT_MS = 1000;

// The row of a machine's terminals, as a terminal app has it: a tab each, × on each, + after
const term_tabs = {
    template: `
<div class="term-tabs" role="tablist">
    <div v-for="item of items" :key="item.name" class="term-tab" :class="{on: (item.name === pick)}" role="tab" :aria-selected="(item.name === pick)">
        <button type="button" class="term-tab-name" :title="('Kept running on ' + machine)" @click="$emit('pick', item.name)">{{ label(item.name) }}</button>
        <button type="button" class="term-tab-end" :title="('End ' + label(item.name))" :aria-label="('End ' + label(item.name))" @click="$emit('end', item.name)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
    </div>
    <button type="button" class="term-tab-add" title="A new terminal, kept running on the machine" aria-label="A new terminal" @click="$emit('create')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <span v-if="(error !== null)" class="bad">{{ error }}</span>
    <span class="term-tabs-right">
        <command-copy :commands="commands"/>
    </span>
</div>
`,
    components: {'command-copy': command_copy},
    props: ['items', 'pick', 'machine', 'error', 'commands'],
    emits: ['pick', 'end', 'create'],
    methods: {
        // The terminals + makes are numbered, and read as a terminal app's tabs do
        label: function (name) {
            return /^\d+$/.test(name) ? `${name} · Shell` : name;
        },
    },
};

// The terminals of a machine. Each is kept running there by its agent, so leaving the page,
// or a restart of serviceman or of the agent, leaves it as it was; joining it again hands back
// what it printed, and the page's own terminal scrolls through it. × ends one, and its tab is
// gone at once.
const remote_shell = {
    template: `
<terminal v-if="(url !== null)" id="detail" :key="(url + '#' + joins)" :url="url" :theme="theme" :restart="false" @ended="closed">
    <template #head>
        <div>
            <h1>{{ view.title || view.name }}</h1>
            <term-tabs :items="shown" :pick="pick" :machine="view.name" :error="error" :commands="picked_commands" @pick="pick = $event" @end="end" @create="create"/>
        </div>
    </template>
</terminal>
<article v-else id="detail" class="terminal">
    <h1>{{ view.title || view.name }}</h1>
    <term-tabs :items="shown" :pick="pick" :machine="view.name" :error="error" :commands="picked_commands" @pick="pick = $event" @end="end" @create="create"/>
    <p class="muted">{{ (loaded ? ('No terminals on ' + view.name + ': + opens one, and it keeps running when the page closes.') : 'opening…') }}</p>
</article>
`,
    components: {'term-tabs': term_tabs, terminal},
    // terminal  the terminal the address names, or the one last open on this machine
    // prefer    the terminal last open on any machine: opened here too when this one has it
    props: ['view', 'theme', 'terminal', 'prefer'],
    emits: ['terminal'],
    data: function () {
        // `pick` is the terminal shown; `made` are the ones this page opened that the list has
        // not heard of yet; `gone` the ones it ended that the list may still name; `joins` counts
        // the times the one shown was joined again after its link dropped
        return {pick: null, made: [], gone: [], items: [], joins: 0, loaded: false, error: null};
    },
    computed: {
        // Oldest first, so a new terminal takes the end of the row and nothing moves
        shown: function () {
            const terminals = this.items.filter(v => this.gone.includes(v.name) === false);
            for (const item of this.made) {
                if (terminals.some(v => v.name === item.name) === false) {
                    terminals.push(item);
                }
            }
            if ((this.pick !== null) && (terminals.some(v => v.name === this.pick) === false)) {
                terminals.push({name: this.pick, created_at: Date.now(), attached: 1});
            }
            return terminals.sort((a, b) => (a.created_at - b.created_at) || a.name.localeCompare(b.name));
        },
        // What joins the terminal shown by hand, once the list has heard of it
        picked_commands: function () {
            const found = this.items.find(v => v.name === this.pick);
            return ((found === undefined) || (found.command === undefined)) ? undefined : [found.command];
        },
        url: function () {
            if (this.pick === null) {
                return null;
            }
            return `/api/v1/shell?remote=${encodeURIComponent(this.view.name)}&term=${encodeURIComponent(this.pick)}`;
        },
    },
    watch: {
        // The address follows the terminal shown; one the page opened by itself, or none left,
        // replaces it
        pick: function (next, prev) {
            this.$emit('terminal', {name: next, replace: (prev === null) || (next === null)});
        },
    },
    methods: {
        // Opening a name that is not running makes it, so a new terminal is only a new pick: the
        // lowest number no terminal has
        create: function () {
            let n = 1;
            while (this.shown.some(v => v.name === String(n))) {
                n++;
            }
            this.made.push({name: String(n), created_at: Date.now(), attached: 1});
            this.pick = String(n);
            setTimeout(() => this.terminals_load(), 1000);
        },
        // The tab goes at once, and the one beside it is shown; the machine is told after
        end: async function (name) {
            this.ended(name);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/terminals/${encodeURIComponent(name)}/end`, {method: 'POST'});
                if (answer.ok === false) {
                    this.error = (await answer.json()).error;
                }
            }
            catch (error) {
                this.error = error.message;
            }
        },
        // The terminal shown closed: `exit` was typed in it, or the link to the machine dropped
        // (its agent restarting, say). The machine says which: one still running is joined again.
        closed: async function () {
            const name = this.pick;
            await this.terminals_load();
            // A machine that is only reconnecting is waited for, not taken as an answer
            for (let i = 0; (i < RECONNECT_TRIES) && (this.error !== null); i++) {
                await new Promise(v => setTimeout(v, RECONNECT_MS));
                await this.terminals_load();
            }
            if (this.items.some(v => v.name === name)) {
                this.joins++;
                return;
            }
            this.ended(name);
        },
        // A terminal gone, by its × or by `exit` typed in it: its tab goes with it
        ended: function (name) {
            const at = this.shown.findIndex(v => v.name === name);
            const rest = this.shown.filter(v => v.name !== name);
            this.gone.push(name);
            this.made = this.made.filter(v => v.name !== name);
            if (this.pick === name) {
                this.pick = (rest.length === 0) ? null : rest[Math.min(at, rest.length - 1)].name;
            }
        },
        terminals_load: async function () {
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/terminals`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    this.error = body.error;
                    return;
                }
                this.error = null;
                this.items = body.items;
                this.made = this.made.filter(v => body.items.some(vv => vv.name === v.name) === false);
                // A name ended here leaves the list once the machine has caught up, and a new
                // terminal may take it again then
                this.gone = this.gone.filter(v => body.items.some(vv => vv.name === v));
                // The page opens on the terminal named for this machine, then on the one of the name
                // last open on another machine, then on the oldest. Nothing is made by opening the
                // page: with none running, + is the way to one, and a name the machine does not
                // list (ended since) is never made again.
                if ((this.loaded === false) && (this.pick === null) && (this.items.length > 0)) {
                    if (this.items.some(v => v.name === this.terminal)) {
                        this.pick = this.terminal;
                    }
                    else if (this.items.some(v => v.name === this.prefer)) {
                        this.pick = this.prefer;
                    }
                    else {
                        this.pick = this.shown[0].name;
                    }
                }
                this.loaded = true;
            }
            catch (error) {
                this.error = error.message;
            }
        },
    },
    mounted: function () {
        this.terminals_load();
        this.timer = setInterval(() => this.terminals_load(), TERMINALS_POLL_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
};

export default remote_shell;
