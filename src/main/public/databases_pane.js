import CATEGORIES from './categories.js';
import app_database_give from './app_database_give.js';
import clock_of from './clock_of.js';
import data_table from './data_table.js';
import database_cell from './database_cell.js';
import database_env_given from './database_env_given.js';
import database_new from './database_new.js';
import database_rows from './database_rows.js';
import database_state from './database_state.js';
import forward_now_said from './forward_now_said.js';
import item_facts from './item_facts.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import service_kind from './service_kind.js';
import service_state_word from './service_state_word.js';
import state_pill from './state_pill.js';
import to_clipboard from './to_clipboard.js';

// How often an open pane asks how the servers stand: one coming up says each step within seconds
const REFRESH_MS = 3000;
// What Copy URL's last copy is said by when it was the public port's URL
const PUBLIC = 'the internet';
// What a database's tables are called in its head, where an engine has none
const TABLES_WORDS = {couchdb: 'Users', mongodb: 'Collections'};
// Where each engine keeps its data in its container, the volume serviceman-db-<server> mounted there
const DATA_PATHS = {mongodb: '/data/db', postgresql: '/var/lib/postgresql/data', mysql: '/var/lib/mysql', couchdb: '/opt/couchdb/data'};
// The icons of a database's page, as the design draws them: the inside of a 24x24 stroked svg
const ICONS = {
    size: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    tables: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    reached: '<circle cx="5.5" cy="12" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><path d="M7.7 10.9l8.6-4.3M7.7 13.1l8.6 4.3"/>',
    given: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
    reach: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
    server: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
};
// An app's state word as its pill's tone
const TONES = {running: 'run', served: 'run', answers: 'run', starting: 'busy', stopping: 'busy', failed: 'bad', lost: 'bad', 'machine offline': 'bad'};

// Databases: every database on the machines, a row each, in one table: its engine, its machine,
// its size, the apps given it, how it stands. Each lives in a database server serviceman runs
// there, a container always up, its data in a folder kept for it there; a server with no
// database yet, coming up or failed is a row of its own. + New database opens New database; a row
// opens the database's page. An app finds one given it in DATABASE_URL at every start (a
// CouchDB in COUCHDB_URL, a MongoDB in MONGODB_URL), and the passwords stay with serviceman: the
// page sees names, sizes and who uses what, and a database's URL, its password in it, only
// when Copy URL asks for it, straight onto the clipboard.
const databases_pane = {
    template: `
<article id="detail" class="list databases" :class="{form: (place_now.page === 'new')}">
    <p v-if="(view === null)" class="muted"><span v-if="(load_error === '')" class="spin"/>{{ (load_error === '') ? 'reading…' : load_error }}</p>
    <database-new v-else-if="(place_now.page === 'new')" :view="view" :restore="(place_now.restore || null)" :given="(place_now.given || [])" :remote="(place_now.remote || '')" @close="$emit('place', null)" @made="made" @machine="$emit('machine', $event)"/>
    <template v-else-if="(place_now.page === 'database')">
        <!-- The kit's item head: what it is, how it stands, its engine and where it runs, its
             numbers; what is done to the whole of it is at the foot -->
        <div class="item-card db-head">
            <div class="item-top">
                <span class="item-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span>
                <div class="item-what">
                    <div class="item-name">
                        <h1>{{ open_title }}</h1>
                        <state-pill :tone="head_pill.tone" :text="head_pill.text"/>
                    </div>
                    <div class="item-line">
                        <span class="tag">{{ engine_text(open_server) }}</span>
                        <span v-if="server_only">a server on <button type="button" class="link" @click="$emit('remote', open_server.remote)">{{ open_server.title }}</button></span>
                        <span v-else>in {{ open_server.name }} on <button type="button" class="link" @click="$emit('remote', open_server.remote)">{{ open_server.title }}</button></span>
                    </div>
                </div>
                <item-facts :facts="open_facts"/>
            </div>
        </div>
        <!-- How it stands when it is not simply up: coming up step by step, failed, its machine away -->
        <div v-if="(open_server.phase === 'starting')" class="card db-steps" role="status">
            <div class="card-head"><h2><span class="spin"/>{{ open_server.name }} is coming up on {{ open_server.title }}</h2></div>
            <ol class="card-body">
                <li v-for="step of up_steps" :key="step.text" :class="step.state"><span v-if="(step.state === 'now')" class="spin"/><span v-else-if="(step.state === 'done')" class="db-step-mark">✓</span><span v-else class="db-step-mark">·</span>{{ step.text }}</li>
            </ol>
        </div>
        <div v-else-if="(open_server.phase === 'failed')" class="item-note" role="status">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>
            <span><b>{{ open_server.name }} did not come up</b><span>{{ open_server.error || 'It stopped with no word of why.' }}</span></span>
            <button type="button" :disabled="(busy || (open_server.online === false))" :title="(open_server.online ? 'Again where it was, with the password its data was made with' : (open_server.title + ' is offline'))" @click="again(open_server)">Bring it up again</button>
        </div>
        <div v-else-if="(open_server.online === false)" class="item-note" role="status">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>
            <span><b>{{ open_server.title }} is offline</b><span>{{ offline_said }}</span></span>
            <button type="button" @click="$emit('remote', open_server.remote)">See {{ open_server.title }}</button>
        </div>
        <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
        <!-- A server with no database in it: one card, what a database made in it gets -->
        <section v-if="server_only" class="card db-server-empty">
            <div class="db-empty">
                <span class="db-empty-tile"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span>
                <b>No database in it yet</b>
                <p class="muted">A server of {{ engine_text(open_server) }}, up on {{ open_server.title }}. A database made in it gets a user of its own, and an app given it finds it in <code>{{ open_env }}</code>.</p>
                <button type="button" class="primary" @click="new_in_it"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database in it</button>
            </div>
        </section>
        <div v-else class="db-cols">
            <section class="card db-given">
                <div class="card-head">
                    <h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="ICONS.given"/>Given to</h2>
                    <button v-if="((given_rows.length > 0) && give_able)" type="button" class="link" @click="give_open"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Give it to an app</button>
                </div>
                <template v-if="(given_rows.length > 0)">
                    <table class="db-table">
                        <thead><tr><th>App</th><th>Finds it in</th><th>Status</th></tr></thead>
                        <tbody>
                            <tr v-for="row of given_rows" :key="row.name">
                                <td class="db-c-name"><button type="button" class="db-app" @click="$emit('select', row.name)"><span class="db-app-tile"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/></span><span><b>{{ row.name }}</b><small>{{ row.line }}</small></span></button></td>
                                <td class="db-c-env"><span class="db-narrow muted">finds it in </span><template v-for="(code, index) of row.codes" :key="code"><span v-if="(index > 0)"> and </span><code>{{ code }}</code></template>{{ row.after }}</td>
                                <td class="db-c-status"><state-pill :tone="row.tone" :text="row.word"/></td>
                            </tr>
                        </tbody>
                    </table>
                    <p class="db-foot muted">{{ given_foot }}</p>
                </template>
                <div v-else class="db-empty">
                    <span class="db-empty-tile"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="ICONS.given"/></span>
                    <b>{{ given_empty.title }}</b>
                    <p v-if="(given_empty.text !== '')" class="muted" v-html="given_empty.text"/>
                    <button v-if="give_able" type="button" class="primary" @click="give_open"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Give it to an app</button>
                </div>
            </section>
            <section class="card db-reach">
                <div class="card-head"><h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="ICONS.reach"/>How an app reaches it</h2></div>
                <dl class="db-reach-rows card-body">
                    <template v-for="row of reach_rows" :key="row.label">
                        <dt>{{ row.label }}</dt>
                        <dd :class="{dim: row.dim}" v-html="row.html"/>
                    </template>
                    <dd class="db-lock muted"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>{{ lock_said }}</dd>
                </dl>
            </section>
        </div>
        <!-- Its port on other machines and on the internet, and the URL with its password for
             connecting by hand: a line each, how it stands in a pill, its buttons at its right
             (on a phone, a row of their own at its foot) -->
        <section v-if="(open_server.phase === 'up')" class="card db-reached">
            <div class="card-head"><h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.reached"/>Reached from</h2></div>
            <div class="card-body">
            <div class="db-fwds">
                <div v-if="(open_server.port !== null)" class="db-fwd">
                    <b>{{ open_server.title }}</b>
                    <code>127.0.0.1:{{ open_server.port }}</code>
                    <span class="muted">its own machine</span>
                    <span class="db-fwd-acts">
                        <button type="button" :disabled="(copy_why(open_server.remote, null) !== '')" :title="copy_title(open_server.remote, open_server.port, null)" @click="url_copy(open_server.remote)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.copy"/>{{ ((copied === open_server.remote) ? 'Copied' : 'Copy URL') }}</button>
                    </span>
                </div>
                <div v-for="item of machine_forwards" :key="item.label" class="db-fwd">
                    <b>{{ machine_title(item.to.remote) }}</b>
                    <code>{{ end_text(item.to) }}</code>
                    <state-pill :tone="forward_pill(item).tone" :text="forward_pill(item).text"/>
                    <span v-if="(forward_pill(item).problem !== null)" class="bad">{{ forward_pill(item).problem }}</span>
                    <span v-if="(item.apps.length > 0)" class="muted">{{ item.apps.join(', ') }} {{ (item.apps.length === 1) ? 'finds' : 'find' }} it here</span>
                    <span class="db-fwd-acts">
                        <button v-if="(item.to.socket === null)" type="button" :disabled="(copy_why(item.to.remote, item) !== '')" :title="copy_title(item.to.remote, item.to.port, item)" @click="url_copy(item.to.remote)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.copy"/>{{ ((copied === item.to.remote) ? 'Copied' : 'Copy URL') }}</button>
                        <button type="button" class="db-fwd-x" :disabled="busy" :title="drop_title(item)" :aria-label="('Bring it to ' + machine_title(item.to.remote) + ' no more')" @click="forward_drop(item)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.close"/></button>
                    </span>
                </div>
                <div v-if="((public_port !== null) && (opening === null))" class="db-fwd db-fwd-public">
                    <b>The internet</b>
                    <code>{{ public_port.address || ('its public address on ' + open_server.title) }}:{{ public_port.to.port }}</code>
                    <span class="tag" :class="(public_port.tls ? 'db-tls-on' : 'db-tls-off')">{{ public_port.tls ? 'TLS' : 'no TLS' }}</span>
                    <span class="muted">{{ (public_port.allow.length === 0) ? 'anyone may connect' : ('from ' + public_port.allow.join(', ') + ' alone') }}</span>
                    <state-pill :tone="forward_pill(public_port).tone" :text="forward_pill(public_port).text"/>
                    <span v-if="(forward_pill(public_port).problem !== null)" class="bad">{{ forward_pill(public_port).problem }}</span>
                    <span class="db-fwd-acts">
                        <button type="button" :disabled="(public_copy_why !== '')" :title="public_copy_title" @click="url_copy(null)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.copy"/>{{ ((copied === PUBLIC) ? 'Copied' : 'Copy URL') }}</button>
                        <a v-if="public_port.tls" class="button" :href="('/api/v1/databases/' + encodeURIComponent(open_server.name) + '/certificate')" :download="(open_server.name + '-ca.pem')" title="Its authority's file: a client checks the server by it (tlsCAFile in the URL)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.download"/>Certificate</a>
                        <button type="button" :disabled="busy" title="Its port, TLS, and who may connect" @click="public_change">Change</button>
                        <button type="button" class="db-fwd-x" :disabled="busy" title="Close its public port: nothing listens for it on the internet any more, and its firewall rule goes" aria-label="Close its public port" @click="forward_drop(public_port)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.close"/></button>
                    </span>
                    <p v-if="(public_port.firewall !== null)" class="muted db-fwd-said"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.shield"/><span>{{ public_port.firewall }}</span></p>
                </div>
                <div v-if="(adding !== null)" class="db-fwd db-fwd-new">
                    <select ref="adding_remote" v-model="adding.remote" aria-label="The machine it shows up on">
                        <option value="" disabled>a machine</option>
                        <option v-for="item of forward_machines" :key="item.remote" :value="item.remote">{{ item.title }}{{ item.online ? '' : ' · offline' }}</option>
                    </select>
                    <span class="db-fwd-at"><span class="muted">127.0.0.1:</span><input v-model.trim="adding.port" :placeholder="String(engine_port)" inputmode="numeric" spellcheck="false" autocomplete="off" aria-label="The port there" @keydown.enter.prevent="forward_save"></span>
                    <span class="db-fwd-acts">
                        <button type="button" class="primary" :disabled="(busy || (adding.remote === ''))" @click="forward_save">Save</button>
                        <button type="button" :disabled="busy" @click="forward_cancel">Cancel</button>
                    </span>
                </div>
                <div v-if="(opening !== null)" class="db-fwd db-fwd-new">
                    <b>The internet</b>
                    <span class="db-fwd-at"><span class="muted">{{ public_address_text }}:</span><input ref="opening_port" v-model.trim="opening.port" :placeholder="String(engine_port)" inputmode="numeric" spellcheck="false" autocomplete="off" aria-label="Its port there" @keydown.enter.prevent="public_save"></span>
                    <label class="db-fwd-check" title="The client speaks TLS, and checks the server by its authority's file"><input v-model="opening.tls" type="checkbox"> TLS</label>
                    <input v-model.trim="opening.allow" class="db-fwd-allow" placeholder="anyone, or 203.0.113.5, 10.0.0.0/8" spellcheck="false" autocomplete="off" aria-label="Who may connect: addresses and networks, or none for anyone" @keydown.enter.prevent="public_save">
                    <span class="db-fwd-acts">
                        <button type="button" class="primary" :disabled="busy" @click="public_save">Save</button>
                        <button type="button" :disabled="busy" @click="public_cancel">Cancel</button>
                    </span>
                </div>
                <p v-if="(forward_note !== '')" class="bad">{{ forward_note }}</p>
                <p v-if="((open_server.forwards.length === 0) && (adding === null) && (opening === null))" class="muted">Reached on {{ open_server.title }} alone. On a machine picked here its port shows up at that machine's 127.0.0.1 too, as <code>ssh -L</code> brings one, with no ssh: the agents carry it, and a program there picks it in its Data tab. Nothing opens to the internet.</p>
                <span v-if="((adding === null) && (opening === null))" class="db-fwd-adds">
                    <button type="button" class="db-fwd-add" :disabled="(busy || (open_server.phase !== 'up') || (forward_machines.length === 0))" :title="forward_add_title" @click="forward_add">{{ (machine_forwards.length === 0) ? '+ a machine' : '+ another machine' }}</button>
                    <button v-if="((open_server.engine === 'mongodb') && (public_port === null))" type="button" class="db-fwd-add" :disabled="(busy || (open_server.phase !== 'up'))" :title="public_add_title" @click="public_open">+ the internet</button>
                </span>
            </div>
            </div>
        </section>
        <section v-if="(others.length > 0)" class="card db-beside">
            <div class="card-head"><h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="ICONS.server"/>Beside it in {{ open_server.name }}</h2></div>
            <table class="db-table">
                <thead><tr><th>Database</th><th class="db-num">Size</th><th>Given to</th><th>Status</th></tr></thead>
                <tbody>
                    <tr v-for="item of others" :key="item.name" class="db-row-go" @click="row_open({server: open_server.name, database: item.name})">
                        <td class="db-c-name"><button type="button" class="db-app" @click.stop="row_open({server: open_server.name, database: item.name})"><span class="db-app-tile"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span><span><b>{{ item.name }}</b></span></button></td>
                        <td class="db-num db-c-size">{{ size_text(item.bytes) }}</td>
                        <td class="db-c-given" :class="{muted: (item.apps.length === 0)}"><span class="db-narrow muted">· </span>{{ (item.apps.length === 0) ? 'no app yet' : item.apps.join(', ') }}</td>
                        <td class="db-c-status"><state-pill :tone="head_pill.tone" :text="head_pill.text"/></td>
                    </tr>
                </tbody>
            </table>
            <p class="db-foot muted">{{ (others.length === 1) ? '1 database' : (others.length + ' databases') }} · Remove takes {{ (others.length === 1) ? 'it' : 'them' }} too</p>
        </section>
        <div class="card db-remove">
            <b>Remove {{ open_title }}</b>
            <span class="muted">{{ remove_said }}</span>
            <button type="button" class="danger" :disabled="((removing !== null) || (open_server.phase === 'removing') || (open_server.online === false))" :title="((open_server.online === false) ? (open_server.title + ' is offline: removed once it is back') : '')" @click="remove_begin(open_server)">Remove…</button>
        </div>
        <!-- Give it to an app: every app, those that reach it to tick -->
        <div v-if="(giving !== null)" class="dt-window" @click.self="give_close" @keydown.esc="give_close">
            <div class="dt-whole db-window" role="dialog" aria-modal="true" :aria-label="('Give ' + open_title + ' to an app')">
                <div class="db-window-head">
                    <span class="db-window-tile"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="ICONS.given"/></span>
                    <span><b>Give {{ open_title }} to an app</b><small>{{ engine_text(open_server) }} in {{ open_server.name }} on {{ open_server.title }}</small></span>
                    <button type="button" class="db-window-x" title="Close (Esc)" aria-label="Close" @click="give_close">×</button>
                </div>
                <div class="db-window-body">
                    <p>Each one ticked finds it in its variable at every start, signed in as <code>{{ open_user }}</code>.</p>
                    <div class="db-give-list" role="group" aria-label="The apps">
                        <label v-for="item of give_cards" :key="item.name" class="db-give" :class="{on: (item.ticked && (item.has === false)), off: item.disabled}" :title="item.why">
                            <input type="checkbox" :checked="item.ticked" :disabled="item.disabled" :aria-label="('Give it to ' + item.name)" @change="give_tick(item.name)">
                            <b>{{ item.name }}</b>
                            <span class="muted">{{ item.line }}</span>
                            <span v-if="item.ticked" class="db-give-end"><code>{{ item.env }}</code></span>
                            <span v-else-if="item.disabled" class="db-give-end"><span class="muted">{{ item.why }}</span></span>
                        </label>
                    </div>
                    <p v-if="(giving.error !== '')" class="bad">{{ giving.error }}</p>
                </div>
                <div class="db-window-foot">
                    <span class="muted">{{ give_said }}</span>
                    <button type="button" :disabled="giving.busy" @click="give_close">Cancel</button>
                    <button type="button" class="primary" :disabled="(giving.busy || (giving.picked.length === 0))" @click="give_save">{{ give_button }}</button>
                </div>
            </div>
        </div>
        <!-- Remove…: what goes, the server's name typed again -->
        <div v-if="(removing !== null)" class="dt-window" @click.self="removing = null" @keydown.esc="removing = null">
            <div class="dt-whole db-window" role="dialog" aria-modal="true" :aria-label="('Remove ' + open_title)">
                <div class="db-window-head">
                    <span class="db-window-tile bad"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg></span>
                    <span><b>Remove {{ open_title }}?</b><small>it goes with its server, {{ open_server.name }}, on {{ open_server.title }}</small></span>
                    <button type="button" class="db-window-x" title="Close (Esc)" aria-label="Close" @click="removing = null">×</button>
                </div>
                <div class="db-window-body">
                    <dl class="db-window-rows">
                        <template v-for="row of remove_rows" :key="row.label"><dt>{{ row.label }}</dt><dd><code v-if="(row.code !== '')">{{ row.code }}</code>{{ row.text }}</dd></template>
                    </dl>
                    <p v-if="(removing.error !== '')" class="bad">{{ removing.error }}</p>
                    <label class="db-window-type"><b>Type {{ open_server.name }} to remove it</b><input ref="remove_name" v-model.trim="removing.typed" :placeholder="open_server.name" spellcheck="false" autocomplete="off" @keydown.enter="remove_save"></label>
                </div>
                <div class="db-window-foot">
                    <span/>
                    <button type="button" :disabled="busy" @click="removing = null">Cancel</button>
                    <button type="button" class="danger" :disabled="((removing.typed !== open_server.name) || busy)" @click="remove_save">Remove {{ open_server.name }}</button>
                </div>
            </div>
        </div>
    </template>
    <template v-else>
        <page-head category="databases" :count="databases_count">
            <template #acts>
                <button type="button" class="primary" @click="$emit('place', {page: 'new'})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database</button>
            </template>
        </page-head>
        <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
        <data-table :columns="columns" :rows="rows_shown" row_key="key" :row_class="(row => (row.bad ? 'dt-bad' : []))" :on_row="row_open" :marks="false" framed :total="rows.length" :foot="foot" :empty_icon="DATABASES_ICON" empty_title="No databases yet" empty="A database server on a machine of yours, empty or with a sample, given to your apps by its URL.">
            <template #tools>
                <input v-model.trim="filter" type="search" placeholder="Find a database" aria-label="Find a database by its name, engine, machine or app" spellcheck="false">
                <span class="dt-chips">
                    <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                        <span v-if="(chip.dot !== null)" class="dot" :class="chip.dot"/>
                        {{ chip.label }}
                        <span class="muted">{{ chip.count }}</span>
                    </button>
                </span>
            </template>
            <template #empty_act><button type="button" class="primary" @click="$emit('place', {page: 'new'})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database</button></template>
            <template #cell="{row, column}">
                <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="(row.bad ? row.detail : row.aside)" :tone="(row.bad ? 'bad' : '')"/>
                <state-pill v-else-if="(column.key === 'state')" :tone="({running: 'run', failed: 'bad', starting: 'busy', stopping: 'busy'}[row.dot] || 'idle')" :text="row.state"/>
                <table-cell v-else :row="row" :column="column" @select="$emit('select', $event)"/>
            </template>
        </data-table>
    </template>
</article>
`,
    components: {
        'data-table': data_table,
        'database-new': database_new,
        'item-facts': item_facts,
        'name-cell': name_cell,
        'page-head': page_head,
        'state-pill': state_pill,
        'table-cell': database_cell,
    },
    // place: what is open, null for the table; {page: 'new', restore, given, remote} for New
    // database; {page: 'database', server, database} for a database's page, database '' for a
    // server with none
    // state: the status the page reads, for each app's kind, machine and how it stands
    props: {
        place: {type: Object, default: null},
        state: {type: Object, default: null},
    },
    emits: ['changed', 'machine', 'place', 'remote', 'select'],
    data: function () {
        // removing: Remove's typed confirmation on a database's page; adding: a machine its port
        // is brought to, being picked, {remote, port}; opening: its public port being opened or
        // changed, {port, tls, allow}, allow as typed; forward_note what a write of them, or a
        // Copy URL, said; copied: the machine whose URL Copy URL put on the clipboard last, PUBLIC
        // for its public port's
        // giving: Give it to an app's window, {picked, busy, error}
        return {PUBLIC, ICONS, DATABASE_ICON: database_rows.DATABASE_ICON, DATABASES_ICON: CATEGORIES.find(v => v.key === 'databases').icon, view: null, load_error: '', filter: '', show: 'all', removing: null, adding: null, opening: null, giving: null, forward_note: '', copied: '', busy: false, note: '', bad: false, timer: null};
    },
    computed: {
        // The page open: a database that is not there any more shows the table
        place_now: function () {
            if ((this.place === null) || (this.view === null)) {
                return {page: 'list'};
            }
            if ((this.place.page === 'database') && (this.open_server === null)) {
                return {page: 'list'};
            }
            return this.place;
        },
        servers: function () {
            return (this.view === null) ? [] : this.view.servers;
        },
        // A row per database, and one for each server with none to show
        rows: function () {
            return database_rows(this.servers, this.view.engines);
        },
        rows_shown: function () {
            const words = this.filter.toLowerCase().split(/\s+/).filter(v => v !== '');
            const show = this.show;
            return this.rows.filter(function (row) {
                if ((show === 'running') && (row.dot !== 'running')) {
                    return false;
                }
                if ((show === 'needs') && (row.bad === false)) {
                    return false;
                }
                const text = [row.name, row.server, row.engine, row.machine].concat(row.apps).join(' ').toLowerCase();
                return words.every(v => text.includes(v));
            });
        },
        chips: function () {
            return [
                {value: 'all', label: 'All', dot: null, count: this.rows.length},
                {value: 'running', label: 'Running', dot: 'running', count: this.rows.filter(v => v.dot === 'running').length},
                {value: 'needs', label: 'Needs you', dot: 'failed', count: this.rows.filter(v => v.bad).length},
            ];
        },
        databases_count: function () {
            return (this.view === null) ? '' : String(this.rows.filter(v => v.database !== '').length);
        },
        // The name over what is wrong or what it is, its engine, machine, size, the apps it is
        // given to, its state; on a phone the engine and the machine share a line, the apps one
        // of their own
        columns: function () {
            return [
                {key: 'name', label: 'Name'},
                {key: 'engine', label: 'Engine', fold: 4},
                {key: 'machine', label: 'Remote', fold: 3},
                {key: 'size', label: 'Size', align: 'right', fold: 2, phone: 'hide'},
                {key: 'apps', label: 'Given to', wraps: true, fold: 5, phone: 'row'},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        // The footer: how many, how many run, how many need a look
        foot: function () {
            const running = this.rows.filter(v => v.dot === 'running').length;
            const bad = this.rows.filter(v => v.bad).length;
            const out = [{text: `${this.rows.length} ${(this.rows.length === 1) ? 'database' : 'databases'}`, tone: ''}, {text: `${running} running`, tone: ''}];
            if (bad > 0) {
                out.push({text: `${bad} ${(bad === 1) ? 'needs' : 'need'} you`, tone: 'bad'});
            }
            return out;
        },
        open_server: function () {
            if ((this.place === null) || (this.place.page !== 'database')) {
                return null;
            }
            return this.servers.find(v => v.name === this.place.server) || null;
        },
        open_database: function () {
            if (this.open_server === null) {
                return null;
            }
            return this.open_server.databases.find(v => v.name === this.place.database) || null;
        },
        open_title: function () {
            return (this.open_database === null) ? this.open_server.name : this.open_database.name;
        },
        // The databases beside it in its server, which its Remove takes too
        others: function () {
            return this.open_server.databases.filter(v => v !== this.open_database);
        },
        // What its tiles said, in its head: its size, its tables (a CouchDB's users, a MongoDB's
        // collections), and where it is reached from; its server is named in the line beside its
        // engine
        // A server up with no database in it yet: its page is the server's
        server_only: function () {
            return (this.open_database === null) && (this.open_server.phase === 'up') && (this.open_server.online !== false);
        },
        open_facts: function () {
            const server = this.open_server;
            const database = this.open_database;
            const couch = (server.engine === 'couchdb');
            const out = [];
            if (this.server_only) {
                out.push({label: 'Databases', icon: ICONS.size, value: String(server.databases.length), small: '', share: null, title: `the databases in ${server.name}`});
                out.push(this.reached_fact);
                return out;
            }
            // Its machine away: the numbers as last read, dimmed, with when
            const read = ((server.online === false) && (server.read_at !== null) && (server.read_at !== undefined)) ? `at ${clock_of(server.read_at)}` : '';
            const dim = (server.online === false);
            out.push({label: 'Size', icon: ICONS.size, value: (database === null) ? '—' : database_rows.size(database.bytes), small: read, share: null, dim, title: (database === null) ? 'no database in it' : `its data, on ${server.title}`});
            out.push({label: TABLES_WORDS[server.engine] || 'Tables', icon: couch ? ICONS.users : ICONS.tables, value: (database === null) ? '—' : String(database.tables), small: read, share: null, dim, title: (database === null) ? '' : (couch ? 'a database each, made by the app' : 'as its server says them')});
            out.push(this.reached_fact);
            return out;
        },
        // Where it is reached from, short, as a phone has room for: the machines by name in its
        // title and its card
        reached_fact: function () {
            const server = this.open_server;
            const others = [...new Set(server.forwards.filter(v => v.to.host === null).map(v => this.machine_title(v.to.remote)))];
            const opened = server.forwards.find(v => v.to.host !== null);
            const machines = (others.length === 0) ? 'nothing outside it' : `and on ${others.join(', ')} through its forwards`;
            const reached = (opened === undefined) ? `${machines}${(others.length === 0) ? '' : '; nothing outside them'}` : `${machines}, and from the internet at its port ${opened.to.port}`;
            const value = (others.length === 0) ? 'its machine' : `${others.length + 1} machines`;
            return {label: 'Reached from', icon: ICONS.reached, value: (opened === undefined) ? value : 'the internet', small: (server.port === null) ? '' : `127.0.0.1:${server.port}`, share: null, mono: true, title: (server.port === null) ? reached : `127.0.0.1:${server.port} on ${server.title}, ${reached}`};
        },
        // The machines by name and title, as a forward's state names them
        remotes_named: function () {
            return this.view.machines.map(v => ({name: v.remote, title: v.title}));
        },
        // The machines its port may be brought to: every one but its own, where it is already
        forward_machines: function () {
            return this.view.machines.filter(v => v.remote !== this.open_server.remote);
        },
        forward_add_title: function () {
            if (this.open_server.phase !== 'up') {
                return 'Once it is up';
            }
            return (this.forward_machines.length === 0) ? 'It is on the only machine: add another on Remotes' : 'Its port at another machine\'s 127.0.0.1 too';
        },
        // The head's pill: how the server stands, its machine away above all
        head_pill: function () {
            const said = database_state(this.open_server);
            return {tone: {running: 'run', failed: 'bad', starting: 'busy', stopping: 'busy'}[said.dot] || 'idle', text: said.word};
        },
        // Coming up, step by step: the one said now turning, those before it done
        up_steps: function () {
            const server = this.open_server;
            const engine = this.view.engines.find(v => v.value === server.engine);
            const sample = ((engine === undefined) || (server.sample === '')) ? undefined : engine.samples.find(v => v.value === server.sample);
            const steps = [['pulling', 'pulling its image'], ['making', 'making its container'], ['waiting', `waiting for ${(engine === undefined) ? server.engine : engine.label} to answer`]];
            if (sample !== undefined) {
                steps.push(['fetching', `fetching ${sample.label}`], ['loading', `loading ${sample.label}`]);
            }
            const said = server.said || '';
            const now = steps.findIndex(v => said.startsWith(v[0]));
            return steps.map((v, i) => ({text: (i === now) ? said : v[1], state: (i < now) ? 'done' : ((i === now) ? 'now' : 'next')}));
        },
        offline_said: function () {
            const apps = this.given_rows.map(v => v.name);
            const waits = (apps.length === 0) ? '' : `; ${apps.join(', ')}, given it, ${(apps.length === 1) ? 'waits' : 'wait'} for it`;
            return `Its databases show once it is back${waits}.`;
        },
        // The apps given it, each with its kind, its machine and how it stands, as the status says
        given_rows: function () {
            if (this.open_database === null) {
                return [];
            }
            const services = (this.state === null) ? [] : this.state.services;
            const envs = this.open_database.envs;
            const offline = (this.open_server.online === false);
            const couch = (this.open_server.engine === 'couchdb');
            // A CouchDB's admin comes with its secret; an app whose store for each user it is
            // finds it at /_couch, on its own address
            const given = this.open_database.apps.map(v => ({name: v, codes: couch ? [envs[v], secret_of(envs[v])] : [envs[v]], after: ''}));
            const stores = (this.open_server.stores || []).filter(v => given.some(vv => vv.name === v) === false).map(v => ({name: v, codes: ['/_couch'], after: ' a store for each user'}));
            return given.concat(stores).map(function (row) {
                const service = services.find(v => v.name === row.name);
                if (service === undefined) {
                    return Object.assign(row, {icon: ICONS.given, line: '', word: 'not there', tone: 'bad'});
                }
                const kind = service_kind(service);
                const machine = ((service.remotes === undefined) || (service.remotes.length === 0)) ? 'serviceman' : service.remotes[0];
                const word = offline ? 'machine offline' : service_state_word(service);
                return Object.assign(row, {icon: kind.icon, line: `${kind.word} · ${machine}`, word, tone: TONES[word] || 'idle'});
            });
        },
        given_foot: function () {
            const count = this.given_rows.length;
            const apps = (count === 1) ? '1 app' : `${count} apps`;
            if (this.open_server.online === false) {
                return `${apps} · ${(count === 1) ? 'it finds' : 'they find'} the database again when ${this.open_server.title} is back`;
            }
            if (this.open_server.engine === 'couchdb') {
                return `${apps} · every user its wall signs in has a database of their own`;
            }
            return `${apps} · ${(count === 1) ? 'it finds' : 'each finds'} it at its every start`;
        },
        // What Given to says with no app: why none can be, or what one given it finds
        given_empty: function () {
            const server = this.open_server;
            if (server.phase === 'starting') {
                return {title: 'Its databases show once it is up', text: ''};
            }
            if (server.phase === 'failed') {
                return {title: 'Nothing to give yet', text: 'It did not come up: Bring it up again once what it says is fixed.'};
            }
            if (this.open_database === null) {
                return {title: `No database in ${server.name} yet`, text: ''};
            }
            if (this.open_database.user === null) {
                return {title: 'No app can be given it', text: 'It was made outside serviceman: serviceman has no user of its own for it.'};
            }
            return {title: 'No app is given it yet', text: `An app given it finds it in <code>${esc(this.open_env)}</code> at every start, signed in as <code>${esc(this.open_user)}</code>.`};
        },
        lock_said: function () {
            if (this.open_server.engine === 'couchdb') {
                return 'the password and the secret stay with serviceman: an app finds them filled in';
            }
            return 'the password stays with serviceman: an app finds it filled in';
        },
        give_able: function () {
            return (this.open_server.phase === 'up') && (this.open_server.online !== false) && (this.open_database !== null) && (this.open_database.user !== null);
        },
        open_env: function () {
            return database_env_given(this.open_server.engine);
        },
        open_user: function () {
            return ((this.open_database === null) || (this.open_database.user === null)) ? '' : this.open_database.user;
        },
        // How an app reaches it, a row each: its variable, its user, its URL from a container and
        // from its machine (the password as dots, a break only after @ and before /<database>),
        // its data
        reach_rows: function () {
            const server = this.open_server;
            const database = this.open_database;
            const engine = this.view.engines.find(v => v.value === server.engine);
            const scheme = (engine === undefined) ? server.engine : engine.scheme;
            const couch = (server.engine === 'couchdb');
            const user = (this.open_user === '') ? '…' : this.open_user;
            const tail = (couch || (database === null)) ? '' : `<wbr><span class="db-nw">/${esc(database.name)}</span>`;
            function url(host) {
                return `<span class="db-nw">${esc(scheme)}://${esc(user)}:${'•'.repeat(8)}@</span><wbr><span class="db-nw">${host}</span>${tail}`;
            }
            const named = (database === null) ? [] : Object.entries(database.envs).filter(v => v[1] !== this.open_env).map(v => v[0]);
            const out = [];
            if (couch) {
                out.push({label: 'Its variables', html: `<code>${esc(this.open_env)}</code> and <code>${esc(secret_of(this.open_env))}</code> · the secret signs a user's name`, dim: false});
            }
            else {
                out.push({label: 'Its variable', html: `<code>${esc(this.open_env)}</code>${(named.length === 0) ? ' · an app may name another' : ` · ${esc(named.join(', '))} ${(named.length === 1) ? 'names its own' : 'name their own'}`}`, dim: false});
            }
            if (this.open_user === '') {
                out.push({label: 'Its user', html: (database === null) ? 'once a database is made in it' : 'none of its own: made outside serviceman', dim: true});
            }
            else {
                out.push({label: 'Its user', html: `<code>${esc(this.open_user)}</code>${couch ? ' · every database in it' : ((server.engine === 'mongodb') ? ' · on this database alone' : ' · owns it; no other user connects')}`, dim: false});
            }
            if (engine !== undefined) {
                out.push({label: 'From a container', html: `<code>${url(`serviceman-db-${esc(server.name)}:${engine.port}`)}</code>`, dim: false});
            }
            out.push({label: `From ${server.title} itself`, html: (server.port === null) ? 'its port, once it is up' : `<code>${url(`127.0.0.1:${server.port}`)}</code>`, dim: (server.port === null)});
            out.push({label: 'Its data', html: `<code>serviceman-db-${esc(server.name)}</code> volume, at <code>${DATA_PATHS[server.engine] || 'its data folder'}</code>`, dim: false});
            return out;
        },
        // What Remove does, in a line at the page's foot
        remove_said: function () {
            const server = this.open_server;
            const others = this.others.map(v => v.name);
            const apps = [...new Set(server.databases.flatMap(v => v.apps))];
            const with_it = (others.length === 0) ? '' : `, and ${others.join(', ')} with it`;
            const when = (server.online === false) ? `, once ${server.title} is back` : '';
            const where = (server.online === false) ? 'its container stops' : `its container on ${server.title} stops`;
            const data = (others.length === 0) ? 'its data goes' : 'their data goes';
            if (this.server_only) {
                return `Removes its container and its volume on ${server.title}.`;
            }
            if (server.engine === 'couchdb') {
                const users = apps.concat((server.stores || []).filter(v => apps.includes(v) === false));
                const store = (users.length === 0) ? '' : `; ${users.join(' and ')} ${(users.length === 1) ? 'finds' : 'find'} no store at ${(users.length === 1) ? 'its' : 'their'} next start`;
                return `Removes its server, ${server.name}${when}: every user's database goes with it${store}.`;
            }
            const left = (apps.length === 0) ? '' : `; ${apps.join(' and ')} ${(apps.length === 1) ? 'finds' : 'find'} no database at ${(apps.length === 1) ? 'its' : 'their'} next start`;
            return `Removes its server, ${server.name}${with_it}${when}: ${where} and ${data}${left}.`;
        },
        // What goes, a row each, in Remove's window
        remove_rows: function () {
            const server = this.open_server;
            const apps = [...new Set(server.databases.flatMap(v => v.apps))];
            const size = (this.open_database === null) ? '' : `, ${database_rows.size(this.open_database.bytes)}`;
            const out = [
                {label: 'Its container', code: `serviceman-db-${server.name}`, text: ' stops and goes'},
                {label: 'Its data', code: `serviceman-db-${server.name}`, text: ` volume${size}, goes for good`},
            ];
            if (this.others.length > 0) {
                out.push({label: 'Beside it', code: '', text: this.others.map(v => v.name).join(', ')});
            }
            out.push({label: 'Apps given it', code: '', text: (apps.length === 0) ? 'none' : `${apps.join(', ')}: no database at the next start`});
            return out;
        },
        // Give it to an app's list: every app, those that reach it to tick (its machine, or a
        // program on a machine its port is brought to, as the Data tab offers them), then those
        // that have it already, ticked and fixed, then the others saying why not; ticked, those
        // that have it and those picked in the window
        give_cards: function () {
            const server = this.open_server;
            const database = this.open_database;
            const services = (this.state === null) ? [] : this.state.services;
            const forwards = server.forwards.filter(v => v.to.host === null);
            const has = (database === null) ? {} : database.envs;
            const env = this.open_env;
            const picked = (this.giving === null) ? [] : this.giving.picked;
            return services.map(function (service) {
                const kind = service_kind(service);
                const machine = ((service.remotes === undefined) || (service.remotes.length === 0)) ? '' : service.remotes[0];
                const line = `${kind.word} · ${machine || 'serviceman'}`;
                const out = {name: service.name, line, env: (has[service.name] === undefined) ? env : has[service.name], has: (has[service.name] !== undefined), ticked: false, disabled: false, why: ''};
                if (out.has) {
                    Object.assign(out, {ticked: true, disabled: true, why: 'has it already'});
                    return out;
                }
                const forward = forwards.find(v => (v.to.remote === machine) && (v.to.port !== null));
                let why = '';
                if (service.type === 'files') {
                    why = 'a page: nothing serviceman starts';
                }
                else if (service.runs_in === null) {
                    why = 'already running elsewhere: nothing serviceman starts';
                }
                else if ((machine !== server.remote) && (forward === undefined)) {
                    why = `on ${machine}: its port is not brought there; + a machine under Reached from brings it`;
                }
                else if ((machine !== server.remote) && (service.runs_in === 'container')) {
                    why = `on ${machine}, in a container: a forward there is out of its reach`;
                }
                else if ((machine !== server.remote) && forward.off) {
                    why = `on ${machine}: its forward there is set aside`;
                }
                Object.assign(out, {ticked: (why === '') && picked.includes(service.name), disabled: (why !== ''), why});
                return out;
            }).sort((a, b) => give_rank(a) - give_rank(b));
        },
        give_said: function () {
            const picked = this.giving.picked;
            if (picked.length === 0) {
                return 'Tick the apps to give it to';
            }
            return `${picked.join(', ')} ${(picked.length === 1) ? 'has' : 'have'} it from ${(picked.length === 1) ? 'its' : 'their'} next start`;
        },
        give_button: function () {
            const picked = this.giving.picked;
            if (picked.length === 0) {
                return 'Give it';
            }
            return (picked.length === 1) ? `Give it to ${picked[0]}` : `Give it to ${picked.length} apps`;
        },
        // Its port brought to other machines, and its public port, apart
        machine_forwards: function () {
            return this.open_server.forwards.filter(v => v.to.host === null);
        },
        public_port: function () {
            return this.open_server.forwards.find(v => v.to.host !== null) || null;
        },
        public_add_title: function () {
            if (this.open_server.phase !== 'up') {
                return 'Once it is up';
            }
            return `Its port on ${this.open_server.title}'s public address, for a client anywhere: TLS, its databases' own users alone`;
        },
        public_address_text: function () {
            const address = (this.public_port === null) ? null : this.public_port.address;
            return address || `${this.open_server.title}'s public address`;
        },
        // Why Copy URL cannot give the URL through its public port, or ''
        public_copy_why: function () {
            const why = this.copy_why(this.open_server.remote, this.public_port);
            if (why !== '') {
                return why;
            }
            return (this.public_port.address === null) ? `${this.open_server.title} has no public address serviceman knows` : '';
        },
        public_copy_title: function () {
            if (this.public_copy_why !== '') {
                return this.public_copy_why;
            }
            const tls = this.public_port.tls ? `?tls=true&tlsCAFile=${this.open_server.name}-ca.pem` : '';
            return `mongodb://${this.open_database.user}:${'•'.repeat(8)}@${this.public_port.address}:${this.public_port.to.port}/${this.open_database.name}${tls}, its password in it, for a client anywhere${this.public_port.tls ? ', with the certificate beside it' : ''}`;
        },
        // Where it is reached at on its machine, the port it shows up at on others by default
        engine_port: function () {
            const engine = this.view.engines.find(v => v.value === this.open_server.engine);
            return (engine === undefined) ? '' : engine.port;
        },
    },
    watch: {
        place: function () {
            this.removing = null;
            this.adding = null;
            this.opening = null;
            this.forward_note = '';
            this.copied = '';
            this.note = '';
        },
    },
    mounted: function () {
        this.read();
        this.timer = setInterval(this.read, REFRESH_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
    methods: {
        read: async function () {
            try {
                const answer = await fetch('/api/v1/databases', {cache: 'no-store'});
                if (answer.ok === false) {
                    throw new Error(`the databases could not be read: ${answer.status}`);
                }
                this.view = await answer.json();
                this.load_error = '';
            }
            catch (error) {
                this.load_error = error.message;
            }
        },
        row_open: function (row) {
            this.$emit('place', {page: 'database', server: row.server, database: row.database});
        },
        // Made: its page, and what was made said on it
        made: async function (made) {
            await this.read();
            this.$emit('changed');
            this.$emit('place', {page: 'database', server: made.server, database: made.database});
            await this.$nextTick();
            this.note = `${made.database} is made in ${made.server}${(made.given.length === 0) ? '' : `, given to ${made.given.join(', ')} from its next start`}.`;
            this.bad = false;
        },
        // A server that failed, brought up again where it was: its volume keeps the data it
        // had, and serviceman the password that data was made with
        again: async function (server) {
            this.busy = true;
            this.note = '';
            try {
                const answer = await fetch('/api/v1/databases', {method: 'POST', body: JSON.stringify({name: server.name, engine: server.engine, version: server.version, remote: server.remote, sample: server.sample})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                await this.read();
            }
            catch (error) {
                this.note = error.message;
                this.bad = true;
            }
            finally {
                this.busy = false;
            }
        },
        remove_begin: function (server) {
            this.removing = {server: server.name, typed: '', error: ''};
            this.$nextTick(() => this.$refs.remove_name.focus());
        },
        // New database, its engine, version and machine those of this server
        new_in_it: function () {
            const server = this.open_server;
            this.$emit('place', {page: 'new', restore: {model: {engine: server.engine, version: server.version, remote: server.remote}, step: 0, mode: 'steps'}});
        },
        give_open: function () {
            this.giving = {picked: [], busy: false, error: ''};
        },
        give_close: function () {
            if ((this.giving !== null) && (this.giving.busy === false)) {
                this.giving = null;
            }
        },
        // An app's box ticked or unticked in Give it to an app: picked, or picked no more
        give_tick: function (name) {
            const picked = this.giving.picked;
            this.giving.picked = picked.includes(name) ? picked.filter(v => v !== name) : picked.concat([name]);
        },
        // Each app ticked given it, one after the other, as its Data tab gives one; the page
        // read again after, and what was done said on it
        give_save: async function () {
            const giving = this.giving;
            if ((giving === null) || giving.busy || (giving.picked.length === 0)) {
                return;
            }
            giving.busy = true;
            giving.error = '';
            const done = [];
            try {
                for (const app of giving.picked) {
                    const env = await app_database_give(app, this.open_server.name, this.open_database.name, this.open_env);
                    done.push(`${app} finds it in ${env}`);
                }
                this.giving = null;
                await this.read();
                this.$emit('changed');
                this.note = `${done.join('; ')}, from ${(done.length === 1) ? 'its' : 'their'} next start.`;
                this.bad = false;
            }
            catch (error) {
                giving.error = (done.length === 0) ? error.message : `${done.join('; ')}; then: ${error.message}`;
                giving.busy = false;
            }
        },
        size_text: function (bytes) {
            return database_rows.size(bytes);
        },
        remove_save: async function () {
            if ((this.removing.typed !== this.removing.server) || this.busy) {
                return;
            }
            const name = this.removing.server;
            this.busy = true;
            this.note = '';
            try {
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(name)}`, {method: 'DELETE'});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.removing = null;
                await this.read();
                this.$emit('changed');
                this.$emit('place', null);
                await this.$nextTick();
                this.note = `${name} is removed.`;
                this.bad = false;
            }
            catch (error) {
                if (this.removing !== null) {
                    this.removing.error = error.message;
                }
                else {
                    this.note = error.message;
                    this.bad = true;
                }
            }
            finally {
                this.busy = false;
            }
        },
        forward_add: function () {
            const first = this.forward_machines.find(v => this.open_server.forwards.some(vv => vv.to.remote === v.remote) === false);
            this.adding = {remote: (first === undefined) ? '' : first.remote, port: ''};
            this.forward_note = '';
            this.$nextTick(() => this.$refs.adding_remote.focus());
        },
        forward_cancel: function () {
            this.adding = null;
            this.forward_note = '';
        },
        // The forwards it has, and one more where it was picked, the port its engine listens on
        // when none is typed
        forward_save: async function () {
            if ((this.adding === null) || (this.adding.remote === '') || this.busy) {
                return;
            }
            const port = (this.adding.port === '') ? String(this.engine_port) : this.adding.port;
            if ((/^\d{1,5}$/.test(port) === false) || (Number(port) < 1) || (Number(port) > 65535)) {
                this.forward_note = 'A port is a number from 1 to 65535';
                return;
            }
            const ends = this.open_server.forwards.map(item_of).concat([{to: {remote: this.adding.remote, port: Number(port)}}]);
            if (await this.forwards_write(ends)) {
                this.adding = null;
            }
        },
        public_open: function () {
            this.opening = {port: '', tls: true, allow: ''};
            this.forward_note = '';
            this.$nextTick(() => this.$refs.opening_port.focus());
        },
        public_change: function () {
            this.opening = {port: String(this.public_port.to.port), tls: this.public_port.tls, allow: this.public_port.allow.join(', ')};
            this.forward_note = '';
            this.$nextTick(() => this.$refs.opening_port.focus());
        },
        public_cancel: function () {
            this.opening = null;
            this.forward_note = '';
        },
        // Its forwards to other machines as they are, and its public port as typed: the port its
        // engine listens on when none is, everyone let in when no address is
        public_save: async function () {
            if ((this.opening === null) || this.busy) {
                return;
            }
            const port = (this.opening.port === '') ? String(this.engine_port) : this.opening.port;
            if ((/^\d{1,5}$/.test(port) === false) || (Number(port) < 1) || (Number(port) > 65535)) {
                this.forward_note = 'A port is a number from 1 to 65535';
                return;
            }
            const allow = this.opening.allow.split(/[\s,]+/).filter(v => v !== '');
            const ends = this.machine_forwards.map(item_of).concat([{to: {remote: this.open_server.remote, port: Number(port), host: '0.0.0.0'}, tls: this.opening.tls, allow}]);
            if (await this.forwards_write(ends)) {
                this.opening = null;
            }
        },
        // Why Copy URL cannot give the URL a program on that machine reaches it at, or ''
        copy_why: function (remote, forward) {
            if (this.open_server.phase !== 'up') {
                return 'Once it is up';
            }
            if (this.open_database === null) {
                return 'No database in it yet';
            }
            if (this.open_database.user === null) {
                return 'Made outside serviceman: serviceman has no user of its own for it';
            }
            if ((forward !== null) && forward.off) {
                return 'Its forward is set aside: turn it on in Forwards';
            }
            return '';
        },
        // What Copy URL puts on the clipboard, its password shown as dots: serviceman says it
        // when it is clicked, and the page keeps it nowhere
        copy_title: function (remote, port, forward) {
            const why = this.copy_why(remote, forward);
            if (why !== '') {
                return why;
            }
            const engine = this.view.engines.find(v => v.value === this.open_server.engine);
            const scheme = (engine === undefined) ? this.open_server.engine : engine.scheme;
            const user = this.open_database.user;
            const tail = (this.open_server.engine === 'couchdb') ? '' : `/${this.open_database.name}`;
            return `${scheme}://${user}:${'•'.repeat(8)}@127.0.0.1:${port}${tail}, its password in it, for a program on ${this.machine_title(remote)}`;
        },
        // remote null: through its public port
        url_copy: async function (remote) {
            this.forward_note = '';
            try {
                const query = new URLSearchParams((remote === null) ? {database: this.open_database.name, public: '1'} : {database: this.open_database.name, remote});
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(this.open_server.name)}/url?${query}`, {cache: 'no-store'});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                if (await to_clipboard(said.url) === false) {
                    throw new Error('The browser did not take it on the clipboard');
                }
                this.copied = (remote === null) ? PUBLIC : remote;
            }
            catch (error) {
                this.forward_note = error.message;
            }
        },
        // A forward's state as its line's pill says it: its tone, its word or two, and what
        // stands in its way in full where the word does not say it all, or null
        forward_pill: function (forward) {
            const said = forward_now_said(forward, this.remotes_named);
            return {tone: {running: 'run', starting: 'busy', failed: 'bad'}[said.dot] || 'idle', text: said.word, problem: said.problem};
        },
        drop_title: function (item) {
            const where = this.machine_title(item.to.remote);
            if (item.apps.length === 0) {
                return `Bring it to ${where} no more`;
            }
            return `Bring it to ${where} no more: ${item.apps.join(', ')} ${(item.apps.length === 1) ? 'finds' : 'find'} it here, and the next start stops without it`;
        },
        forward_drop: async function (item) {
            await this.forwards_write(this.open_server.forwards.filter(v => v !== item).map(item_of));
        },
        // Where its port shows up, the whole list, each {to, tls, allow}: what serviceman answers
        // is the page now
        forwards_write: async function (ends) {
            this.busy = true;
            this.forward_note = '';
            try {
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(this.open_server.name)}/forwards`, {method: 'PUT', body: JSON.stringify({forwards: ends})});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.view = said;
                return true;
            }
            catch (error) {
                this.forward_note = error.message;
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        machine_title: function (name) {
            const found = this.view.machines.find(v => v.remote === name);
            return (found === undefined) ? (name || 'this host') : found.title;
        },
        // A forward's end as its line shows it: a port on that machine's loopback, or a socket
        end_text: function (to) {
            return (to.socket === null) ? `127.0.0.1:${to.port}` : to.socket;
        },
        colour_of: function (server) {
            return database_rows.ENGINE_COLOURS[server.engine] || 'currentColor';
        },
        engine_text: function (server) {
            return database_rows.engine_text(server, this.view.engines);
        },
        state_of: function (server) {
            return database_state(server);
        },
    },
};

// The variable a CouchDB's secret comes in, beside its URL's (database_env.js says it the same)
function secret_of(env)
{
    return (/_URL(_\d+)?$/.test(env)) ? env.replace(/_URL(_\d+)?$/, '_SECRET$1') : `${env}_SECRET`;
}

// Where an app stands in Give it to an app's list: those to tick first, then those that have it
// already, then those that cannot be given it
function give_rank(card)
{
    if (card.has) {
        return 1;
    }
    return card.disabled ? 2 : 0;
}

// Text as HTML: what a database's page writes with v-html, a name from a row, never trusted as markup
function esc(text)
{
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A forward as the page writes it back, {to, tls, allow}, from the one the answer shows: its end
// as the config writes it, and a public port's TLS and who it lets in
function item_of(forward)
{
    const to = forward.to;
    const place = to.here ? {here: true} : {remote: to.remote};
    const end = Object.assign(place, (to.socket === null) ? {port: to.port} : {socket: to.socket}, (to.host === null) ? {} : {host: to.host});
    return (to.host === null) ? {to: end} : {to: end, tls: forward.tls, allow: forward.allow};
}

export default databases_pane;
