import data_table from './data_table.js';
import format_ms from './format_ms.js';

// Load tests: k6 sent at a service. A test is a number of users asking for one address for a
// while, run from a remote picked for it; each run is kept with what it measured.
const load_tests_pane = {
    template: `
<article id="detail" class="list load-tests">
    <div class="list-head">
        <h1>Load tests</h1>
        <span class="muted">{{ tests.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" :disabled="(form !== null)" @click="form_begin(null)">+ New test</button>
        </div>
    </div>
    <p class="muted">A test sends <a href="https://k6.io/" target="_blank" rel="noopener">k6</a> at a service: a number of users asking for one address for a while. k6 runs once, as the <code>grafana/k6</code> container on the remote you pick, and is removed afterwards. A sleeping service is woken first, so its start is not counted as a slow answer.</p>
    <template v-if="(form !== null)">
        <div class="list-head lt-head">
            <h2>{{ (form.original === null) ? 'New test' : 'Change ' + form.original }}</h2>
        </div>
        <div class="card svc-status">
            <div class="form">
                <div class="grid">
                    <label for="lt-service">Service</label>
                    <div>
                        <select id="lt-service" v-model="form.service" @change="form_service_picked">
                            <option v-for="item of service_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                        </select>
                    </div>
                    <label for="lt-url">Address</label>
                    <div>
                        <input id="lt-url" v-model.trim="form.url" :placeholder="(address_of(form.service) || 'http://…')" spellcheck="false">
                        <p class="muted">Left empty, the test asks the service's own address, the one shown here.</p>
                    </div>
                    <label for="lt-remote">Run from</label>
                    <div>
                        <select id="lt-remote" v-model="form.remote">
                            <option v-for="item of remote_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                        </select>
                        <p class="muted">An address under <code>.localhost</code> is serviceman's own: k6 is sent to serviceman over the tailnet, so any remote will do. A public name is asked as it is.</p>
                    </div>
                    <label for="lt-vus">Users</label>
                    <div class="row-of">
                        <input id="lt-vus" v-model.number="form.vus" type="number" min="1" max="1000" class="short">
                        <span class="muted">for</span>
                        <input v-model.trim="form.duration" class="short" placeholder="30s" spellcheck="false">
                        <span class="muted">each asking again as soon as it is answered</span>
                    </div>
                    <label for="lt-p95">Passes when</label>
                    <div class="row-of">
                        <span class="muted">95% of answers under</span>
                        <input id="lt-p95" v-model.number="form.p95_ms" type="number" min="1" class="short">
                        <span class="muted">ms, and errors under</span>
                        <input v-model.number="form.errors_pct" type="number" min="0" max="100" step="0.1" class="short">
                        <span class="muted">%</span>
                    </div>
                    <label for="lt-name">Name</label>
                    <div>
                        <input id="lt-name" v-model.trim="form.name" spellcheck="false">
                    </div>
                </div>
                <div class="actions">
                    <button type="button" class="primary" :disabled="busy" @click="form_save">{{ (form.original === null) ? 'Create test' : 'Save' }}</button>
                    <button type="button" :disabled="busy" @click="form = null">Cancel</button>
                    <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
                </div>
            </div>
        </div>
    </template>
    <data-table :columns="test_columns" :rows="tests" row_key="name" :chosen="v => (v.name === picked_name)" :on_row="v => (picked = v.name)" actions_label="Run">
        <template #cell="{row, column}">
            <b v-if="(column.key === 'name')">{{ row.name }}</b>
            <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
            <button v-else-if="(column.key === 'remote')" type="button" class="link" @click="$emit('remote', row.remote)">{{ remote_title(row.remote) }}</button>
            <template v-else-if="(column.key === 'load')">{{ load_text(row) }}</template>
            <template v-else-if="(column.key === 'last')">
                <span v-if="(last_of(row.name) !== null)" class="lt-last">
                    <span class="pill" :class="pill_of(last_of(row.name))">{{ phase_text(last_of(row.name)) }}</span>
                    <span class="muted">{{ result_text(last_of(row.name)) }}</span>
                </span>
                <span v-else class="muted">never run</span>
            </template>
        </template>
        <template #actions="{row}">
            <button v-if="(going_of(row.name) === null)" type="button" :disabled="busy" @click="run(row)">Run</button>
            <button v-else type="button" :disabled="(busy || (going_of(row.name).phase === 'stopping'))" @click="stop(row)">Stop</button>
        </template>
        <template #empty>No tests yet — <button type="button" class="link" @click="form_begin(null)">make the first one</button>.</template>
    </data-table>
    <p v-if="((form === null) && (note !== ''))" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <template v-if="(test_now !== null)">
        <div class="list-head lt-head">
            <h2>{{ test_now.name }}</h2>
            <span class="muted">{{ test_now.service }} · from {{ remote_title(test_now.remote) }}</span>
            <div class="list-acts">
                <button type="button" :disabled="(form !== null)" @click="form_begin(test_now)">Change</button>
                <button type="button" :disabled="(busy || (going_of(test_now.name) !== null))" @click="remove(test_now)">Remove</button>
            </div>
        </div>
        <div class="card svc-status">
            <dl>
                <dt>Asks</dt>
                <dd><code>{{ (test_now.url_asked || 'no address') }}</code><span v-if="(test_now.url === null)" class="muted"> · the service's own address</span></dd>
                <dt>Load</dt>
                <dd>{{ load_text(test_now) }}, from {{ remote_title(test_now.remote) }}</dd>
                <dt>Passes when</dt>
                <dd>{{ pass_text(test_now) }}</dd>
                <template v-if="((runs_now.length > 0) && (runs_now[0].via !== undefined) && (runs_now[0].via !== null))">
                    <dt>Reached</dt>
                    <dd>{{ runs_now[0].via }}</dd>
                </template>
            </dl>
        </div>
        <div v-if="(going !== null)" class="card svc-status">
            <div class="row-of svc-state">
                <span class="pill starting">{{ phase_text(going) }}</span>
                <span class="muted">{{ live_text(going) }}</span>
            </div>
            <div class="meter"><i :style="{width: (Math.round(live_ratio(going)*100) + '%')}"/></div>
            <pre v-if="(going.lines.length > 0)" class="lt-lines">{{ going.lines.slice(-12).join('\\n') }}</pre>
        </div>
        <data-table :columns="run_columns" :rows="runs_now" row_key="id" :row_class="v => ((has_notes(v) || (log_id === v.id)) ? 'lt-noted' : [])" actions_label="Log" empty="Not run yet.">
            <template #cell="{row, column}">
                <span v-if="(column.key === 'when')" :title="new Date(row.started_at).toLocaleString()">{{ ago(row.started_at) }} ago</span>
                <span v-else-if="(column.key === 'result')" class="pill" :class="pill_of(row)">{{ phase_text(row) }}</span>
                <span v-else-if="(column.key === 'wake')">{{ wake_text(row) }}</span>
                <span v-else-if="(row.result === null)" class="muted">—</span>
                <template v-else-if="(column.key === 'reqs')">{{ row.result.reqs.toLocaleString() }}</template>
                <template v-else-if="(column.key === 'rps')">{{ Math.round(row.result.rps).toLocaleString() }}</template>
                <template v-else-if="(column.key === 'med')">{{ ms_text(row.result.med_ms) }}</template>
                <span v-else-if="(column.key === 'p95')" :class="{bad: (row.result.p95_passed === false)}">{{ ms_text(row.result.p95_ms) }}</span>
                <template v-else-if="(column.key === 'max')">{{ ms_text(row.result.max_ms) }}</template>
                <span v-else-if="(column.key === 'errors')" :class="{bad: (row.result.errors_passed === false)}">{{ pct_text(row.result.errors) }}</span>
            </template>
            <template #actions="{row}">
                <button v-if="(row.log_kept === true)" type="button" @click="log_toggle(row)">{{ (log_id === row.id) ? 'Hide log' : 'Log' }}</button>
            </template>
            <template #below="{row}">
                <div v-if="has_notes(row)" class="lt-room">
                    <div v-if="(row.error !== null)" class="bad">{{ row.error }}</div>
                    <div v-for="note of (row.said || [])" :key="note.text" class="muted">{{ note.count.toLocaleString() }} {{ (note.users ? ((note.count === 1) ? 'user got' : 'users got') : '×') }} {{ note.text }}</div>
                </div>
                <div v-if="(log_id === row.id)" class="lt-room">
                    <p v-if="(log_text === null)" :class="(log_bad ? 'bad' : 'muted')"><span v-if="(log_bad === false)" class="spin"/>{{ log_note }}</p>
                    <pre v-else class="lt-lines">{{ log_text }}</pre>
                </div>
            </template>
        </data-table>
    </template>
</article>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        // `log_id` is the run whose log is open under it, and `log_text` that log once it came
        return {picked: null, form: null, busy: false, note: '', bad: false, log_id: null, log_text: null, log_note: '', log_bad: false};
    },
    computed: {
        // The tables' columns, each that may fold with when
        test_columns: function () {
            return [
                {key: 'name', label: 'Test', wraps: true},
                {key: 'service', label: 'Service', fold: 3},
                {key: 'remote', label: 'From', fold: 1},
                {key: 'load', label: 'Load', fold: 2},
                {key: 'last', label: 'Last run'},
            ];
        },
        run_columns: function () {
            function result(run) {
                return (run.result === null);
            }
            return [
                {key: 'when', label: 'When'},
                {key: 'result', label: 'Result'},
                {key: 'reqs', label: 'Answers', fold: 6, hide: result},
                {key: 'rps', label: 'Per second', fold: 7, hide: result},
                {key: 'med', label: 'Median', fold: 8, hide: result},
                {key: 'p95', label: '95%', fold: 4, hide: result},
                {key: 'max', label: 'Slowest', fold: 3, hide: result},
                {key: 'errors', label: 'Errors', fold: 5, hide: result},
                {key: 'wake', label: 'Woke in', fold: 2, hide: v => (v.wake_ms === null)},
            ];
        },
        tests: function () {
            return (this.state.load_tests === undefined) ? [] : this.state.load_tests;
        },
        runs: function () {
            return (this.state.load_test_runs === undefined) ? [] : this.state.load_test_runs;
        },
        // The test looked at: the one picked, or else the only one there is
        test_now: function () {
            const found = this.tests.find(v => v.name === this.picked);
            if (found !== undefined) {
                return found;
            }
            return (this.tests.length === 1) ? this.tests[0] : null;
        },
        picked_name: function () {
            return (this.test_now === null) ? null : this.test_now.name;
        },
        runs_now: function () {
            return this.runs.filter(v => (v.test === this.test_now.name) && (v.ended_at !== null)).reverse();
        },
        going: function () {
            return (this.test_now === null) ? null : this.going_of(this.test_now.name);
        },
        service_options: function () {
            return this.state.services.map(v => ({value: v.name, label: v.name}));
        },
        remote_options: function () {
            return this.state.remotes.map(v => ({value: v.name, label: `${v.title || v.name}${(v.phase === 'online') ? '' : ` · ${v.phase}`}`}));
        },
    },
    methods: {
        last_of: function (name) {
            const found = this.runs.filter(v => v.test === name);
            return (found.length === 0) ? null : found[found.length - 1];
        },
        // What a run has to say under its numbers: why it did not run, what k6 complained of
        has_notes: function (item) {
            return (item.error !== null) || ((item.said !== undefined) && (item.said.length > 0));
        },
        going_of: function (name) {
            return this.runs.find(v => (v.test === name) && (v.ended_at === null)) || null;
        },
        remote_title: function (name) {
            const found = this.state.remotes.find(v => v.name === name);
            return (found === undefined) ? name : (found.title || found.name);
        },
        // The service's first address, as serviceman serves it; what a test without one asks
        address_of: function (name) {
            const service = this.state.services.find(v => v.name === name);
            if ((service === undefined) || (service.publish.hosts.length === 0)) {
                return null;
            }
            const text = service.publish.hosts[0];
            const at = text.indexOf('/');
            const host = (at === -1) ? text : text.slice(0, at);
            const path = (at === -1) ? '' : text.slice(at).replace(/\/+$/, '');
            const port = this.state.listen.port;
            return `http://${host}${(port === 80) ? '' : `:${port}`}${path}/`;
        },
        load_text: function (test) {
            return `${test.vus} ${(test.vus === 1) ? 'user' : 'users'} for ${test.duration}`;
        },
        pass_text: function (test) {
            const items = [];
            if (test.p95_ms !== null) {
                items.push(`95% of answers under ${test.p95_ms} ms`);
            }
            if (test.errors_pct !== null) {
                items.push(`errors under ${test.errors_pct}%`);
            }
            return (items.length === 0) ? 'always — it only measures' : items.join(', and ');
        },
        phase_text: function (item) {
            return {waking: 'waking the service', running: 'running', stopping: 'stopping', passed: 'passed', failed: 'failed', stopped: 'stopped', error: 'did not run'}[item.phase] || item.phase;
        },
        pill_of: function (item) {
            if (item.phase === 'passed') {
                return 'running';
            }
            if ((item.phase === 'failed') || (item.phase === 'error')) {
                return 'failed';
            }
            return (item.ended_at === null) ? 'starting' : '';
        },
        result_text: function (item) {
            if (item.ended_at === null) {
                return this.live_text(item);
            }
            if (item.result === null) {
                return `${this.ago(item.started_at)} ago`;
            }
            return `95% ${this.ms_text(item.result.p95_ms)} · ${Math.round(item.result.rps).toLocaleString()}/s · ${this.ago(item.started_at)} ago`;
        },
        live_text: function (item) {
            if (item.phase === 'waking') {
                return `waking ${item.service}, ${format_ms(this.state.now - item.started_at)} so far`;
            }
            if (item.live === null) {
                return 'starting k6 — the first run pulls grafana/k6';
            }
            const rate = (item.live.ms === 0) ? 0 : Math.round(item.live.done/(item.live.ms/1000));
            return `${format_ms(item.live.ms)} of ${item.duration} · ${item.live.vus} users · ${item.live.done.toLocaleString()} answers · ${rate.toLocaleString()}/s`;
        },
        live_ratio: function (item) {
            return (item.live === null) ? 0 : Math.min(1, item.live.ms/item.duration_ms);
        },
        // The result's columns still on top: a run with no result draws one dash across them
        wake_text: function (item) {
            if (item.wake_ms === null) {
                return '—';
            }
            return (item.wake_ms < 50) ? 'was up' : this.ms_text(item.wake_ms);
        },
        ms_text: function (ms) {
            if (ms === null) {
                return '—';
            }
            return (ms < 10) ? `${ms.toFixed(1)} ms` : `${Math.round(ms).toLocaleString()} ms`;
        },
        pct_text: function (rate) {
            return (rate === null) ? '—' : `${Math.round(rate*1000)/10}%`;
        },
        ago: function (at) {
            return format_ms(Math.max(0, this.state.now - at));
        },
        form_begin: function (test) {
            this.report('', false);
            if (test !== null) {
                this.form = {original: test.name, name: test.name, service: test.service, url: test.url || '', remote: test.remote, vus: test.vus, duration: test.duration, p95_ms: test.p95_ms, errors_pct: test.errors_pct};
                return;
            }
            const service = (this.test_now === null) ? this.state.services[0] : this.state.services.find(v => v.name === this.test_now.service);
            const online = this.state.remotes.find(v => v.phase === 'online') || this.state.remotes[0];
            this.form = {original: null, name: '', service: (service === undefined) ? '' : service.name, url: '', remote: (online === undefined) ? '' : online.name, vus: 10, duration: '30s', p95_ms: 500, errors_pct: 1};
            this.form.name = this.name_free(this.form.service);
        },
        // A new test is named after its service, until somebody names it
        form_service_picked: function () {
            if (this.form.original === null) {
                this.form.name = this.name_free(this.form.service);
            }
        },
        name_free: function (base) {
            const name = base.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            for (let i = 1; ; i++) {
                const candidate = (i === 1) ? name : `${name}-${i}`;
                if (this.tests.some(v => v.name === candidate) === false) {
                    return candidate;
                }
            }
        },
        form_save: async function () {
            const form = this.form;
            const body = {name: form.name, service: form.service, remote: form.remote, url: form.url, vus: form.vus, duration: form.duration, p95_ms: form.p95_ms, errors_pct: form.errors_pct};
            const done = await this.call((form.original === null) ? 'POST' : 'PUT', (form.original === null) ? '/api/v1/load-tests' : `/api/v1/load-tests/${encodeURIComponent(form.original)}`, body);
            if (done) {
                this.picked = form.name;
                this.form = null;
            }
        },
        run: async function (test) {
            this.picked = test.name;
            await this.call('POST', `/api/v1/load-tests/${encodeURIComponent(test.name)}/run`);
        },
        stop: async function (test) {
            await this.call('POST', `/api/v1/load-tests/${encodeURIComponent(test.name)}/stop`);
        },
        remove: async function (test) {
            if (window.confirm(`Remove the load test ${test.name}? Its runs are forgotten with it.`) === false) {
                return;
            }
            if (await this.call('DELETE', `/api/v1/load-tests/${encodeURIComponent(test.name)}`)) {
                this.picked = null;
            }
        },
        // One call to serviceman; true when it did what was asked, the reason on the page when not
        call: async function (method, url, body) {
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch(url, {method, body: (body === undefined) ? undefined : JSON.stringify(body)});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    // The config's words, without the place in the config file the page did not show
                    this.report(outcome.error.replace(/^load_tests\[[0-9]+\]\./, ''), true);
                    return false;
                }
                return true;
            }
            catch {
                this.report('the answer never came back — the page says what landed within a second', true);
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        // A run's whole log under its row, asked for when opened; a second click folds it away
        log_toggle: async function (item) {
            if (this.log_id === item.id) {
                this.log_id = null;
                return;
            }
            this.log_id = item.id;
            this.log_text = null;
            this.log_note = 'loading…';
            this.log_bad = false;
            try {
                const answer = await fetch(`/api/v1/load-test-runs/${item.id}/log`, {cache: 'no-store'});
                if (this.log_id !== item.id) {
                    return;
                }
                if (answer.ok) {
                    this.log_text = await answer.text();
                    // Opened at its end, where k6's summary is
                    await this.$nextTick();
                    const pre = this.$el.querySelector('.lt-log pre');
                    if (pre !== null) {
                        pre.scrollTop = pre.scrollHeight;
                    }
                    return;
                }
                this.log_note = (await answer.json()).error;
                this.log_bad = true;
            }
            catch {
                this.log_note = 'the log did not come — serviceman did not answer';
                this.log_bad = true;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

export default load_tests_pane;
