import format_bytes from '../../format_bytes.js';

// What takes the space on one disk of a machine: its biggest folders, each with a bar of its
// share of what the disk uses, and a click on one opens the folders inside it. Counting reads
// every folder, a minute on a big disk, so a disk is counted when asked and each folder once;
// while it is counted, the folders done so far show at once, already to be opened, with a
// clock and the folders still to come. What the agent could not read is in the tree too: a
// folder it could not read says so, docker's and the journal's own folders take the size they
// say they keep, and what is still in no folder is a row of its own. The space has to add up
// to what the disk uses, or the tree does not say where it went.
//
//     disk  {mounts, used, total}, the row of the disk list
const PROGRESS_EVERY_MS = 1000;
// What is in no folder is worth a row of its own above this much of the disk
const UNSEEN_SHARE = 0.01;
const UNSEEN_LEAST = 256*1024**2;

const disk_usage = {
    template: `
<section class="disk-usage">
    <div class="list-tools">
        <h2>What takes the space on <code>{{ root }}</code></h2>
        <span class="muted">{{ format_bytes(disk.used) }} used of {{ format_bytes(disk.total) }}</span>
        <div class="list-right">
            <button type="button" :disabled="counting" @click="count_again">{{ counting ? 'Counting…' : 'Count again' }}</button>
            <button type="button" @click="$emit('close')">Close</button>
        </div>
    </div>
    <p v-if="(top === undefined)" class="muted">Counting every folder on this disk…</p>
    <div v-else-if="(top.state === 'counting')" class="du-live">
        <p class="du-live-line">
            <span>Counting every folder on this disk, which can take a minute on a big one</span>
            <span class="du-clock">{{ clock_text(now - top.started) }}</span>
        </p>
        <template v-if="(top_progress !== null)">
            <span class="meter du-live-bar"><i :style="{width: (share_of(top_so_far)*100).toFixed(1) + '%'}"></i></span>
            <p class="muted du-live-line">{{ format_bytes(top_so_far) }} of {{ format_bytes(disk.used) }} found so far · {{ top_progress.folders.length }} {{ (top_progress.folders.length === 1) ? 'folder' : 'folders' }} counted, {{ top_progress.waiting }} to go</p>
        </template>
    </div>
    <p v-else-if="(top.state === 'failed')" class="bad">{{ top.error }}</p>
    <ul v-if="(top !== undefined && top.state === 'done')" class="du-notes">
        <li v-for="line of notes" :key="line.text" :class="line.tone">{{ line.text }}</li>
    </ul>
    <div v-if="(top !== undefined && top.state !== 'failed')" class="du-tree" role="tree">
        <button v-for="row of rows" :key="row.key" type="button" class="du-row" :class="{dim: ((row.folder === false) && (row.said === false)), unseen: row.unseen, waiting: row.waiting}" :style="{'--depth': row.depth}" :disabled="(row.folder === false)" role="treeitem" :aria-expanded="(row.folder ? row.open : undefined)" :title="row.path" @click="toggle(row)">
            <span class="du-name">
                <span class="du-fold" aria-hidden="true">{{ row.folder ? (row.open ? '▾' : '▸') : '' }}</span>
                <code v-if="row.code">{{ row.name }}</code>
                <span v-else>{{ row.name }}</span>
                <span v-if="(row.note !== '')" class="muted">{{ row.note }}</span>
            </span>
            <span class="du-bar meter" :class="{filling: row.waiting}"><i :style="{width: (row.share*100).toFixed(1) + '%'}"></i></span>
            <span class="du-size">{{ (row.size === null) ? '' : format_bytes(row.size) }}</span>
        </button>
    </div>
</section>
`,
    props: {
        base: {type: String, required: true},
        disk: {type: Object, required: true},
    },
    emits: ['close'],
    data: function () {
        // counted: by folder, {state: counting | done | failed, started, answer, error}
        // progress: by folder being counted, what the agent has counted of it so far
        // live: false once the machine's agent turns out to be from before progress
        return {counted: {}, open: {}, progress: {}, live: true, now: Date.now()};
    },
    computed: {
        root: function () {
            return this.disk.mounts[0];
        },
        top: function () {
            return this.counted[this.root];
        },
        top_progress: function () {
            return this.progress[this.root] || null;
        },
        top_so_far: function () {
            return (this.top_progress === null) ? 0 : this.top_progress.folders.reduce((sum, v) => sum + v.size, 0);
        },
        counting: function () {
            return Object.values(this.counted).some(v => v.state === 'counting');
        },
        // Every folder the agent could not read, in any count done so far
        unread: function () {
            const out = new Set();
            for (const here of Object.values(this.counted)) {
                for (const path of ((here.state === 'done') ? here.answer.unread : [])) {
                    out.add(path);
                }
            }
            return out;
        },
        // The folders whose size the count could not see but somebody else can say: docker's,
        // as docker counts it, and the journal's, as journald does. [{path, size, who}]
        known: function () {
            if ((this.top === undefined) || (this.top.state !== 'done') || (this.top.answer.rooted === true)) {
                return [];
            }
            const extras = this.top.answer.extras || {};
            const said = [];
            if ((typeof extras.docker_root === 'string') && Array.isArray(extras.docker)) {
                said.push({path: extras.docker_root, size: extras.docker.reduce((sum, v) => sum + v.size, 0), who: 'docker'});
            }
            if (extras.journal > 0) {
                said.push({path: '/var/log/journal', size: extras.journal, who: 'the journal'});
            }
            return said.filter(v => (v.size > 0) && this.inside(v.path, this.root) && this.unreadable(v.path));
        },
        // What the disk uses that no folder holds, as far as the count and what was said go
        unseen: function () {
            if ((this.top === undefined) || (this.top.state !== 'done')) {
                return 0;
            }
            const missing = this.disk.used - this.top.answer.total - this.known.reduce((sum, v) => sum + v.size, 0);
            return (missing > Math.max(UNSEEN_LEAST, this.disk.used*UNSEEN_SHARE)) ? missing : 0;
        },
        // A bar is a share of what the disk uses, so the bars of the tree add up to it
        scale: function () {
            const counted = ((this.top !== undefined) && (this.top.state === 'done')) ? this.top.answer.total : 0;
            return Math.max(1, this.disk.used, counted);
        },
        notes: function () {
            const answer = this.top.answer;
            const out = [];
            if ((answer.rooted !== true) && (answer.unread.length > 0)) {
                const parts = unread_grouped(answer.unread);
                const named = parts.slice(0, 4).join(', ');
                const more = (parts.length > 4) ? `, and ${parts.length - 4} more` : '';
                const what = (this.known.length > 0) ? `: in the tree with what ${this.known.map(v => v.who).join(' and ')} ${(this.known.length === 1) ? 'says it keeps' : 'say they keep'}, the rest under "In no folder counted"` : `: what they hold is under "In no folder counted"`;
                out.push({tone: 'bad', text: `The agent, as its own user, could not read ${answer.unread.length} ${(answer.unread.length === 1) ? 'folder' : 'folders'} (${named}${more})${what}. On a machine with the agent's root half, every folder is counted.`});
            }
            const extras = answer.extras || {};
            if (Array.isArray(extras.docker) && (extras.docker.length > 0)) {
                const where = (typeof extras.docker_root === 'string') ? `, in ${extras.docker_root}` : '';
                out.push({tone: '', text: `Docker says it keeps ${extras.docker.map(v => `${format_bytes(v.size)} in ${v.what}`).join(', ')}${where}.`});
            }
            if (extras.journal > 0) {
                out.push({tone: '', text: `The system journal takes ${format_bytes(extras.journal)}.`});
            }
            out.push({tone: 'muted', text: `Counted ${(answer.rooted === true) ? 'as root' : 'as the agent\'s user'} in ${(answer.took_ms/1000).toFixed(1)}s, this disk alone.`});
            return out;
        },
        // The tree as rows: a folder's own folders under it while it is open, biggest first,
        // the files lying in it as one row of their own; a folder being counted shows the
        // folders done so far and one row for the rest, with its clock
        rows: function () {
            const out = [];
            const self = this;
            function walk(path, depth) {
                const here = self.counted[path];
                if ((here === undefined) || (here.state === 'failed')) {
                    out.push(row_said(path, depth, (here === undefined) ? 'counting…' : here.error));
                    return;
                }
                const folders = (here.state === 'done') ? here.answer.folders : (self.progress[path] || {folders: []}).folders;
                const list = folders.map(v => self.row_of(v, depth));
                if ((here.state === 'done') && (here.answer.files > 0)) {
                    list.push(Object.assign(row_said(path, depth, 'files here'), {key: `${path}#files`, size: here.answer.files, share: here.answer.files/self.scale}));
                }
                if ((path === self.root) && (self.unseen > 0)) {
                    list.push(Object.assign(row_said(path, depth, 'In no folder counted'), {key: `${path}#unseen`, code: false, unseen: true, said: true, note: (here.answer.rooted === true) ? 'files deleted while a program still holds them open' : 'in folders the agent could not read, or files deleted while a program still holds them open', size: self.unseen, share: self.unseen/self.scale}));
                }
                list.sort((a, b) => b.size - a.size);
                for (const row of list) {
                    out.push(row);
                    if (row.open) {
                        walk(row.path, depth + 1);
                    }
                }
                if (here.state === 'counting') {
                    out.push(self.row_waiting(path, depth));
                }
            }
            walk(this.root, 0);
            return out;
        },
    },
    watch: {
        root: {
            immediate: true,
            handler: function () {
                this.counted = {};
                this.open = {};
                this.progress = {};
                this.count(this.root, (this.root === '/'));
            },
        },
    },
    unmounted: function () {
        this.ticking_stop();
    },
    methods: {
        format_bytes: function (bytes) {
            return format_bytes(bytes);
        },
        // "2m 05s", the short way a clock says it
        clock_text: function (ms) {
            const total = Math.max(0, Math.round(ms/1000));
            return (total < 60) ? `${total}s` : `${Math.floor(total/60)}m ${String(total % 60).padStart(2, '0')}s`;
        },
        share_of: function (bytes) {
            return Math.min(1, bytes/this.scale);
        },
        inside: function (path, folder) {
            return (path === folder) || path.startsWith((folder === '/') ? '/' : `${folder}/`);
        },
        unreadable: function (path) {
            return Array.from(this.unread).some(v => this.inside(path, v));
        },
        // One folder of a count: its size with what was said of the folders in it it could not
        // read, and a word on where that came from
        row_of: function (folder, depth) {
            const known = this.known.filter(v => this.inside(v.path, folder.path));
            const extra = known.reduce((sum, v) => sum + v.size, 0);
            const unread = this.unread.has(folder.path);
            let note = '';
            if (known.some(v => v.path === folder.path)) {
                note = `could not be read: ${known[0].who} says it keeps ${format_bytes(extra)} here`;
            }
            else if (extra > 0) {
                note = `with ${format_bytes(extra)} that ${known.map(v => v.who).join(' and ')} ${(known.length === 1) ? 'keeps' : 'keep'} in it`;
            }
            else if (unread) {
                note = 'could not be read';
            }
            const size = folder.size + extra;
            const open = (this.open[folder.path] === true);
            return {key: folder.path, path: folder.path, name: folder.path.split('/').pop(), code: true, note, depth, size, share: size/this.scale, folder: (unread === false), open, unseen: false, waiting: false, said: (extra > 0)};
        },
        // The row for what a count has yet to say: how long it has gone, and what comes next
        row_waiting: function (path, depth) {
            const progress = this.progress[path];
            const started = this.counted[path].started;
            let note = this.clock_text(this.now - started);
            if ((progress !== undefined) && (progress.waiting > 0)) {
                const names = progress.waiting_shown.slice(0, 5).map(v => v.split('/').pop()).join(', ');
                const more = (progress.waiting > 5) ? '…' : '';
                note = `${note} · ${progress.waiting} to go: ${names}${more}`;
            }
            return Object.assign(row_said(path, depth, 'counting…'), {key: `${path}#counting`, code: false, note, waiting: true});
        },
        toggle: function (row) {
            if (row.folder === false) {
                return;
            }
            this.open[row.path] = (row.open === false);
            if ((row.open === false) && (this.counted[row.path] === undefined)) {
                this.count(row.path, false);
            }
        },
        count_again: function () {
            this.counted = {};
            this.progress = {};
            this.count(this.root, (this.root === '/'));
            for (const path of Object.keys(this.open).filter(v => this.open[v])) {
                this.count(path, false);
            }
        },
        count: async function (path, extras) {
            this.counted[path] = {state: 'counting', started: Date.now(), answer: null, error: null};
            this.ticking_start();
            try {
                const answer = await fetch(`${this.base}/usage?path=${encodeURIComponent(path)}${extras ? '&extras=1' : ''}`);
                const said = await answer.json();
                if (answer.ok === false) {
                    throw new Error(said.error || `the machine answered ${answer.status}`);
                }
                this.counted[path] = {state: 'done', started: this.counted[path].started, answer: said, error: null};
            }
            catch (error) {
                this.counted[path] = {state: 'failed', started: this.counted[path].started, answer: null, error: error.message};
            }
            finally {
                delete this.progress[path];
            }
        },
        // Every second while something is counted: the clock moves, and each count says how far
        // it has got. An agent from before progress says so once, and the clock goes on alone.
        ticking_start: function () {
            if (this.ticking !== undefined) {
                return;
            }
            const self = this;
            this.ticking = setInterval(function () {
                self.now = Date.now();
                if (self.counting === false) {
                    self.ticking_stop();
                    return;
                }
                self.progress_read();
            }, PROGRESS_EVERY_MS);
        },
        ticking_stop: function () {
            if (this.ticking !== undefined) {
                clearInterval(this.ticking);
                this.ticking = undefined;
            }
        },
        progress_read: async function () {
            if ((this.live === false) || (this.asking === true)) {
                return;
            }
            this.asking = true;
            try {
                for (const path of Object.keys(this.counted).filter(v => this.counted[v].state === 'counting')) {
                    const answer = await fetch(`${this.base}/usage/progress?path=${encodeURIComponent(path)}`);
                    if (answer.ok === false) {
                        this.live = (answer.status !== 400) && (answer.status !== 404);
                        return;
                    }
                    const said = await answer.json();
                    if ((said.counting === true) && (this.counted[path] !== undefined) && (this.counted[path].state === 'counting')) {
                        this.progress[path] = said;
                    }
                }
            }
            catch {
                // The machine did not answer this time: the next tick asks again
            }
            finally {
                this.asking = false;
            }
        },
    },
};

// A row that is no folder: a word in place of a name, at the place of the folder it is about
function row_said(path, depth, name)
{
    return {key: `${path}#said`, path, name, code: false, note: '', depth, size: null, share: 0, folder: false, open: false, unseen: false, waiting: false, said: false};
}

// Many unreadable folders side by side say little one by one: "58 in /tmp" says it whole
function unread_grouped(paths)
{
    const by_parent = new Map();
    for (const path of paths) {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        by_parent.set(parent, (by_parent.get(parent) || []).concat([path]));
    }
    const out = [];
    for (const [parent, list] of by_parent) {
        if (list.length >= 3) {
            out.push(`${list.length} in ${parent}`);
        }
        else {
            out.push(...list);
        }
    }
    return out;
}

export default disk_usage;
