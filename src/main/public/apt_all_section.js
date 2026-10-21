// What Install them on a machine's Configure tab does, on every machine the Remotes list shows:
// pick them, then a row for each while apt runs there, all at once. The runs belong to
// serviceman, not to this page: closed and opened again, it finds them where they are.
const apt_all_section = {
    template: `
<section class="card apt-all">
    <template v-if="(mode === 'pick')">
        <div class="apt-all-head">
            <b>Install updates</b>
            <span class="muted">{{ ticked.length }} of {{ rows.length }}</span>
            <span class="list-acts">
                <button type="button" class="primary" :disabled="(ticked.length === 0 || sending)" @click="start">{{ (sending ? 'starting…' : 'Install on ' + ticked.length) }}</button>
                <button type="button" @click="$emit('close')">Close</button>
            </span>
        </div>
        <p class="muted"><code>apt-get update</code>, then <code>apt-get upgrade</code>, on every machine ticked at once, keeping every config file you changed. The machine serviceman runs on goes last, alone. The filter above narrows this list.</p>
        <p v-if="(error !== null)" class="alert">{{ error }}</p>
        <div class="apt-all-rows">
            <label v-for="row of rows" :key="row.name" class="apt-all-row" :class="{off: (row.able === false)}">
                <input type="checkbox" :disabled="(row.able === false)" :checked="picked.includes(row.name)" @change="pick(row.name, $event.target.checked)">
                <span class="apt-all-name"><b>{{ row.title }}</b> <code v-if="(row.title !== row.name)" class="muted">{{ row.name }}</code></span>
                <span class="pill" :class="row.tone">{{ row.text }}</span>
            </label>
            <p v-if="(rows.length === 0)" class="muted">No machine is shown: the filter above matches none.</p>
        </div>
    </template>
    <template v-else>
        <div class="apt-all-head">
            <b>{{ (ended ? 'Updates on ' + batch.remotes.length + ' ' + ((batch.remotes.length === 1) ? 'machine' : 'machines') : 'Installing on ' + batch.remotes.length) }}</b>
            <span class="muted">{{ summary }}</span>
            <span class="list-acts">
                <button v-if="(ended === false)" type="button" :disabled="cancelling" @click="cancel">{{ (cancelling ? 'stopping…' : 'Cancel all') }}</button>
                <button v-else type="button" @click="$emit('close')">Close</button>
            </span>
        </div>
        <p v-if="(error !== null)" class="alert">{{ error }}</p>
        <div class="apt-all-rows">
            <div v-for="row of batch.remotes" :key="row.name" class="apt-all-row run" title="Every line apt printed, on the machine's Configure tab" @click="$emit('configure', row.name)">
                <span class="apt-all-name"><b>{{ row.title }}</b> <code v-if="(row.title !== row.name)" class="muted">{{ row.name }}</code></span>
                <span class="pill" :class="phase_tone(row.phase)">{{ phase_text(row.phase) }}</span>
                <span class="apt-all-said">
                    <span v-if="(row.phase === 'waiting')" class="muted">Starts once the others end: serviceman runs on this machine, and an upgrade of Docker restarts it.</span>
                    <span v-else-if="(row.error !== null && row.phase !== 'cancelled')" class="bad">{{ row.error }}</span>
                    <code v-else-if="(row.last_line !== null)" class="apt-all-line" :title="row.last_line">{{ row.last_line }}</code>
                    <span v-if="(row.phase === 'cancelled')" class="muted">Stopped where it stood: <code>sudo dpkg --configure -a</code> on that machine finishes a package left half set up.</span>
                    <span v-if="(row.containers !== null && row.containers.down.length > 0)" class="bad">Cannot start again: {{ row.containers.down.join(', ') }}</span>
                    <span v-if="(row.containers !== null && row.containers.started.length > 0)" class="muted">Started again: {{ row.containers.started.join(', ') }}</span>
                    <span v-if="(ended_row(row) && row.reboot)" class="busy">Wants a restart</span>
                </span>
            </div>
        </div>
        <p v-for="item of skipped" :key="item.name" class="muted">Left out: {{ item.reason }}.</p>
    </template>
</section>
`,
    props: ['remotes'],
    emits: ['close', 'configure'],
    data: function () {
        return {mode: 'pick', picked: [], batch: null, skipped: [], error: null, sending: false, cancelling: false, timer: null};
    },
    computed: {
        // Each machine shown, whether it can be upgraded now, and what is waiting on it
        rows: function () {
            return this.remotes.map(function (remote) {
                const machine = (remote.machine === undefined) ? null : remote.machine;
                const row = {name: remote.name, title: remote.title || remote.name, able: false, tone: '', text: ''};
                if (remote.phase !== 'online') {
                    return Object.assign(row, {text: 'offline'});
                }
                if ((machine === null) || (machine.can === null) || (machine.can.includes('apt') === false)) {
                    return Object.assign(row, {text: 'agent from before updates'});
                }
                const updates = machine.updates;
                if ((updates === null) || (updates.pending === null)) {
                    return Object.assign(row, {text: 'says nothing of updates'});
                }
                if (updates.pending === 0) {
                    return Object.assign(row, {tone: 'running', text: 'up to date'});
                }
                const security = (updates.security > 0) ? `, ${updates.security} security` : '';
                return Object.assign(row, {able: true, tone: (updates.security > 0) ? 'failed' : '', text: `${updates.pending} to install${security}`});
            });
        },
        ticked: function () {
            return this.rows.filter(v => v.able && this.picked.includes(v.name));
        },
        ended: function () {
            return (this.batch !== null) && (this.batch.ended_at !== null);
        },
        summary: function () {
            const count = {};
            for (const row of this.batch.remotes) {
                count[row.phase] = (count[row.phase] || 0) + 1;
            }
            return ['ok', 'running', 'waiting', 'error', 'cancelled'].filter(v => count[v] > 0).map(v => `${count[v]} ${this.phase_text(v)}`).join(' · ');
        },
    },
    methods: {
        pick: function (name, on) {
            this.picked = on ? this.picked.concat([name]) : this.picked.filter(v => v !== name);
        },
        phase_text: function (phase) {
            return {waiting: 'waiting', running: 'installing', ok: 'done', error: 'failed', cancelled: 'cancelled', idle: 'not started'}[phase] || phase;
        },
        phase_tone: function (phase) {
            return {ok: 'running', error: 'failed'}[phase] || '';
        },
        ended_row: function (row) {
            return ['ok', 'error', 'cancelled'].includes(row.phase);
        },
        read: async function () {
            clearTimeout(this.timer);
            try {
                const answer = await fetch('/api/v1/apt-upgrade', {cache: 'no-store'});
                if (answer.ok) {
                    this.batch = (await answer.json()).batch;
                }
            }
            catch {
                // The next read says it; the page polls the rest the same way
            }
            if ((this.batch !== null) && (this.batch.ended_at === null)) {
                this.mode = 'run';
                this.timer = setTimeout(() => this.read(), 1000);
            }
        },
        start: async function () {
            this.sending = true;
            this.error = null;
            try {
                const answer = await fetch('/api/v1/apt-upgrade', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({remotes: this.ticked.map(v => v.name)})});
                const outcome = await answer.json();
                this.skipped = (outcome.skipped === undefined) ? [] : outcome.skipped;
                if (answer.ok === false) {
                    const why = this.skipped.map(v => v.reason).join('; ');
                    this.error = (why === '') ? outcome.error : `${outcome.error}: ${why}`;
                    return;
                }
                await this.read();
            }
            catch {
                this.error = 'the answer never came back';
            }
            finally {
                this.sending = false;
            }
        },
        cancel: async function () {
            this.cancelling = true;
            try {
                await fetch('/api/v1/apt-cancel', {method: 'POST'});
                await this.read();
            }
            catch {
                this.error = 'the answer never came back';
            }
            finally {
                this.cancelling = false;
            }
        },
    },
    created: function () {
        // Every machine with something to install is ticked; the ones running now are found
        this.picked = this.rows.filter(v => v.able).map(v => v.name);
        this.read();
    },
    unmounted: function () {
        clearTimeout(this.timer);
    },
};

export default apt_all_section;
