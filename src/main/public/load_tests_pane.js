import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import format_ms from './format_ms.js';
import machine_card from './machine_card.js';
import machine_tile from './machine_tile.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';
import step_frame from './step_frame.js';

// Load tests: k6 sent at a service. A test is a number of users asking for one address for a
// while, run from a remote picked for it; each run is kept with what it measured.
const load_tests_pane = {
    template: `
<article id="detail" class="list load-tests">
    <step-frame v-if="(form !== null)" :title="((form.original === null) ? 'New load test' : ('Change ' + form.original))" :steps="steps" :step="step" :mode="((form.original === null) ? mode : 'page')" :switchable="(form.original === null)" :can_next="step_ok.ok" :next_title="step_ok.why" :busy="busy" :create_label="((form.original === null) ? 'Create test' : 'Save')" @step="step_go" @mode="mode = $event" @cancel="form = null" @create="form_save">
        <template #target>
            <div class="sf-field">
                <label for="lt-service">Service</label>
                <select id="lt-service" v-model="form.service" @change="form_service_picked">
                    <option v-for="item of service_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
            </div>
            <div class="sf-field">
                <label for="lt-url">Address</label>
                <input id="lt-url" v-model.trim="form.url" class="sf-mono" :placeholder="(address_of(form.service) || 'http://…')" spellcheck="false">
                <p class="sf-hint">left empty, the test asks the service's own address, the one shown</p>
            </div>
        </template>
        <template #load>
            <div class="sf-counts">
                <div class="sf-count">
                    <label for="lt-vus">Users at once</label>
                    <input id="lt-vus" v-model.number="form.vus" type="number" min="1" max="1000" class="sf-count-value">
                    <input v-model.number="form.vus" type="range" min="1" max="200" aria-label="Users at once">
                </div>
                <div class="sf-count">
                    <label for="lt-for">For</label>
                    <span class="sf-count-value-row"><input id="lt-for" v-model.lazy.trim="form.duration" class="sf-count-value" placeholder="30s" spellcheck="false"></span>
                    <input v-model.number="duration_secs" type="range" min="5" max="600" step="5" aria-label="For, in seconds">
                </div>
            </div>
            <h3 class="sf-sub">Run from</h3>
            <div class="machine-cards" role="radiogroup" aria-label="The machine k6 runs on">
                <machine-tile v-for="item of machine_cards" :key="item.value" :item="item" :on="(item.value === form.remote)" @click="form.remote = item.value"/>
            </div>
            <p class="sf-hint">An address under <code>.localhost</code> is serviceman's own: k6 is sent to serviceman over the tailnet, so any machine will do. A public name is asked as it is.</p>
        </template>
        <template #passes>
            <div class="sf-row">
                <div class="sf-field">
                    <label for="lt-p95">95% of answers under, ms</label>
                    <input id="lt-p95" v-model.number="form.p95_ms" type="number" min="1">
                </div>
                <div class="sf-field">
                    <label for="lt-errors">Errors under, %</label>
                    <input id="lt-errors" v-model.number="form.errors_pct" type="number" min="0" max="100" step="0.1">
                </div>
            </div>
        </template>
        <template #check>
            <div v-if="(mode === 'steps')" class="check-rows">
                <div v-for="row of check_rows" :key="row.key" class="check-row">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
                    <span class="cr-text"><span>{{ row.title }}</span><span class="muted">{{ row.text }}</span></span>
                    <button type="button" class="link" @click="step = row.step">Change</button>
                </div>
            </div>
            <div class="sf-field">
                <label for="lt-name">Name</label>
                <input id="lt-name" v-model.trim="form.name" class="sf-mono" spellcheck="false">
            </div>
        </template>
        <template #summary>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg><span class="mono">{{ form.name || 'not named yet' }}</span></p>
            <p v-for="row of check_rows" :key="row.key" class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/><span>{{ row.text }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <page-head category="load-tests" :count="tests.length">
        <template #acts>
            <button type="button" class="primary" :disabled="(form !== null)" @click="form_begin(null)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New test</button>
        </template>
        <template #how>
            <p>A test sends <a href="https://k6.io/" target="_blank" rel="noopener">k6</a> at a service: a number of users asking for one address for a while. k6 runs once, as the <code>grafana/k6</code> container on the remote you pick, and is removed afterwards. A sleeping service is woken first, so its start is not counted as a slow answer.</p>
        </template>
    </page-head>
    <data-table :columns="test_columns" :rows="tests" row_key="name" :row_class="test_class" :chosen="v => (v.name === picked_name)" :on_row="v => (picked = v.name)" framed :foot="test_foot" :empty_icon="TESTS_ICON" empty_title="No load tests yet" empty="Send many users at a service for a while, and see how fast it answers and how often it fails.">
        <template #empty_act><button type="button" class="primary" @click="form_begin(null)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New test</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="TESTS_ICON" :name="row.name" :line="((last_of(row.name) === null) ? 'never run' : result_text(last_of(row.name)))" :tone="(test_bad(row) ? 'bad' : '')"/>
            <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
            <button v-else-if="(column.key === 'remote')" type="button" class="link" @click="$emit('remote', row.remote)">{{ remote_title(row.remote) }}</button>
            <template v-else-if="(column.key === 'load')">{{ load_text(row) }}</template>
            <state-pill v-else-if="(column.key === 'last')" :tone="test_tone(row)" :text="((last_of(row.name) === null) ? 'never run' : phase_text(last_of(row.name)))"/>
        </template>
        <template #actions="{row}">
            <button v-if="(going_of(row.name) === null)" type="button" class="primary" :disabled="busy" @click="run(row)">Run</button>
            <button v-else type="button" :disabled="(busy || (going_of(row.name).phase === 'stopping'))" @click="stop(row)">Stop</button>
        </template>
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
    </template>
</article>
`,
    components: {'data-table': data_table, 'machine-tile': machine_tile, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill, 'step-frame': step_frame},
    props: ['state'],
    emits: ['form', 'remote', 'select'],
    data: function () {
        // `log_id` is the run whose log is open under it, and `log_text` that log once it came
        return {picked: null, form: null, step: 0, mode: 'steps', busy: false, note: '', bad: false, log_id: null, log_text: null, log_note: '', log_bad: false, TESTS_ICON: CATEGORIES.find(v => v.key === 'load-tests').icon};
    },
    computed: {
        // The form open, as the crumbs name it after the category; '' when none is
        form_crumb: function () {
            return (this.form === null) ? '' : ((this.form.original === null) ? 'New load test' : `Change ${this.form.original}`);
        },
        // Target, Load, Passes when, then Check; a change is one page of them
        steps: function () {
            const form = this.form;
            const out = [
                {key: 'target', name: 'Target', question: 'Which service, at which address?', says: 'A service of yours; its address, or another one it answers on.', answer: (form.url !== '') ? form.url : form.service},
                {key: 'load', name: 'Load', question: 'How many users, for how long?', says: 'k6 sends them at once, each asking again as soon as it is answered; a sleeping service is woken first.', answer: `${form.vus} users, ${form.duration}`},
                {key: 'passes', name: 'Passes when', question: 'When does it pass?', says: 'Both at once: fast enough, and few enough errors.', answer: `p95 < ${form.p95_ms} ms`},
            ];
            if ((form.original === null) && (this.mode === 'steps')) {
                out.push({key: 'check', name: 'Check', question: 'Check, then create', says: 'What Create writes, one row an answer.', answer: ''});
            }
            return out;
        },
        check_rows: function () {
            const form = this.form;
            return [
                {key: 'target', step: 0, title: 'Target', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>', text: `${form.service}${(form.url === '') ? '' : ` at ${form.url}`}`},
                {key: 'load', step: 1, title: 'Load', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M16 4.5a3.5 3.5 0 0 1 0 7M18 13.8c2 .9 3.5 3 3.5 6.2"/>', text: `${form.vus} users for ${form.duration}, from ${form.remote}`},
                {key: 'passes', step: 2, title: 'Passes when', icon: '<path d="M5 12l5 5 9-10"/>', text: `95% of answers under ${form.p95_ms} ms, errors under ${form.errors_pct}%`},
            ];
        },
        // What the open step wants before Next
        step_ok: function () {
            const form = this.form;
            const key = (this.mode === 'page') ? 'check' : this.steps[Math.min(this.step, this.steps.length - 1)].key;
            if ((key === 'target') && (form.service === '')) {
                return {ok: false, why: 'A service first'};
            }
            if ((key === 'load') && ((form.remote === '') || (Number(form.vus) < 1) || (form.duration === ''))) {
                return {ok: false, why: 'Users, how long, and a machine to run from'};
            }
            if ((key === 'passes') && ((Number(form.p95_ms) < 1) || (form.errors_pct === ''))) {
                return {ok: false, why: 'Both numbers first'};
            }
            return {ok: true, why: ''};
        },
        // The tables' columns, each that may fold with when
        // The test over its last result, its target, where it runs from, its load, how its last
        // run went; on a phone the target and the machine share a line
        test_columns: function () {
            return [
                {key: 'name', label: 'Test'},
                {key: 'service', label: 'Target', fold: 3},
                {key: 'remote', label: 'Run from', fold: 1},
                {key: 'load', label: 'Load', fold: 2, phone: 'hide'},
                {key: 'last', label: 'Status', phone: 'state'},
            ];
        },
        // The footer: how many tests, running, and failed last time
        test_foot: function () {
            const running = this.tests.filter(v => this.going_of(v.name) !== null).length;
            const failed = this.tests.filter(v => this.test_bad(v)).length;
            const out = [{text: `${this.tests.length} ${(this.tests.length === 1) ? 'test' : 'tests'}`, tone: ''}];
            if (running > 0) {
                out.push({text: `${running} running`, tone: ''});
            }
            if (failed > 0) {
                out.push({text: `${failed} failed last time`, tone: 'bad'});
            }
            return out;
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
        // Each machine k6 may run from, as a step's tile draws it
        machine_cards: function () {
            const canvas = ((this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            const kinds = Object.fromEntries(canvas.map(v => [v.name, v.kind]));
            const services = this.state.services;
            return this.state.remotes.map(v => machine_card(v, kinds[v.name], services.filter(vv => (vv.remotes || []).includes(v.name)).length));
        },
        // How long a test runs, in seconds, for its slider; the slider writes it back in seconds
        duration_secs: {
            get: function () {
                const parts = /^(\d+)\s*(s|m|h)?$/.exec(this.form.duration);
                if (parts === null) {
                    return 30;
                }
                return parseInt(parts[1], 10)*({s: 1, m: 60, h: 3600}[parts[2] || 's']);
            },
            set: function (secs) {
                this.form.duration = `${secs}s`;
            },
        },
    },
    watch: {
        // The crumbs name the form while it is open
        form_crumb: function (title) {
            this.$emit('form', title);
        },
    },
    beforeUnmount: function () {
        this.$emit('form', '');
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
        // A test whose last run failed, or did not run
        test_bad: function (test) {
            const last = this.last_of(test.name);
            return (last !== null) && ['failed', 'error'].includes(last.phase);
        },
        test_class: function (test) {
            return this.test_bad(test) ? 'dt-bad' : [];
        },
        test_tone: function (test) {
            const last = this.last_of(test.name);
            return (last === null) ? 'idle' : ({running: 'run', failed: 'bad', starting: 'busy'}[this.pill_of(last)] || 'idle');
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
        step_go: function (index) {
            if ((index > this.step) && (this.step_ok.ok === false)) {
                return;
            }
            this.step = index;
        },
        form_begin: function (test) {
            this.report('', false);
            this.step = 0;
            this.mode = (test === null) ? 'steps' : 'page';
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
