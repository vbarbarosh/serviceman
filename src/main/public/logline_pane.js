import data_table from './data_table.js';
import format_ms from './format_ms.js';
import logline_stage from './logline_stage.js';

// Logline: where every line of every remote flows. Not a service like the rest — the one place
// the fleet's logs end up — so it has a page of its own: how it stands, how each remote's
// sending stands, and where it is.
const logline_pane = {
    template: `
<article id="detail" class="logline">
    <h1>Logline</h1>
    <p class="muted">Where every line of every remote flows. Each remote sends its own lines straight to Logline and keeps them while it cannot; serviceman only says where Logline is and hands each remote its token.</p>
    <div class="card svc-status">
        <div class="row-of svc-state">
            <span class="pill" :class="head.pill">{{ head.text }}</span>
            <span class="muted">{{ head.detail }}</span>
        </div>
        <div class="actions">
            <button v-if="(logline !== null && logline.ui !== null)" type="button" class="primary" @click="viewer_open">Open Logline ↗</button>
            <button v-if="(service !== null)" type="button" @click="$emit('select', service.name)">Its service page</button>
        </div>
    </div>
    <!-- Logline on its machine, kept the same as the one serviceman carries: no terminal needed -->
    <div class="card logline-place">
        <div class="row-of">
            <b>On its machine</b>
            <span v-if="(place === null)" class="muted">looking…</span>
            <span v-else-if="(place.error !== undefined)" class="bad">{{ place.error }}</span>
            <span v-else-if="(place.differs === 0)" class="muted">{{ place.dir }} on {{ place.remote }}: the same as here</span>
            <span v-else class="busy">{{ place.dir }} on {{ place.remote }}: {{ place.differs }} {{ (place.differs === 1) ? 'file differs' : 'files differ' }} from here</span>
        </div>
        <ul v-if="((place !== null) && (place.differs > 0))" class="logline-files">
            <li v-for="item of place_changed.slice(0, 8)" :key="item.path"><code>{{ item.path }}</code> <span class="muted">{{ (item.state === 'missing') ? 'not there' : 'older there' }}</span></li>
            <li v-if="(place_changed.length > 8)" class="muted">and {{ place_changed.length - 8 }} more</li>
        </ul>
        <div class="actions">
            <button type="button" class="primary" :disabled="update_off" :title="update_title" @click="update">{{ (updating ? 'Updating…' : 'Update Logline') }}</button>
            <span v-if="((run !== null) && (run.step !== null) && updating)" class="muted">{{ run.step.at }} of {{ run.step.of }}: {{ run.step.name }}</span>
        </div>
        <pre v-if="((run !== null) && (run.text !== ''))" class="logline-run">{{ run.text }}</pre>
        <p v-if="((run !== null) && (updating === false))" :class="((run.phase === 'done') ? 'muted' : 'bad')">{{ run.said }}</p>
    </div>
    <h2>Remotes</h2>
    <data-table :columns="columns" :rows="rows" row_key="name" actions_label="Change" empty="No remotes yet. Logs come from remotes, where an agent runs — add a remote first.">
        <template #cell="{row, column}">
            <button v-if="(column.key === 'name')" type="button" class="link" :title="('The Logs tab of ' + row.title)" @click="$emit('remote', row.name)">{{ row.title }}</button>
            <span v-else-if="(column.key === 'stage')" class="pill" :class="row.stage.pill" :title="row.stage.detail">{{ row.stage.text }}</span>
            <template v-else-if="(column.key === 'sent')">{{ row.sent }}</template>
            <span v-else-if="(column.key === 'waiting')" :class="{busy: row.behind}">{{ row.waiting }}</span>
            <span v-else-if="(column.key === 'last')" :class="{bad: row.held}">{{ row.last }}</span>
        </template>
        <template #actions="{row}">
            <button v-if="row.off" type="button" :disabled="busy" @click="send(row.name)">Send its logs</button>
        </template>
    </data-table>
    <p :class="(bad ? 'bad' : 'muted')">{{ note || 'A remote is switched off on its own Logs tab, where it is asked twice: what is written while it is off is never sent.' }}</p>
    <h2>Where Logline is</h2>
    <div class="card svc-status">
        <template v-if="(editing === false && logline !== null)">
            <dl>
                <dt>Endpoint</dt>
                <dd><code>{{ logline.endpoint }}</code></dd>
                <dt>Admin token</dt>
                <dd>
                    <span v-if="logline.admin_kept">kept in the Secrets library as <code>{{ logline.admin }}</code></span>
                    <span v-else class="bad">not kept — remotes cannot be given tokens until it is</span>
                </dd>
                <dt>Viewer</dt>
                <dd><code v-if="(logline.ui !== null)">{{ logline.ui }}</code><span v-else class="muted">not set — Open Logline has nowhere to go</span></dd>
            </dl>
            <div class="actions">
                <button type="button" @click="edit_begin">Change</button>
            </div>
        </template>
        <div v-else class="form">
            <div class="grid">
                <label>Endpoint</label>
                <div>
                    <input v-model.trim="form.endpoint" placeholder="http://logline:3000/lines" spellcheck="false">
                    <p class="muted">Where the remotes POST their lines. Empty takes Logline away: no remote sends anything, and once it is back each starts again from that moment.</p>
                </div>
                <label>Admin token</label>
                <div>
                    <input v-model.trim="form.admin_token" type="password" autocomplete="off" :placeholder="((logline !== null && logline.admin_kept) ? 'kept — type a new one to replace it' : 'ADMIN_TOKEN from logline/.env')" spellcheck="false">
                    <p class="muted">serviceman asks Logline for each remote's token with it. It goes into the Secrets library, never into serviceman.json, and is never shown again.</p>
                </div>
                <label>Viewer</label>
                <div>
                    <input v-model.trim="form.ui" placeholder="http://logline:8081/ — optional" spellcheck="false">
                    <p class="muted">Where Logline's log viewer is: Open Logline above goes there.</p>
                </div>
            </div>
            <div class="actions">
                <button type="button" :disabled="saving" @click="logline_save">Save</button>
                <button v-if="(logline !== null)" type="button" @click="editing = false">Cancel</button>
                <span :class="(form_bad ? 'bad' : 'muted')">{{ form_note }}</span>
            </div>
        </div>
    </div>
</article>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        return {
            busy: false,
            note: '',
            bad: false,
            editing: false,
            saving: false,
            form: {endpoint: '', admin_token: '', ui: ''},
            form_note: '',
            form_bad: false,
            // Where Logline runs and how its files there compare ({error} when it is not found),
            // and the update going or last made
            place: null,
            run: null,
        };
    },
    computed: {
        // The Remotes table's columns, each that may fold with when
        columns: function () {
            return [
                {key: 'name', label: 'Remote', wraps: true},
                {key: 'stage', label: 'Its logs'},
                {key: 'sent', label: 'Sent', fold: 1, hide: v => (v.sent === '')},
                {key: 'waiting', label: 'Waiting', fold: 2, hide: v => (v.waiting === '')},
                {key: 'last', label: 'Last sent'},
            ];
        },
        place_changed: function () {
            return (((this.place === null) || (this.place.files === undefined)) ? [] : this.place.files.filter(v => (v.state !== 'same')));
        },
        updating: function () {
            return ((this.run !== null) && (this.run.phase === 'running'));
        },
        update_off: function () {
            return (this.updating || (this.place === null) || (this.place.error !== undefined) || (this.place.differs === 0));
        },
        update_title: function () {
            if ((this.place !== null) && (this.place.differs === 0)) {
                return 'Logline on its machine is the same as here: nothing to update';
            }
            return 'Put the files that differ on Logline\'s machine and start it again there';
        },
        logline: function () {
            return ((this.state.logline === undefined) ? null : this.state.logline);
        },
        // The service Logline itself runs as: the one called logline, or the one whose address
        // the viewer is on
        service: function () {
            const named = this.state.services.find(v => v.name === 'logline');
            if (named !== undefined) {
                return named;
            }
            const host = viewer_host(this.logline);
            return this.state.services.find(v => (v.publish !== undefined) && (v.publish !== null) && (v.publish.hosts || []).includes(host)) || null;
        },
        // One word for how Logline stands, and a sentence for why
        head: function () {
            if (this.logline === null) {
                return {pill: 'failed', text: 'Not set', detail: 'Nobody has said where Logline is: no remote sends anything until it is set below.'};
            }
            const sending = this.state.remotes.filter(v => v.logline.logs === 'all').length;
            const sending_text = `${sending} of ${this.state.remotes.length} ${(this.state.remotes.length === 1) ? 'remote sends' : 'remotes send'} to it`;
            if (this.service === null) {
                return {pill: 'running', text: 'Set', detail: sending_text};
            }
            const where = remote_title(this.state.remotes, this.service.remotes);
            return {pill: this.service.phase, text: this.service.phase, detail: `${sending_text} · runs as ${this.service.name}${(where === '') ? '' : ` on ${where}`}`};
        },
        rows: function () {
            const now = Date.now();
            return this.state.remotes.map(function (item) {
                const status = item.logline.status;
                const counting = ((item.logline.logs === 'all') && (status !== null) && status.collecting);
                return {
                    name: item.name,
                    title: (item.title || item.name),
                    stage: logline_stage(item),
                    off: (item.logline.logs === 'off'),
                    sent: (counting ? status.sent.lines.toLocaleString('en-US') : ''),
                    waiting: (counting ? status.waiting.lines.toLocaleString('en-US') : ''),
                    behind: (counting && (status.waiting.lines > 0)),
                    last: ((counting && (status.last_sent_at !== null)) ? `${format_ms(Math.max(0, now - Date.parse(status.last_sent_at)))} ago` : ''),
                    held: (counting && (status.last_answer !== null) && (status.last_answer !== 'ok')),
                };
            });
        },
    },
    mounted: function () {
        this.place_read();
    },
    methods: {
        place_read: async function () {
            try {
                const answer = await fetch('/api/v1/logline/place');
                const body = await answer.json();
                this.place = (answer.ok ? body : {error: body.error});
            }
            catch {
                this.place = {error: 'serviceman did not answer'};
            }
        },
        // The update as it goes: one JSON object a line, {step, steps, name, text}, {text} and
        // last {end, said}
        update: async function () {
            this.run = {phase: 'running', step: null, text: '', said: ''};
            const run = this.run;
            try {
                const answer = await fetch('/api/v1/logline/update', {method: 'POST'});
                const reader = answer.body.getReader();
                const decoder = new TextDecoder();
                let held = '';
                for (;;) {
                    const part = await reader.read();
                    if (part.done) {
                        break;
                    }
                    held += decoder.decode(part.value, {stream: true});
                    const lines = held.split('\n');
                    held = lines.pop();
                    for (const line of lines) {
                        run_line(run, line);
                    }
                }
                run_line(run, held);
                if (run.phase === 'running') {
                    run.phase = 'failed';
                    run.said = 'the answer stopped before the end';
                }
            }
            catch {
                run.phase = 'failed';
                run.said = 'the answer never came back';
            }
            await this.place_read();
        },
        viewer_open: function () {
            window.open(this.logline.ui, '_blank', 'noopener');
        },
        // On is one click: nothing is lost by sending. Off is asked on the remote's own tab.
        send: async function (name) {
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(name)}/logs`, {method: 'PUT', body: JSON.stringify({logs: 'all'})});
                if (answer.ok === false) {
                    this.report((await answer.json()).error, true);
                }
            }
            catch {
                this.report('the answer never came back — the page says what landed within a second', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        edit_begin: function () {
            this.form = {
                endpoint: ((this.logline === null) ? '' : this.logline.endpoint),
                admin_token: '',
                ui: (((this.logline === null) || (this.logline.ui === null)) ? '' : this.logline.ui),
            };
            this.form_note = '';
            this.editing = true;
        },
        logline_save: async function () {
            this.saving = true;
            this.form_note = 'saving…';
            this.form_bad = false;
            try {
                const answer = await fetch('/api/v1/logline', {method: 'PUT', body: JSON.stringify(this.form)});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.form_note = outcome.error;
                    this.form_bad = true;
                    return;
                }
                this.form.admin_token = '';
                this.form_note = '';
                this.editing = false;
            }
            catch {
                this.form_note = 'the answer never came back — the page says what landed within a second';
                this.form_bad = true;
            }
            finally {
                this.saving = false;
            }
        },
    },
};

// "http://logline.localhost:3000/" -> "logline.localhost"; null when the viewer is not set
function viewer_host(logline)
{
    if ((logline === null) || (logline.ui === null)) {
        return null;
    }
    try {
        return new URL(logline.ui).hostname;
    }
    catch {
        return null;
    }
}

function remote_title(remotes, names)
{
    const name = ((Array.isArray(names) && (names.length > 0)) ? names[0] : null);
    const found = remotes.find(v => v.name === name);
    return ((found === undefined) ? (name || '') : (found.title || found.name));
}

function run_line(run, line)
{
    if (line.trim() === '') {
        return;
    }
    const item = JSON.parse(line);
    if (item.step !== undefined) {
        run.step = {at: item.step, of: item.steps, name: item.name};
    }
    if (item.text !== undefined) {
        run.text += `${item.text}\n`;
    }
    if (item.end !== undefined) {
        run.phase = item.end;
        run.said = item.said;
    }
}

export default logline_pane;
