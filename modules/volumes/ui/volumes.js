import data_table from '../../data_table.js';

// The encrypted volumes of several machines in one list: each one's file, the folder it opens
// at, open or closed, and how full. Close and Grow from its row, Open with a passphrase, Delete
// on a closed one with Undo for a few seconds before the machine is asked; New volume makes one
// with a passphrase a person types, kept nowhere. Visual Agents makes and opens its own with keys
// it holds. A change shows at once, marked while the machine makes it. The
// host page gives the API of each machine, the colours and its usual classes: card, form, grid,
// list-head, list-acts, dot, muted, bad, alert, primary, link; its one table, data-table, is
// imported from the page beside it.
const PASSPHRASE_MIN = 16;
const UNDO_SECONDS = 10;
// The columns of the list, the first to fold the lowest; the actions fold before them all
const COLUMNS = [
    {key: 'name', label: 'Volume', wraps: true},
    {key: 'on', label: 'On', fold: 2},
    {key: 'folder', label: 'Folder', fold: 1},
    {key: 'state', label: 'State'},
    {key: 'used', label: 'Used', fold: 3, hide: v => (v.size === null)},
];
const STATES = {
    open: {text: 'Open', note: ''},
    closed: {text: 'Closed', note: 'waits for its key'},
    making: {text: 'Making', note: 'formatting it, then opening'},
    missing: {text: 'Missing', note: 'its file is gone'},
};

const volumes = {
    template: `
<section class="vol">
    <div class="list-head">
        <h2>Encrypted volumes</h2>
        <span class="muted">{{ items.length }}</span>
        <div class="list-acts">
            <button type="button" :disabled="reading" @click="read">Read again</button>
            <button type="button" class="primary" :disabled="(new_model !== null)" @click="new_show">New volume…</button>
        </div>
    </div>
    <p class="muted">LUKS in a file on one machine's disk, opened at a folder of that machine. A stolen disk shows one file of random bytes. Visual Agents makes and opens its own with keys it holds; one made here opens with the passphrase you give it.</p>
    <form v-if="(new_model !== null)" class="form card vol-new" @submit.prevent="new_make">
        <div class="grid">
            <label for="vol-new-machine">Machine</label>
            <div>
                <select id="vol-new-machine" v-model="new_model.machine" :disabled="(machine_options.length === 0)">
                    <option v-for="option of machine_options" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <p v-if="(machine_options.length === 0)" class="muted">No machine can have volumes now; the lines under the list say why.</p>
            </div>
            <label for="vol-new-name">Name</label>
            <div>
                <input id="vol-new-name" v-model.trim="new_model.name" placeholder="notes" pattern="[a-z0-9]([a-z0-9]|-){0,39}" maxlength="40" spellcheck="false" autocomplete="off" required>
                <p class="muted">Small letters, digits and <code>-</code>; the file is <code>/var/lib/serviceman/volumes/&lt;name&gt;.img</code>.</p>
            </div>
            <label for="vol-new-target">Folder</label>
            <div>
                <input id="vol-new-target" v-model.trim="new_model.target" :placeholder="new_target_of('notes')" spellcheck="false" autocomplete="off" required @input="new_model.target_typed = true">
                <p class="muted">In {{ new_owner }}'s home, where it opens. Files already there are copied in, and the plain folder is kept beside it for you to delete.</p>
            </div>
            <label for="vol-new-size">Size</label>
            <div>
                <input id="vol-new-size" v-model.trim="new_model.size" class="short" placeholder="10G" spellcheck="false" autocomplete="off" required>
                <p class="muted">At least 64M; it takes on the disk only what is written, and grows later.</p>
            </div>
            <label for="vol-new-passphrase">Passphrase</label>
            <div>
                <input id="vol-new-passphrase" v-model="new_model.passphrase" type="password" autocomplete="new-password" :minlength="passphrase_min" required>
                <input id="vol-new-again" v-model="new_model.again" type="password" autocomplete="new-password" placeholder="again" aria-label="The passphrase again" required class="vol-again">
                <p class="muted">At least {{ passphrase_min }} characters. It is kept nowhere: you type it at every Open, after every restart of the machine. Lost, the volume cannot be opened by anyone.</p>
                <p v-if="((new_model.again !== '') && (new_model.again !== new_model.passphrase))" class="bad">The two differ.</p>
            </div>
        </div>
        <p v-if="(key_safe_here === false)" class="alert">A passphrase travels only over https or from a page on this machine; open this page over https to make one.</p>
        <p v-if="(new_said !== null)" class="bad vol-new-said">{{ new_said }}</p>
        <div class="vol-new-acts">
            <button type="submit" class="primary" :disabled="(new_ready === false)">Make the volume</button>
            <button type="button" class="link" @click="new_cancel">Cancel</button>
        </div>
    </form>
    <div v-for="entry of deleting" :key="entry.item.key" class="card vol-undo">
        <span v-if="(entry.phase === 'note')" class="vol-undo-text">{{ entry.text }}</span>
        <span v-else class="vol-undo-text">
            Deleting <code :title="entry.item.name">{{ entry.item.name }}</code> on {{ entry.item.machine_title }}{{ ((entry.phase === 'waiting') ? ' in ' + entry.left + ' s' : '…') }}
        </span>
        <button v-if="(entry.phase === 'waiting')" type="button" @click="delete_undo(entry)">Undo</button>
        <button v-if="(entry.phase === 'note')" type="button" class="link" aria-label="Close" @click="delete_forget(entry)">×</button>
    </div>
    <data-table class="vol-table" :columns="COLUMNS" :rows="items" row_key="key" :row_state="row_state" :empty="(reading ? 'Asking the machines…' : 'No encrypted volumes yet. Visual Agents makes one on a machine the first time it needs it there.')" actions_label="Change">
        <template #cell="{row, column}">
            <code v-if="((column.key === 'name') || (column.key === 'folder'))">{{ ((column.key === 'name') ? row.name : row.target) }}</code>
            <template v-else-if="(column.key === 'on')">{{ row.machine_title }}</template>
            <template v-else-if="(column.key === 'state')">
                <span class="vol-state">
                    <span class="dot" :class="{running: (row.state === 'open'), failed: (row.state === 'missing')}"/>
                    {{ state_of(row).text }}
                </span>
                <small v-if="(state_of(row).note !== '')" class="muted vol-line">{{ state_of(row).note }}</small>
            </template>
            <span v-else class="vol-numbers">
                {{ used_text(row) }}
                <small v-if="(row.on_disk !== null)" class="muted vol-line">{{ bytes_text(row.on_disk) }} on disk</small>
            </span>
        </template>
        <template #actions="{row}">
            <span v-if="(pending[row.key] !== undefined)" class="muted">{{ pending[row.key] }}</span>
            <template v-else-if="(row.state === 'open')">
                <button type="button" :disabled="row.offline" @click="grow_show(row)">Grow…</button>
                <button type="button" :disabled="row.offline" @click="close(row)">Close</button>
            </template>
            <template v-else-if="((row.state === 'closed') || (row.state === 'missing'))">
                <button v-if="((row.state === 'closed') && (row.passphrase === true))" type="button" :disabled="row.offline" @click="open_show(row)">Open…</button>
                <button type="button" class="danger" :disabled="row.offline" @click="delete_start(row)">Delete</button>
            </template>
        </template>
        <!-- Under a volume: the form that grows or opens it, and what the machine said -->
        <template #below="{row}">
            <form v-if="(grow_key === row.key)" class="vol-grow" @submit.prevent="grow(row)">
                <span class="muted">Now {{ bytes_text(row.size) }}. New size:</span>
                <input v-model.trim="grow_size" placeholder="40G" aria-label="New size" required>
                <button type="submit" class="primary" :disabled="(grow_size === '')">Grow</button>
                <button type="button" class="link" @click="grow_key = null">Cancel</button>
            </form>
            <form v-if="(open_key === row.key)" class="vol-grow" @submit.prevent="open_volume(row)">
                <span class="muted">Passphrase of {{ row.name }}:</span>
                <input v-model="open_passphrase" class="vol-pass" type="password" autocomplete="current-password" aria-label="Passphrase" required>
                <button type="submit" class="primary" :disabled="((open_passphrase === '') || (key_safe_here === false))">Open</button>
                <button type="button" class="link" @click="open_key = null">Cancel</button>
                <span v-if="(key_safe_here === false)" class="bad">Only over https or from a page on this machine.</span>
            </form>
            <template v-if="(said[row.key] !== undefined)">
                <div class="vol-said">
                    <span v-if="(said[row.key].note !== undefined)" class="muted">{{ said[row.key].note }}</span>
                    <span v-else class="bad">{{ said[row.key].error }}</span>
                    <button type="button" class="link" aria-label="Close" @click="said_clear(row)">×</button>
                </div>
                <ul v-if="(said[row.key].users !== undefined)" class="vol-users">
                    <li v-for="user of said[row.key].users" :key="user.pid">
                        <code>{{ user.command }}</code>
                        <span class="muted">{{ ((user.terminal === null) || (user.terminal === undefined)) ? '' : 'terminal ' + user.terminal + ' · ' }}pid {{ user.pid }} · {{ user.user }} · {{ user.how }}</span>
                    </li>
                </ul>
            </template>
        </template>
    </data-table>
    <ul v-if="(notes.length > 0)" class="vol-notes">
        <li v-for="note of notes" :key="note.machine">
            <b>{{ note.title }}</b>
            <span :class="(note.bad ? 'bad' : 'muted')">{{ note.text }}</span>
        </li>
    </ul>
</section>
`,
    components: {'data-table': data_table},
    props: {
        // [{name, title, base, offline, user}]: each machine, the base of its volumes API and
        // the user its agent runs as, who owns a volume made here
        machines: {type: Array, required: true},
    },
    data: function () {
        return {
            COLUMNS,
            items: [],
            notes: [],
            reading: false,
            // A row while the machine works on it: key → what is being done
            pending: {},
            // A row's refusal: key → {error, users}
            said: {},
            // Rows deleted, their row gone: {item, above, left, phase: waiting|sending|note, text}
            deleting: [],
            grow_key: null,
            grow_size: '',
            open_key: null,
            open_passphrase: '',
            // The New volume form while it is shown: {machine, name, target, target_typed, size, passphrase, again}
            new_model: null,
            new_said: null,
            passphrase_min: PASSPHRASE_MIN,
        };
    },
    computed: {
        // The machines that answered for their volumes: one offline, with no root agent or
        // without cryptsetup has a line under the list instead
        machine_options: function () {
            const away = this.notes.map(v => v.machine);
            return this.machines.filter(v => ((v.offline === false) && (away.includes(v.name) === false))).map(v => ({value: v.name, label: (v.title || v.name)}));
        },
        new_machine: function () {
            const name = ((this.new_model === null) ? null : this.new_model.machine);
            return (this.machines.find(v => v.name === name) || null);
        },
        new_owner: function () {
            return (((this.new_machine === null) || (this.new_machine.user === undefined)) ? 'its user' : this.new_machine.user);
        },
        new_ready: function () {
            const model = this.new_model;
            if ((model === null) || (this.new_machine === null) || (this.key_safe_here === false)) {
                return false;
            }
            return ((model.name !== '') && (model.target !== '') && (model.size !== '') && (model.passphrase.length >= PASSPHRASE_MIN) && (model.again === model.passphrase));
        },
        // A key leaves this page only over https or to this machine's loopback, as the server
        // takes it
        key_safe_here: function () {
            const host = location.hostname;
            return ((location.protocol === 'https:') || (host === 'localhost') || host.endsWith('.localhost') || (host === '127.0.0.1') || (host === '[::1]'));
        },
    },
    watch: {
        // The folder follows the name and the machine until it is typed in
        'new_model.name': function () {
            this.new_target_follow();
        },
        'new_model.machine': function () {
            this.new_target_follow();
        },
        machines: function (now, before) {
            function names(list) {
                return list.map(v => `${v.name}:${v.offline}`).join(' ');
            }
            if (names(now) !== names(before)) {
                this.read();
            }
        },
    },
    methods: {
        read: async function () {
            this.reading = true;
            const answers = await Promise.all(this.machines.map(v => this.machine_read(v)));
            this.items = answers.flatMap(v => v.items);
            this.notes = answers.filter(v => v.note !== null).map(v => v.note);
            this.reading = false;
        },
        machine_read: async function (machine) {
            const title = (machine.title || machine.name);
            if (machine.offline) {
                return {items: [], note: {machine: machine.name, title, text: 'not connected; its volumes show once it is', bad: false}};
            }
            try {
                const answer = await fetch(machine.base, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    return {items: [], note: {machine: machine.name, title, text: body.error, bad: (answer.status !== 501)}};
                }
                return {items: body.items.map(v => this.item_of(machine, v)), note: null};
            }
            catch (error) {
                return {items: [], note: {machine: machine.name, title, text: error.message, bad: true}};
            }
        },
        item_of: function (machine, volume) {
            return Object.assign({}, volume, {key: `${machine.name}/${volume.name}`, machine: machine.name, machine_title: (machine.title || machine.name), base: machine.base, offline: machine.offline});
        },
        close: async function (item) {
            await this.ask(item, 'close', {}, 'closing…');
        },
        grow_show: function (item) {
            this.grow_key = item.key;
            this.grow_size = '';
        },
        grow: async function (item) {
            const size = this.grow_size;
            this.grow_key = null;
            await this.ask(item, 'grow', {size}, `growing to ${size}…`);
        },
        open_show: function (item) {
            this.open_key = item.key;
            this.open_passphrase = '';
        },
        open_volume: async function (item) {
            const key = this.open_passphrase;
            this.open_key = null;
            this.open_passphrase = '';
            await this.ask(item, 'open', {key}, 'opening…');
        },
        new_show: function () {
            const first = this.machine_options[0];
            this.new_model = {machine: ((first === undefined) ? null : first.value), name: '', target: '', target_typed: false, size: '10G', passphrase: '', again: ''};
            this.new_said = null;
        },
        new_cancel: function () {
            this.new_model = null;
            this.new_said = null;
        },
        new_target_follow: function () {
            if ((this.new_model !== null) && (this.new_model.target_typed === false)) {
                this.new_model.target = ((this.new_model.name === '') ? '' : this.new_target_of(this.new_model.name));
            }
        },
        new_target_of: function (name) {
            const user = (((this.new_machine === null) || (this.new_machine.user === undefined)) ? 'you' : this.new_machine.user);
            return ((user === 'root') ? `/root/${name}` : `/home/${user}/${name}`);
        },
        // The row shows at once, marked while the machine makes it; a refusal brings the form
        // back as it was, with what the machine said
        new_make: async function () {
            const model = this.new_model;
            const machine = this.new_machine;
            // A key of its own: a name taken already must not clash with the row it would replace
            const item = Object.assign(this.item_of(machine, {name: model.name, owner: machine.user, target: model.target, state: 'making', size: null, on_disk: null, used: null, free: null}), {key: `${machine.name}/${model.name} new`});
            this.new_model = null;
            this.new_said = null;
            this.items.unshift(item);
            this.pending[item.key] = 'making…';
            try {
                const answer = await fetch(machine.base, {method: 'POST', cache: 'no-store', body: JSON.stringify({name: model.name, owner: machine.user, target: model.target, size: model.size, key: model.passphrase, passphrase: true})});
                const reply = await answer.json();
                if (answer.ok === false) {
                    throw new Error(reply.error);
                }
                const made = this.item_of(machine, reply);
                this.items.splice(this.items.findIndex(v => v.key === item.key), 1, made);
                if ((reply.plain_left !== null) && (reply.plain_left !== undefined)) {
                    this.said[made.key] = {note: `The plain files are copied in; the plain folder is kept as ${reply.plain_left} for you to delete.`};
                }
            }
            catch (error) {
                this.items = this.items.filter(v => v.key !== item.key);
                this.new_model = model;
                this.new_said = error.message;
            }
            finally {
                delete this.pending[item.key];
            }
        },
        // The row goes at once; the machine is asked once the Undo has had its seconds
        delete_start: function (item) {
            const at = this.items.findIndex(v => v.key === item.key);
            // The rows above it, nearest last: it comes back under the nearest one still there
            const above = this.items.slice(0, at).map(v => v.key);
            this.items.splice(at, 1);
            delete this.said[item.key];
            this.deleting.push({item, above, left: UNDO_SECONDS, phase: 'waiting', text: ''});
            if (this.delete_timer === null) {
                this.delete_timer = setInterval(this.delete_tick, 1000);
            }
        },
        delete_tick: function () {
            for (const entry of this.deleting.filter(v => v.phase === 'waiting')) {
                entry.left -= 1;
                if (entry.left <= 0) {
                    this.delete_send(entry, false);
                }
            }
            if (this.deleting.some(v => v.phase === 'waiting') === false) {
                clearInterval(this.delete_timer);
                this.delete_timer = null;
            }
        },
        delete_undo: function (entry) {
            this.deleting = this.deleting.filter(v => v !== entry);
            const keys = this.items.map(v => v.key);
            const nearest = entry.above.findLast(v => keys.includes(v));
            this.items.splice(((nearest === undefined) ? 0 : (keys.indexOf(nearest) + 1)), 0, entry.item);
        },
        delete_forget: function (entry) {
            this.deleting = this.deleting.filter(v => v !== entry);
        },
        // A refusal brings the row back where it was, with what the machine said
        delete_send: async function (entry, keepalive) {
            const item = entry.item;
            entry.phase = 'sending';
            try {
                const answer = await fetch(`${item.base}/${encodeURIComponent(item.name)}/delete`, {method: 'POST', cache: 'no-store', keepalive, body: '{}'});
                const reply = await answer.json();
                if (answer.ok === false) {
                    throw Object.assign(new Error(reply.error), {reply});
                }
                if ((reply.target_left === null) || (reply.target_left === undefined)) {
                    this.delete_forget(entry);
                    return;
                }
                entry.text = `Deleted ${item.name} on ${item.machine_title}. Its folder ${reply.target_left} stays: files were written into it while it was closed.`;
                entry.phase = 'note';
            }
            catch (error) {
                this.delete_undo(entry);
                this.said[item.key] = ((error.reply === undefined) ? {error: error.message} : error.reply);
            }
        },
        // Leaving the page is taken as no Undo: what waits is sent now
        delete_flush: function () {
            for (const entry of this.deleting.filter(v => v.phase === 'waiting')) {
                this.delete_send(entry, true);
            }
        },
        said_clear: function (item) {
            delete this.said[item.key];
        },
        // One call for one row: its answer is the volume as it is now, put in the row's place
        ask: async function (item, action, body, doing) {
            this.pending[item.key] = doing;
            delete this.said[item.key];
            try {
                const answer = await fetch(`${item.base}/${encodeURIComponent(item.name)}/${action}`, {method: 'POST', cache: 'no-store', body: JSON.stringify(body)});
                const reply = await answer.json();
                if (answer.ok === false) {
                    this.said[item.key] = reply;
                    return;
                }
                const at = this.items.findIndex(v => v.key === item.key);
                if (at !== -1) {
                    this.items.splice(at, 1, Object.assign({}, item, reply));
                }
            }
            catch (error) {
                this.said[item.key] = {error: error.message};
            }
            finally {
                delete this.pending[item.key];
            }
        },
        // A volume's stripe: open, missing, or neither
        row_state: function (item) {
            return ((item.state === 'open') ? 'ok' : ((item.state === 'missing') ? 'bad' : 'none'));
        },
        state_of: function (item) {
            if ((item.state === 'closed') && (item.passphrase === true)) {
                return {text: 'Closed', note: 'waits for its passphrase'};
            }
            return (STATES[item.state] || {text: item.state, note: ''});
        },
        used_text: function (item) {
            if (item.size === null) {
                return '';
            }
            if (item.used === null) {
                return this.bytes_text(item.size);
            }
            return `${this.bytes_text(item.used)} of ${this.bytes_text(item.size)}`;
        },
        bytes_text: function (bytes) {
            for (const [unit, size] of [['TB', 1024**4], ['GB', 1024**3], ['MB', 1024**2], ['KB', 1024]]) {
                if (bytes >= size) {
                    return `${Math.round(bytes/size*10)/10} ${unit}`;
                }
            }
            return `${bytes} B`;
        },
    },
    created: function () {
        this.delete_timer = null;
        window.addEventListener('pagehide', this.delete_flush);
        this.read();
    },
    unmounted: function () {
        window.removeEventListener('pagehide', this.delete_flush);
        clearInterval(this.delete_timer);
        this.delete_flush();
    },
};

export default volumes;
