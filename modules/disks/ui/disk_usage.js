import format_bytes from '../../format_bytes.js';

// What takes the space on one disk of a machine: its biggest folders, each with a bar of its
// share, and a click on one opens the folders inside it. Counting reads every folder, a minute
// on a big disk, so a disk is counted when asked and each folder once. What the agent could not
// read, and what docker and the journal keep, are said above the tree: on a server they are
// where space most often goes unseen.
//
//     disk  {mounts, used, total}, the row of the disk list
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
    <p v-if="(top === undefined || top.state === 'counting')" class="muted">Counting every folder on this disk, which can take a minute on a big one…</p>
    <p v-else-if="(top.state === 'failed')" class="bad">{{ top.error }}</p>
    <template v-else>
        <ul class="du-notes">
            <li v-for="line of notes" :key="line.text" :class="line.tone">{{ line.text }}</li>
        </ul>
        <div class="du-tree" role="tree">
            <button v-for="row of rows" :key="row.key" type="button" class="du-row" :class="{dim: (row.folder === false)}" :style="{'--depth': row.depth}" :disabled="(row.folder === false)" role="treeitem" :aria-expanded="(row.folder ? row.open : undefined)" :title="row.path" @click="toggle(row)">
                <span class="du-name">
                    <span class="du-fold" aria-hidden="true">{{ row.folder ? (row.open ? '▾' : '▸') : '' }}</span>
                    <code>{{ row.name }}</code>
                    <span v-if="(row.note !== '')" class="muted">{{ row.note }}</span>
                </span>
                <span class="du-bar meter"><span :style="{width: (row.share*100).toFixed(1) + '%'}"></span></span>
                <span class="du-size">{{ (row.size === null) ? '' : format_bytes(row.size) }}</span>
            </button>
        </div>
    </template>
</section>
`,
    props: {
        base: {type: String, required: true},
        disk: {type: Object, required: true},
    },
    emits: ['close'],
    data: function () {
        // counted: by folder, {state: counting | done | failed, answer, error}
        return {counted: {}, open: {}};
    },
    computed: {
        root: function () {
            return this.disk.mounts[0];
        },
        top: function () {
            return this.counted[this.root];
        },
        counting: function () {
            return Object.values(this.counted).some(v => v.state === 'counting');
        },
        // What the folders do not show: what could not be read, what is on the disk outside any
        // folder counted, and what docker and the journal keep
        notes: function () {
            const answer = this.top.answer;
            const out = [];
            const unseen = this.disk.used - answer.total;
            if (answer.unread.length > 0) {
                const named = answer.unread.slice(0, 4).join(', ');
                const more = (answer.unread.length > 4) ? ` and ${answer.unread.length - 4} more` : '';
                out.push({tone: 'bad', text: `The agent could not read ${named}${more}: what they hold is not in the folders below.`});
            }
            if (unseen > Math.max(1024**3, this.disk.used*0.05)) {
                out.push({tone: '', text: `${format_bytes(unseen)} of what is used is in no folder counted here: in the folders the agent could not read, or in files deleted while a program still holds them open.`});
            }
            const extras = answer.extras || {};
            if (Array.isArray(extras.docker) && (extras.docker.length > 0)) {
                out.push({tone: '', text: `Docker keeps ${extras.docker.map(v => `${format_bytes(v.size)} in ${v.what}`).join(', ')}.`});
            }
            if (extras.journal > 0) {
                out.push({tone: '', text: `The system journal takes ${format_bytes(extras.journal)}.`});
            }
            out.push({tone: 'muted', text: `Counted in ${(answer.took_ms/1000).toFixed(1)}s, this disk alone.`});
            return out;
        },
        // The tree as rows: a folder's own folders under it while it is open, biggest first,
        // and the files lying in it as one row of their own
        rows: function () {
            const out = [];
            const total = Math.max(1, this.top.answer.total);
            const self = this;
            function walk(path, depth) {
                const here = self.counted[path];
                if ((here === undefined) || (here.state === 'counting')) {
                    out.push({key: `${path}#counting`, path, name: 'counting…', note: '', depth, size: null, share: 0, folder: false, open: false});
                    return;
                }
                if (here.state === 'failed') {
                    out.push({key: `${path}#failed`, path, name: here.error, note: '', depth, size: null, share: 0, folder: false, open: false});
                    return;
                }
                const answer = here.answer;
                for (const folder of answer.folders) {
                    const open = (self.open[folder.path] === true);
                    out.push({key: folder.path, path: folder.path, name: folder.path.split('/').pop(), note: '', depth, size: folder.size, share: folder.size/total, folder: true, open});
                    if (open) {
                        walk(folder.path, depth + 1);
                    }
                }
                if (answer.files > 0) {
                    out.push({key: `${path}#files`, path, name: 'files here', note: '', depth, size: answer.files, share: answer.files/total, folder: false, open: false});
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
                this.count(this.root, (this.root === '/'));
            },
        },
    },
    methods: {
        format_bytes: function (bytes) {
            return format_bytes(bytes);
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
            this.count(this.root, (this.root === '/'));
            for (const path of Object.keys(this.open).filter(v => this.open[v])) {
                this.count(path, false);
            }
        },
        count: async function (path, extras) {
            this.counted[path] = {state: 'counting', answer: null, error: null};
            try {
                const answer = await fetch(`${this.base}/usage?path=${encodeURIComponent(path)}${extras ? '&extras=1' : ''}`);
                const said = await answer.json();
                if (answer.ok === false) {
                    throw new Error(said.error || `the machine answered ${answer.status}`);
                }
                this.counted[path] = {state: 'done', answer: said, error: null};
            }
            catch (error) {
                this.counted[path] = {state: 'failed', answer: null, error: error.message};
            }
        },
    },
};

export default disk_usage;
