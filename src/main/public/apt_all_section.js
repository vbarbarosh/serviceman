import answered_again from './answered_again.js';
import updates_lists from './updates_lists.js';

// What Install them on a machine's Configure tab does, on every machine the Remotes list shows:
// pick them, then a row for each while apt runs there, all at once. The runs belong to
// serviceman, not to this page: closed and opened again, it finds them where they are. Away
// (restarting, most often), serviceman is waited for: the list says so, and what a press it
// never answered came to is said once it is back.
const apt_all_section = {
    template: `
<section class="card apt-all">
    <template v-if="(mode === 'pick')">
        <div class="apt-all-head">
            <b>Install updates</b>
            <span class="muted">{{ ticked.length }} of {{ rows.length }}</span>
            <span class="list-acts">
                <button type="button" class="primary" :disabled="(ticked.length === 0 || sending || answering === false)" @click="start"><span v-if="sending" class="spin"/>{{ (looking ? 'looking…' : (sending ? 'starting…' : 'Install on ' + ticked.length)) }}</button>
                <button type="button" @click="$emit('close')">Close</button>
            </span>
        </div>
        <p class="muted"><code>apt-get update</code>, then <code>apt-get upgrade</code>, on every machine ticked at once, keeping every config file you changed. The machine serviceman runs on goes last, alone. The filter above narrows this list.</p>
        <p v-if="looking" class="muted"><span class="spin"/>No answer from serviceman: looking whether the install began…</p>
        <p v-else-if="(answering === false)" class="muted">serviceman is not answering: Install waits until it is back.</p>
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
                <button v-if="(ended === false)" type="button" :disabled="cancelling" @click="cancel"><span v-if="cancelling" class="spin"/>{{ (cancelling ? 'stopping…' : 'Cancel all') }}</button>
                <button v-else type="button" @click="$emit('close')">Close</button>
            </span>
        </div>
        <p v-if="forgotten" class="muted">serviceman restarted during the install (an upgrade of Docker on its own machine restarts it), and keeps no install over a restart: each row is as it was last seen, and the machine's Configure tab says what it has now.</p>
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
    props: {
        remotes: {type: Array, required: true},
        // Whether serviceman answered the page's last look; while it does not, the list is as it
        // was then, and Install waits
        answering: {type: Boolean, default: true},
    },
    emits: ['close', 'configure'],
    data: function () {
        return {mode: 'pick', picked: [], batch: null, known: false, skipped: [], error: null, sending: false, looking: false, cancelling: false, forgotten: false, closed: false, timer: null};
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
                // Held back is waiting on Ubuntu's phasing, not on an install: said, never ticked
                const held = (updates.held > 0) ? ` · ${updates.held} held back` : '';
                // Lists days old count nothing since: the machine's Configure tab fetches them
                const lists = updates_lists(updates, Date.now());
                if ((updates.pending === 0) && (lists !== null) && lists.old) {
                    return Object.assign(row, {text: `lists ${lists.days} days old${held}`});
                }
                if (updates.pending === 0) {
                    return Object.assign(row, {tone: 'running', text: `up to date${held}`});
                }
                const security = (updates.security > 0) ? `, ${updates.security} security` : '';
                return Object.assign(row, {able: true, tone: (updates.security > 0) ? 'failed' : '', text: `${updates.pending} to install${security}${held}`});
            });
        },
        ticked: function () {
            return this.rows.filter(v => v.able && this.picked.includes(v.name));
        },
        ended: function () {
            return (this.batch !== null) && ((this.batch.ended_at !== null) || this.forgotten);
        },
        summary: function () {
            const count = {};
            for (const row of this.batch.remotes) {
                count[row.phase] = (count[row.phase] || 0) + 1;
            }
            return ['ok', 'running', 'waiting', 'error', 'cancelled', 'lost'].filter(v => count[v] > 0).map(v => `${count[v]} ${this.phase_text(v)}`).join(' · ');
        },
    },
    methods: {
        pick: function (name, on) {
            this.picked = on ? this.picked.concat([name]) : this.picked.filter(v => v !== name);
        },
        phase_text: function (phase) {
            return {waiting: 'waiting', running: 'installing', ok: 'done', error: 'failed', cancelled: 'cancelled', idle: 'not started', lost: 'not followed'}[phase] || phase;
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
                this.batch_take((await apt_all_read()).batch);
            }
            catch {
                // The next read says it; the page polls the rest the same way
            }
            if ((this.batch !== null) && (this.ended === false)) {
                this.mode = 'run';
                this.timer = setTimeout(() => this.read(), 1000);
            }
        },
        // serviceman keeps no install over a restart: one followed here that its answer no longer
        // has went with a restart, as when Docker is upgraded on serviceman's own machine. Its
        // rows stay as last seen; a machine that had not ended is said as not followed.
        batch_take: function (batch) {
            this.known = true;
            if ((batch === null) && (this.batch !== null) && (this.batch.ended_at === null)) {
                this.forgotten = true;
                this.batch = Object.assign({}, this.batch, {remotes: this.batch.remotes.map(v => this.ended_row(v) ? v : Object.assign({}, v, {phase: 'lost'}))});
                return;
            }
            this.forgotten = false;
            this.batch = batch;
        },
        start: async function () {
            this.sending = true;
            this.error = null;
            // The install known before the press: one begun since is the press's own
            const before = this.known ? this.batch : undefined;
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
            catch (error) {
                if (error instanceof TypeError) {
                    await this.lost(before);
                    return;
                }
                this.error = 'serviceman failed to answer Install: its log says why';
            }
            finally {
                this.sending = false;
            }
        },
        // Install got no answer: serviceman was away when it was pressed, or went away under it.
        // Whether the install began is known once serviceman answers again.
        lost: async function (before) {
            this.looking = true;
            const said = await answered_again(apt_all_read, () => this.closed);
            this.looking = false;
            if (this.closed) {
                return;
            }
            if (said === null) {
                this.error = 'serviceman has not answered for three minutes, so whether the install began is not known: Close, and open Install updates again once it is back.';
                return;
            }
            if (apt_all_begun(said.batch, before)) {
                this.batch_take(said.batch);
                this.mode = 'run';
                await this.read();
                return;
            }
            this.batch_take(said.batch);
            this.error = 'Not started: serviceman was away when Install was pressed, a restart most often. It is back now: Install again.';
        },
        cancel: async function () {
            this.cancelling = true;
            try {
                await fetch('/api/v1/apt-cancel', {method: 'POST'});
                await this.read();
            }
            catch {
                // The rows go on being read: once serviceman is back, each says where it stands
                this.error = 'Cancel got no answer from serviceman: a row still installing is one it did not stop.';
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
        this.closed = true;
        clearTimeout(this.timer);
    },
};

// The install of several machines as serviceman has it now, {batch}; throws while it is away
async function apt_all_read()
{
    const answer = await fetch('/api/v1/apt-upgrade', {cache: 'no-store'});
    if (answer.ok === false) {
        throw new Error(`serviceman answered ${answer.status}`);
    }
    return answer.json();
}

// Whether a press of Install began `batch`: one other than the install known before it. Where
// none was known (the list opened while serviceman was away), only one still going is taken
// for it; one already over is an earlier one.
function apt_all_begun(batch, before)
{
    if (batch === null) {
        return false;
    }
    if (before === undefined) {
        return (batch.ended_at === null);
    }
    return (before === null) || (batch.started_at !== before.started_at);
}

export default apt_all_section;
