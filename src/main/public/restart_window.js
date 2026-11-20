import clock_of from './clock_of.js';
import format_ms from './format_ms.js';

// The window that asks before a machine is restarted, over the page: why, what comes back by
// itself and what does not, what ends, whether serviceman itself goes with it, and what happens
// after; then Restart now, or Cancel. What it says is what serviceman reads of the machine as the
// window opens (GET /api/v1/remotes/<name>/restart); a part it could not read says so. Restart
// now asks for the restart and closes: the card it was opened from follows it in the status.
const restart_window = {
    template: `
<div class="dt-window" @click.self="$emit('close')" @keydown.esc="$emit('close')">
<div ref="box" class="dt-whole restart-window" role="dialog" aria-modal="true" tabindex="-1" :aria-label="('Restart ' + title)">
    <div class="dt-whole-head"><b>Restart {{ title }}?</b><button type="button" class="link" title="Close (Esc)" @click="$emit('close')">Close</button></div>
    <dl class="fold-details restart-facts">
        <dt>Why</dt>
        <dd>{{ why }}</dd>
        <template v-if="(facts === null)">
            <dt></dt>
            <dd class="muted"><span v-if="(error === null)"><span class="spin"/>looking at what runs there…</span><span v-else class="bad">{{ error }}</span></dd>
        </template>
        <template v-else>
            <dt>Away for</dt>
            <dd>{{ away_text }}</dd>
            <dt>Comes back</dt>
            <dd>{{ back_text }}</dd>
            <dt>Ends</dt>
            <dd><span v-for="(item, index) of ends" :key="item.text"><span v-if="(index > 0)"> · </span><span :class="item.tone">{{ item.text }}</span></span></dd>
            <template v-if="facts.serviceman_here">
                <dt>serviceman</dt>
                <dd class="busy">runs on this machine too: this page goes away until it is back, and the restart is not followed</dd>
            </template>
            <dt>After</dt>
            <dd>a Security look as soon as its agent dials in again: a problem the restart mends goes then</dd>
        </template>
        <template v-if="(refused !== null)">
            <dt></dt>
            <dd class="bad">{{ refused }}</dd>
        </template>
        <dt></dt>
        <dd class="fold-actions dt-actions">
            <button type="button" class="danger" :disabled="((facts === null) || (refused !== null) || asking)" @click="restart"><span v-if="asking" class="spin"/>{{ (asking ? 'Asking…' : 'Restart now') }}</button>
            <button type="button" @click="$emit('close')">Cancel</button>
        </dd>
    </dl>
</div>
</div>
`,
    props: ['remote', 'title', 'why', 'now'],
    emits: ['close'],
    data: function () {
        // facts: what serviceman read of the machine, null until it answers; error: why it did
        // not; refused: why a restart cannot be asked now, from the facts or from the ask
        return {facts: null, error: null, refused: null, asking: false};
    },
    computed: {
        away_text: function () {
            const last = this.facts.last;
            if (last === null) {
                return 'about a minute, as a machine usually is; no restart of it was counted yet';
            }
            return `about ${format_ms(last.down_ms)}: its last restart, ${format_ms(Math.max(0, this.now - last.at))} ago, back at ${clock_of(last.at)}`;
        },
        back_text: function () {
            const parts = ['its agent, as systemd starts it'];
            const containers = this.facts.containers;
            if (containers !== null) {
                if (containers.back.length > 0) {
                    parts.push(`${this.listed(containers.back)}, by their restart policy`);
                }
                if (containers.serviceman.length > 0) {
                    parts.push(`${this.listed(containers.serviceman)}, as serviceman starts its services`);
                }
            }
            return parts.join(' · ');
        },
        ends: function () {
            const out = [];
            const containers = this.facts.containers;
            if (containers === null) {
                out.push({text: `its containers are not known: ${this.facts.errors.containers}`, tone: 'muted'});
            }
            else {
                if (containers.stay.length > 0) {
                    out.push({text: `${this.listed(containers.stay)}, with no restart policy`, tone: 'bad'});
                }
                if (containers.maybe.length > 0) {
                    out.push({text: `${this.listed(containers.maybe)}, on-failure: back only if it ended with an error`, tone: 'busy'});
                }
            }
            if (this.facts.terminals === null) {
                out.push({text: `its kept terminals are not known: ${this.facts.errors.terminals}`, tone: 'muted'});
            }
            else if (this.facts.terminals > 0) {
                out.push({text: `${this.facts.terminals} kept ${(this.facts.terminals === 1) ? 'terminal' : 'terminals'}`, tone: 'bad'});
            }
            out.push({text: 'whatever else runs there that nothing starts at boot', tone: ''});
            return out;
        },
    },
    mounted: function () {
        this.$refs.box.focus();
        this.load();
    },
    methods: {
        load: async function () {
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.remote)}/restart`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    this.error = body.error;
                    return;
                }
                this.facts = body;
                this.refused = body.refused;
            }
            catch (error) {
                this.error = `serviceman did not answer: ${error.message}`;
            }
        },
        restart: async function () {
            this.asking = true;
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.remote)}/restart`, {method: 'POST'});
                const body = await answer.json();
                if (answer.ok === false) {
                    this.refused = body.error;
                    return;
                }
                this.$emit('close');
            }
            catch (error) {
                this.refused = `serviceman did not answer: ${error.message}`;
            }
            finally {
                this.asking = false;
            }
        },
        // Three by name, the rest counted: web, db and 4 more
        listed: function (names) {
            const said = names.slice(0, 3);
            const rest = names.length - said.length;
            const head = (rest > 0) ? `${said.join(', ')} and ${rest} more` : ((said.length === 1) ? said[0] : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`);
            return `${head} (${names.length} ${(names.length === 1) ? 'container' : 'containers'})`;
        },
    },
};

export default restart_window;
