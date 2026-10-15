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
    <ul class="fold-list">
        <li v-for="test of tests" :key="test.name" :class="{open: test_open(test)}">
            <button type="button" class="fold-line" :aria-expanded="test_open(test)" @click="test_toggle(test)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <span class="dot" :class="test_dot(test)"/>
                <b class="name" :title="test.name">{{ test.name }}</b>
                <span class="route muted" :title="(test.service + ' · ' + load_text(test))">{{ test.service }} · {{ load_text(test) }}</span>
                <span class="word" :class="test_tone(test)" :title="test_hint(test)">{{ test_word(test) }}</span>
            </button>
            <div v-if="test_open(test)" class="fold-details">
                <dl>
                    <dt>Service</dt>
                    <dd><button type="button" class="link" @click="$emit('select', test.service)">{{ test.service }}</button></dd>
                    <dt>Runs from</dt>
                    <dd><button type="button" class="link" @click="$emit('remote', test.remote)">{{ remote_title(test.remote) }}</button></dd>
                    <dt>Load</dt>
                    <dd>{{ load_text(test) }}</dd>
                    <dt>Asks</dt>
                    <dd><code>{{ (test.url_asked || 'no address') }}</code><span v-if="(test.url === null)" class="muted"> · the service's own address</span></dd>
                    <dt>Passes when</dt>
                    <dd>{{ pass_text(test) }}</dd>
                    <template v-if="(via_of(test) !== null)">
                        <dt>Reached</dt>
                        <dd>{{ via_of(test) }}</dd>
                    </template>
                    <dt>Last run</dt>
                    <dd v-if="(runs_of(test).length === 0)" class="muted">{{ (going_of(test.name) === null ? 'never run' : 'none has ended yet') }}</dd>
                    <dd v-else><span :class="{bad: ['failed', 'error'].includes(runs_of(test)[0].phase)}">{{ phase_text(runs_of(test)[0]) }}</span><span class="muted"> · {{ result_text(runs_of(test)[0]) }}</span></dd>
                </dl>
                <div class="fold-actions">
                    <button v-if="(going_of(test.name) === null)" type="button" :disabled="busy" @click="run(test)">Run</button>
                    <button v-else type="button" :disabled="(busy || (going_of(test.name).phase === 'stopping'))" @click="stop(test)">Stop</button>
                    <button type="button" class="link" :disabled="(form !== null)" @click="form_begin(test)">change</button>
                    <button type="button" class="link" :disabled="(busy || (going_of(test.name) !== null))" @click="remove(test)">remove</button>
                </div>
                <template v-if="(going_of(test.name) !== null)">
                    <div class="row-of svc-state">
                        <span class="pill starting">{{ phase_text(going_of(test.name)) }}</span>
                        <span class="muted">{{ live_text(going_of(test.name)) }}</span>
                    </div>
                    <div class="meter"><i :style="{width: (Math.round(live_ratio(going_of(test.name))*100) + '%')}"/></div>
                    <pre v-if="(going_of(test.name).lines.length > 0)" class="lt-lines">{{ going_of(test.name).lines.slice(-12).join('\\n') }}</pre>
                </template>
                <ul class="fold-list">
                    <li v-for="item of runs_of(test)" :key="item.id" :class="{open: run_open(item)}">
                        <button type="button" class="fold-line" :aria-expanded="run_open(item)" @click="run_toggle(item)">
                            <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                            <span class="dot" :class="pill_of(item)"/>
                            <b class="name" :title="new Date(item.started_at).toLocaleString()">{{ ago(item.started_at) }} ago</b>
                            <span class="route" :class="((item.result !== null && item.result.p95_passed === false) ? 'bad' : 'muted')" title="95% of answers came faster than this">{{ (item.result === null ? '' : '95% ' + ms_text(item.result.p95_ms)) }}</span>
                            <span class="word" :class="{bad: ((item.phase === 'failed') || (item.phase === 'error'))}">{{ phase_text(item) }}</span>
                        </button>
                        <div v-if="run_open(item)" class="fold-details">
                            <dl>
                                <dt>Started</dt>
                                <dd>{{ new Date(item.started_at).toLocaleString() }}</dd>
                                <template v-if="(item.result !== null)">
                                    <dt>Answers</dt>
                                    <dd>{{ item.result.reqs.toLocaleString() }}</dd>
                                    <dt>Per second</dt>
                                    <dd>{{ Math.round(item.result.rps).toLocaleString() }}</dd>
                                    <dt>Median</dt>
                                    <dd>{{ ms_text(item.result.med_ms) }}</dd>
                                    <dt>95%</dt>
                                    <dd :class="{bad: (item.result.p95_passed === false)}">{{ ms_text(item.result.p95_ms) }}</dd>
                                    <dt>Slowest</dt>
                                    <dd>{{ ms_text(item.result.max_ms) }}</dd>
                                    <dt>Errors</dt>
                                    <dd :class="{bad: (item.result.errors_passed === false)}">{{ pct_text(item.result.errors) }}</dd>
                                </template>
                                <dt>Woke in</dt>
                                <dd :class="{muted: (item.wake_ms === null)}">{{ (item.wake_ms === null) ? '—' : ((item.wake_ms < 50) ? 'was up' : ms_text(item.wake_ms)) }}</dd>
                                <template v-if="(item.error !== null)">
                                    <dt>Why</dt>
                                    <dd class="bad">{{ item.error }}</dd>
                                </template>
                                <template v-if="((item.said || []).length > 0)">
                                    <dt>k6 said</dt>
                                    <dd><div v-for="note of item.said" :key="note.text" class="muted">{{ note.count.toLocaleString() }} {{ (note.users ? ((note.count === 1) ? 'user got' : 'users got') : '×') }} {{ note.text }}</div></dd>
                                </template>
                            </dl>
                            <div v-if="(item.log_kept === true)" class="fold-actions">
                                <button type="button" class="link" @click="log_toggle(item)">{{ (log_id === item.id) ? 'hide the log' : 'the log' }}</button>
                            </div>
                            <div v-if="(log_id === item.id)" class="lt-log">
                                <p v-if="(log_text === null)" :class="(log_bad ? 'bad' : 'muted')">{{ log_note }}</p>
                                <pre v-else class="lt-lines">{{ log_text }}</pre>
                            </div>
                        </div>
                    </li>
                    <li v-if="(runs_of(test).length === 0)" class="muted empty">{{ (going_of(test.name) === null ? 'Not run yet.' : 'The first run is going.') }}</li>
                </ul>
            </div>
        </li>
        <li v-if="(tests.length === 0)" class="muted empty">No tests yet — <button type="button" class="link" @click="form_begin(null)">make the first one</button>.</li>
    </ul>
    <p v-if="((form === null) && (note !== ''))" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
</article>
`,
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        // `picked` is the test last opened, whose service a new test starts from
        // `tests_opened` and `runs_opened` are the lines whose details are shown, by name and by id
        // `log_id` is the run whose log is open under it, and `log_text` that log once it came
        return {picked: null, tests_opened: {}, runs_opened: {}, form: null, busy: false, note: '', bad: false, log_id: null, log_text: null, log_note: '', log_bad: false};
    },
    computed: {
        tests: function () {
            return (this.state.load_tests === undefined) ? [] : this.state.load_tests;
        },
        runs: function () {
            return (this.state.load_test_runs === undefined) ? [] : this.state.load_test_runs;
        },
        service_options: function () {
            return this.state.services.map(v => ({value: v.name, label: v.name}));
        },
        remote_options: function () {
            return this.state.remotes.map(v => ({value: v.name, label: `${v.title || v.name}${(v.phase === 'online') ? '' : ` · ${v.phase}`}`}));
        },
    },
    methods: {
        // A lone test is open until it is closed, as it was shown at once before there were lines
        test_open: function (test) {
            const opened = this.tests_opened[test.name];
            return (opened === true) || ((opened === undefined) && (this.tests.length === 1));
        },
        test_toggle: function (test) {
            const open = (this.test_open(test) === false);
            this.tests_opened = Object.assign({}, this.tests_opened, {[test.name]: open});
            if (open) {
                this.picked = test.name;
            }
        },
        run_open: function (item) {
            return (this.runs_opened[item.id] === true);
        },
        run_toggle: function (item) {
            this.runs_opened = Object.assign({}, this.runs_opened, {[item.id]: (this.run_open(item) === false)});
        },
        // The run going now, or else the last one, for the test's one line
        test_dot: function (test) {
            if (this.going_of(test.name) !== null) {
                return 'starting';
            }
            const last = this.last_of(test.name);
            return (last === null) ? '' : this.pill_of(last);
        },
        test_word: function (test) {
            const going = this.going_of(test.name);
            if (going !== null) {
                return this.phase_text(going);
            }
            const last = this.last_of(test.name);
            return (last === null) ? 'never run' : this.phase_text(last);
        },
        test_tone: function (test) {
            const last = this.last_of(test.name);
            if (last === null) {
                return 'muted';
            }
            return ((last.phase === 'failed') || (last.phase === 'error')) ? 'bad' : '';
        },
        test_hint: function (test) {
            const last = this.last_of(test.name);
            return (last === null) ? '' : this.result_text(last);
        },
        // The runs that ended, the latest first
        runs_of: function (test) {
            return this.runs.filter(v => (v.test === test.name) && (v.ended_at !== null)).reverse();
        },
        // Where the latest run sent a .localhost name, when it said
        via_of: function (test) {
            const runs = this.runs_of(test);
            if ((runs.length === 0) || (runs[0].via === undefined) || (runs[0].via === null)) {
                return null;
            }
            return runs[0].via;
        },
        last_of: function (name) {
            const found = this.runs.filter(v => v.test === name);
            return (found.length === 0) ? null : found[found.length - 1];
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
            const test_now = this.tests.find(v => v.name === this.picked);
            const service = (test_now === undefined) ? this.state.services[0] : this.state.services.find(v => v.name === test_now.service);
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
                this.tests_opened = Object.assign({}, this.tests_opened, {[form.name]: true});
                this.form = null;
            }
        },
        run: async function (test) {
            this.picked = test.name;
            this.tests_opened = Object.assign({}, this.tests_opened, {[test.name]: true});
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
                this.tests_opened = Object.assign({}, this.tests_opened, {[test.name]: false});
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
