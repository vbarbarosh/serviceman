import fold_table from './fold_table.js';
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
    <fold-table v-slot="fold" class="card" :order="['acts', 'remote', 'load', 'service']">
        <table class="list-table">
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Test</th>
                    <th data-fold="service">Service</th>
                    <th data-fold="remote">From</th>
                    <th data-fold="load">Load</th>
                    <th>Last run</th>
                    <th data-fold="acts"></th>
                </tr>
            </thead>
            <tbody>
                <template v-for="test of tests" :key="test.name">
                    <tr class="pick" :class="{on: (test.name === picked_name), foldable: (fold.folded.length > 0), open: fold.is_open(test.name)}" @click="picked = test.name; fold.toggle(test.name, $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps"><b>{{ test.name }}</b></td>
                        <td data-fold="service"><button type="button" class="link" @click.stop="$emit('select', test.service)">{{ test.service }}</button></td>
                        <td data-fold="remote"><button type="button" class="link" @click.stop="$emit('remote', test.remote)">{{ remote_title(test.remote) }}</button></td>
                        <td data-fold="load">{{ load_text(test) }}</td>
                        <td>
                            <span v-if="(last_of(test.name) !== null)" class="lt-last">
                                <span class="pill" :class="pill_of(last_of(test.name))">{{ phase_text(last_of(test.name)) }}</span>
                                <span class="muted">{{ result_text(last_of(test.name)) }}</span>
                            </span>
                            <span v-else class="muted">never run</span>
                        </td>
                        <td data-fold="acts" class="lt-act">
                            <button v-if="(going_of(test.name) === null)" type="button" :disabled="busy" @click.stop="run(test)">Run</button>
                            <button v-else type="button" :disabled="(busy || (going_of(test.name).phase === 'stopping'))" @click.stop="stop(test)">Stop</button>
                        </td>
                    </tr>
                    <tr v-if="fold.is_open(test.name)" class="fold-more" :class="{on: (test.name === picked_name)}">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('service')">
                                    <dt>Service</dt>
                                    <dd><button type="button" class="link" @click.stop="$emit('select', test.service)">{{ test.service }}</button></dd>
                                </template>
                                <template v-if="fold.folded.includes('remote')">
                                    <dt>From</dt>
                                    <dd><button type="button" class="link" @click.stop="$emit('remote', test.remote)">{{ remote_title(test.remote) }}</button></dd>
                                </template>
                                <template v-if="fold.folded.includes('load')">
                                    <dt>Load</dt>
                                    <dd>{{ load_text(test) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('acts')">
                                    <dt>Run</dt>
                                    <dd class="fold-actions">
                                        <button v-if="(going_of(test.name) === null)" type="button" :disabled="busy" @click.stop="run(test)">Run</button>
                                        <button v-else type="button" :disabled="(busy || (going_of(test.name).phase === 'stopping'))" @click.stop="stop(test)">Stop</button>
                                    </dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(tests.length === 0)">
                    <td class="muted wraps" colspan="6">No tests yet — <button type="button" class="link" @click="form_begin(null)">make the first one</button>.</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
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
        <fold-table v-slot="fold" class="card" :order="['acts', 'wake', 'max', 'p95', 'reqs', 'errors', 'rps', 'med']">
            <table class="list-table">
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>When</th>
                        <th>Result</th>
                        <th data-fold="reqs">Answers</th>
                        <th data-fold="rps">Per second</th>
                        <th data-fold="med">Median</th>
                        <th data-fold="p95">95%</th>
                        <th data-fold="max">Slowest</th>
                        <th data-fold="errors">Errors</th>
                        <th data-fold="wake">Woke in</th>
                        <th data-fold="acts"></th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="item of runs_now" :key="item.id">
                        <tr :class="{'lt-noted': (has_notes(item) || (log_id === item.id)), foldable: (fold.folded.length > 0), open: fold.is_open(item.id)}" @click="fold.toggle(item.id, $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td :title="new Date(item.started_at).toLocaleString()">{{ ago(item.started_at) }} ago</td>
                            <td><span class="pill" :class="pill_of(item)">{{ phase_text(item) }}</span></td>
                            <template v-if="(item.result !== null)">
                                <td data-fold="reqs">{{ item.result.reqs.toLocaleString() }}</td>
                                <td data-fold="rps">{{ Math.round(item.result.rps).toLocaleString() }}</td>
                                <td data-fold="med">{{ ms_text(item.result.med_ms) }}</td>
                                <td data-fold="p95" :class="{bad: (item.result.p95_passed === false)}">{{ ms_text(item.result.p95_ms) }}</td>
                                <td data-fold="max">{{ ms_text(item.result.max_ms) }}</td>
                                <td data-fold="errors" :class="{bad: (item.result.errors_passed === false)}">{{ pct_text(item.result.errors) }}</td>
                            </template>
                            <td v-else-if="(result_span(fold.folded) > 0)" class="muted" :colspan="result_span(fold.folded)">—</td>
                            <td data-fold="wake">{{ wake_text(item) }}</td>
                            <td data-fold="acts" class="lt-act"><button v-if="(item.log_kept === true)" type="button" @click="log_toggle(item)">{{ (log_id === item.id) ? 'Hide log' : 'Log' }}</button></td>
                        </tr>
                        <tr v-if="fold.is_open(item.id)" class="fold-more" :class="{'lt-noted': (has_notes(item) || (log_id === item.id))}">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="(item.result !== null)">
                                        <template v-if="fold.folded.includes('reqs')">
                                            <dt>Answers</dt>
                                            <dd>{{ item.result.reqs.toLocaleString() }}</dd>
                                        </template>
                                        <template v-if="fold.folded.includes('rps')">
                                            <dt>Per second</dt>
                                            <dd>{{ Math.round(item.result.rps).toLocaleString() }}</dd>
                                        </template>
                                        <template v-if="fold.folded.includes('med')">
                                            <dt>Median</dt>
                                            <dd>{{ ms_text(item.result.med_ms) }}</dd>
                                        </template>
                                        <template v-if="fold.folded.includes('p95')">
                                            <dt>95%</dt>
                                            <dd :class="{bad: (item.result.p95_passed === false)}">{{ ms_text(item.result.p95_ms) }}</dd>
                                        </template>
                                        <template v-if="fold.folded.includes('max')">
                                            <dt>Slowest</dt>
                                            <dd>{{ ms_text(item.result.max_ms) }}</dd>
                                        </template>
                                        <template v-if="fold.folded.includes('errors')">
                                            <dt>Errors</dt>
                                            <dd :class="{bad: (item.result.errors_passed === false)}">{{ pct_text(item.result.errors) }}</dd>
                                        </template>
                                    </template>
                                    <template v-if="(fold.folded.includes('wake') && (item.wake_ms !== null))">
                                        <dt>Woke in</dt>
                                        <dd>{{ wake_text(item) }}</dd>
                                    </template>
                                    <template v-if="(fold.folded.includes('acts') && (item.log_kept === true))">
                                        <dt>Log</dt>
                                        <dd class="fold-actions"><button type="button" @click="log_toggle(item)">{{ (log_id === item.id) ? 'Hide log' : 'Log' }}</button></dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                        <tr v-if="has_notes(item)" class="lt-notes" :class="{'lt-noted': (log_id === item.id)}">
                            <td class="wraps" :colspan="fold.span">
                                <div class="lt-room">
                                    <div v-if="(item.error !== null)" class="bad">{{ item.error }}</div>
                                    <div v-for="note of (item.said || [])" :key="note.text" class="muted">{{ note.count.toLocaleString() }} {{ (note.users ? ((note.count === 1) ? 'user got' : 'users got') : '×') }} {{ note.text }}</div>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="(log_id === item.id)" class="lt-log">
                            <td class="wraps" :colspan="fold.span">
                                <div class="lt-room">
                                    <p v-if="(log_text === null)" :class="(log_bad ? 'bad' : 'muted')">{{ log_note }}</p>
                                    <pre v-else class="lt-lines">{{ log_text }}</pre>
                                </div>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="(runs_now.length === 0)">
                        <td class="muted" colspan="10">Not run yet.</td>
                    </tr>
                </tbody>
            </table>
        </fold-table>
    </template>
</article>
`,
    components: {'fold-table': fold_table},
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        // `log_id` is the run whose log is open under it, and `log_text` that log once it came
        return {picked: null, form: null, busy: false, note: '', bad: false, log_id: null, log_text: null, log_note: '', log_bad: false};
    },
    computed: {
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
        result_span: function (folded) {
            return ['reqs', 'rps', 'med', 'p95', 'max', 'errors'].filter(v => (folded.includes(v) === false)).length;
        },
        wake_text: function (item) {
            if (item.wake_ms === null) {
                return '—';
            }
            return ((item.wake_ms < 50) ? 'was up' : this.ms_text(item.wake_ms));
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
                this.form = {original: test.name, name: test.name, service: test.service, url: (test.url || ''), remote: test.remote, vus: test.vus, duration: test.duration, p95_ms: test.p95_ms, errors_pct: test.errors_pct};
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
                const out = (i === 1) ? name : `${name}-${i}`;
                if (this.tests.some(v => v.name === out) === false) {
                    return out;
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
