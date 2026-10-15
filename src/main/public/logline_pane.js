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
    <h2>Remotes</h2>
    <div class="wide-scroll">
        <table class="grid-table doors">
            <colgroup>
                <col>
                <col width="170">
                <col width="130">
                <col width="130">
                <col width="150">
                <col width="170">
            </colgroup>
            <thead>
                <tr>
                    <th>Remote</th>
                    <th>Its logs</th>
                    <th>Sent</th>
                    <th>Waiting</th>
                    <th>Last sent</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row of rows" :key="row.name">
                    <td><button type="button" class="link" :title="('The Logs tab of ' + row.title)" @click="$emit('remote', row.name)">{{ row.title }}</button></td>
                    <td :title="row.stage.detail"><span class="pill" :class="row.stage.pill">{{ row.stage.text }}</span></td>
                    <td>{{ row.sent }}</td>
                    <td :class="{busy: row.behind}">{{ row.waiting }}</td>
                    <td :class="{bad: row.held}">{{ row.last }}</td>
                    <td><button v-if="row.off" type="button" :disabled="busy" @click="send(row.name)">Send its logs</button></td>
                </tr>
                <tr v-if="(rows.length === 0)">
                    <td class="muted" colspan="6">No remotes yet. Logs come from remotes, where an agent runs — add a remote first.</td>
                </tr>
            </tbody>
        </table>
    </div>
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
        };
    },
    computed: {
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
    methods: {
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

export default logline_pane;
