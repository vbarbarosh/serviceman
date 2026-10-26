import copy_progress from './copy_progress.js';
import data_table from '../../data_table.js';
import data_transfer_read from './data_transfer_read.js';
import upload_queue from './upload_queue.js';

// How often the copies between disks are asked about while one is under way
const TRANSFERS_POLL_MS = 1000;

// Files landing in the folder shown read it again at most this often: a thousand small files
// are a thousand landings
const REREAD_MS = 1000;

// A drop counted quicker than this shows no Counting card: it would only flash
const COUNTING_SHOWN_MS = 300;

// The failed files Uploads keeps in view, the latest
const COPY_FAILED_ROWS = 3;

// A file larger than this is opened in a tab, not read into the page
const EDIT_MAX_BYTES = 10*1024*1024;

// Names that are not text whatever their size: opened in a tab, never read into the editor
const RE_NOT_TEXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|zst|7z|rar|tar|jar|war|deb|rpm|iso|img|dmg|exe|dll|so|o|a|class|pyc|wasm|mp3|mp4|m4a|webm|mkv|mov|avi|ogg|oga|flac|wav|woff2?|ttf|otf|eot|sqlite3?|db)$/i;

// The languages the editor offers, as the picker shows them
const LANGUAGES = [
    {value: 'text', label: 'plain text'},
    {value: 'css', label: 'CSS'},
    {value: 'diff', label: 'diff'},
    {value: 'dockerfile', label: 'Dockerfile'},
    {value: 'go', label: 'Go'},
    {value: 'html', label: 'HTML'},
    {value: 'javascript', label: 'JavaScript'},
    {value: 'json', label: 'JSON'},
    {value: 'jsx', label: 'JSX'},
    {value: 'lua', label: 'Lua'},
    {value: 'markdown', label: 'Markdown'},
    {value: 'nginx', label: 'nginx'},
    {value: 'perl', label: 'Perl'},
    {value: 'php', label: 'PHP'},
    {value: 'properties', label: 'ini / properties'},
    {value: 'python', label: 'Python'},
    {value: 'ruby', label: 'Ruby'},
    {value: 'rust', label: 'Rust'},
    {value: 'shell', label: 'shell'},
    {value: 'sql', label: 'SQL'},
    {value: 'toml', label: 'TOML'},
    {value: 'tsx', label: 'TSX'},
    {value: 'typescript', label: 'TypeScript'},
    {value: 'xml', label: 'XML'},
    {value: 'yaml', label: 'YAML'},
];

// The language a file is written in, by its name
const LANGUAGE_BY_EXTENSION = {
    bash: 'shell', cjs: 'javascript', conf: 'properties', css: 'css', diff: 'diff', env: 'shell',
    go: 'go', htm: 'html', html: 'html', ini: 'properties', js: 'javascript', json: 'json',
    jsx: 'jsx', lua: 'lua', markdown: 'markdown', md: 'markdown', mjs: 'javascript', patch: 'diff',
    php: 'php', pl: 'perl', properties: 'properties', py: 'python', rb: 'ruby', rs: 'rust',
    scss: 'css', service: 'properties', sh: 'shell', sql: 'sql', svg: 'xml', toml: 'toml',
    ts: 'typescript', tsx: 'tsx', vue: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml', zsh: 'shell',
};

// A file dropped beside the list never opens in the tab and loses the page. An editor takes
// its own drops, and a drag of text is left to the field under it.
addEventListener('dragover', function (event) {
    if ((event.defaultPrevented === false) && is_files_drag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
    }
});
addEventListener('drop', function (event) {
    if (is_files_drag(event)) {
        event.preventDefault();
    }
});

// One folder at a time, read from the API under `base` when asked and kept nowhere, and
// files from here copied into the open folder. The host page gives the API, the colours
// (--bg, --panel, --fg, --muted, --line, --hover, --accent) and its usual classes; its one
// table, data-table, is imported from the page beside it.
const file_manager = {
    template: `
<article class="fm" @dragover="drag_over" @dragleave="drag_leave" @drop="dropped">
    <!-- Where this is: every folder on the way is a step back to it -->
    <div class="fm-path">
        <button type="button" class="fm-icon" title="Up one folder" aria-label="Up one folder" :disabled="(busy || offline || parent === null)" @click="go(parent)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
        <button type="button" class="fm-icon" :title="(home_title || 'The folder it starts in')" aria-label="Home folder" :disabled="(busy || offline)" @click="go('')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></svg>
        </button>
        <input v-if="editing" ref="path_field" v-model.trim="typed" class="fm-typed" spellcheck="false" @keyup.enter="typed_open" @keyup.esc="editing = false" @blur="edit_end">
        <nav v-else ref="crumbs" class="fm-crumbs" title="Click a folder to go back to it, or the empty space to type a path" @click.self="edit_start">
            <template v-for="(crumb, i) of crumbs" :key="crumb.path">
                <span v-if="(i > 1)" class="muted">/</span>
                <button type="button" class="fm-crumb" :class="{on: (i === crumbs.length - 1 && open_file === null)}" :disabled="(busy || offline)" @click="go(crumb.path)">{{ crumb.label }}</button>
            </template>
            <template v-if="(open_file !== null)">
                <span v-if="(crumbs.length > 1)" class="muted">/</span>
                <span class="fm-crumb on">{{ open_file.name }}</span>
            </template>
        </nav>
        <button type="button" class="fm-icon" title="Type a path" aria-label="Type a path" :disabled="offline" @click="edit_start">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/></svg>
        </button>
        <button type="button" class="fm-icon" :title="(open_file === null ? 'Read this folder again' : 'Read this file again')" aria-label="Read again" :disabled="(busy || offline || path === null)" @click="refresh">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 2.5v4.2h-4.2"/></svg>
        </button>
    </div>
    <template v-if="(open_file === null)">
    <!-- One bar, always in the same place: what can be done with nothing ticked, with
         something ticked, and the one question an action asks before it happens -->
    <div class="list-tools fm-bar" :class="{picked: (chosen_names.length > 0 || mode !== '')}">
        <template v-if="(mode === 'folder')">
            <span>New folder in <code>{{ here }}</code></span>
            <input ref="ask" v-model.trim="folder_name" placeholder="its name — foo/bar goes deep" spellcheck="false" @keyup.enter="folder_make" @keyup.esc="mode = ''">
            <button type="button" class="primary" :disabled="(acting || offline || folder_name === '')" @click="folder_make">Create</button>
            <button type="button" @click="mode = ''">Cancel</button>
        </template>
        <template v-else-if="(mode === 'rename')">
            <span>Rename <code>{{ chosen_names[0] }}</code> to</span>
            <input ref="ask" v-model.trim="new_name" spellcheck="false" @keyup.enter="rename" @keyup.esc="mode = ''">
            <button type="button" class="primary" :disabled="(acting || offline || new_name === '' || new_name === chosen_names[0])" @click="rename">Rename</button>
            <button type="button" @click="mode = ''">Cancel</button>
        </template>
        <template v-else-if="(mode === 'move')">
            <span>Move {{ chosen_text }} to</span>
            <input ref="ask" v-model.trim="move_to" placeholder="the folder to move to" spellcheck="false" @keyup.enter="move" @keyup.esc="mode = ''">
            <button type="button" class="primary" :disabled="(acting || offline || move_to === '')" @click="move">Move</button>
            <button type="button" @click="mode = ''">Cancel</button>
        </template>
        <template v-else-if="(mode === 'copy')">
            <span>Copy {{ chosen_text }} to</span>
            <select v-model="copy_disk" aria-label="The machine to copy to">
                <option v-for="item of targets" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <input ref="ask" v-model.trim="copy_dir" placeholder="the folder there" spellcheck="false" @keyup.enter="copy_start" @keyup.esc="mode = ''">
            <button type="button" class="primary" :disabled="(acting || copy_disk === '' || copy_dir === '')" @click="copy_start">Copy</button>
            <button type="button" @click="mode = ''">Cancel</button>
        </template>
        <template v-else-if="(mode === 'delete')">
            <span class="bad">Delete {{ chosen_text }}{{ (title ? ' from ' + title : '') }}? A folder goes with everything in it, and nothing brings it back.</span>
            <button type="button" class="danger" :disabled="(acting || offline)" @click="remove">Delete</button>
            <button type="button" @click="mode = ''">Cancel</button>
        </template>
        <template v-else-if="(chosen_names.length > 0)">
            <b>{{ chosen_text }}</b>
            <a class="button" :href="download_url" download>Download</a>
            <button v-if="(chosen_names.length === 1)" type="button" :disabled="offline" @click="mode_open('rename')">Rename</button>
            <button type="button" :disabled="offline" @click="mode_open('move')">Move to…</button>
            <button v-if="copy_able" type="button" :disabled="offline" title="Copy to another folder, on this machine or another" @click="mode_open('copy')">Copy to…</button>
            <button type="button" class="danger" :disabled="offline" @click="mode_open('delete')">Delete…</button>
            <span class="list-right"><button type="button" @click="chosen = {}">Clear</button></span>
        </template>
        <template v-else>
            <input v-model.trim="filter" type="search" placeholder="filter this folder" spellcheck="false">
            <button type="button" class="chip" :class="{on: show_dot_files}" :title="(show_dot_files ? 'Hide the names that start with a dot' : 'Show the names that start with a dot')" @click="show_dot_files = !show_dot_files">dot files <span class="muted">{{ dot_count }}</span></button>
            <span class="list-right">
                <button type="button" :disabled="(offline || path === null)" @click="mode_open('folder')">+ New folder</button>
                <button type="button" :disabled="(offline || path === null)" title="A whole folder, its inner folders too; or drop it on the list" @click="$refs.folder_picker.click()">Upload folder</button>
                <button type="button" class="primary" :disabled="(offline || path === null)" title="Or drop them on the list, or paste them with Ctrl+V" @click="$refs.picker.click()">Upload files</button>
            </span>
        </template>
    </div>
    <p v-if="(note_shown !== '')" :class="(note_bad ? 'bad' : 'muted')" class="fm-note">{{ note_shown }}</p>
    <input ref="picker" type="file" multiple hidden @change="picked">
    <input ref="folder_picker" type="file" webkitdirectory hidden @change="picked">
    <!-- What is on its way there, one file at a time, above the folder it lands in -->
    <!-- A drop being read: what it holds so far. Nothing goes before it is counted. -->
    <!-- Shaped as Uploads will be, so nothing under it moves when the copy takes its place; a
         drop counted in a moment never shows it -->
    <copy-progress v-if="((counting !== null) && counting.shown)" :copy="counting_copy">
        <template #acts><button type="button" @click="counting.stop = true">Cancel</button></template>
    </copy-progress>
    <!-- Not room enough on that disk for all of it: what fits, or nothing -->
    <div v-if="(room_ask !== null)" class="card fm-uploads fm-room">
        <div class="list-head">
            <b>Uploads</b>
            <span class="muted fm-copy-summary">{{ room_ask.files }} {{ plural(room_ask.files, 'file', 'files') }} · {{ format_bytes(room_ask.bytes) }}</span>
        </div>
        <p class="fm-room-what">{{ room_ask.text }}</p>
        <div class="fm-room-acts">
            <button v-if="(room_ask.fit_files > 0)" type="button" class="primary" @click="room_answer(true)">Copy what fits: {{ room_ask.fit_files }} {{ plural(room_ask.fit_files, 'file', 'files') }}, {{ format_bytes(room_ask.fit_bytes) }}</button>
            <button type="button" @click="room_answer(false)">Don't copy</button>
        </div>
    </div>
    <copy-progress v-if="(queue.copies.length > 0)" :copy="upload_copy">
        <template #acts>
            <button v-if="(queue.copying && (queue.paused === false))" type="button" @click="queue.pause()">Pause</button>
            <button v-if="queue.paused" type="button" class="primary" @click="queue.resume()">Resume</button>
            <button v-if="queue.copying" type="button" @click="queue.stop()">Cancel</button>
            <button v-else type="button" @click="queue.clear()">Clear</button>
        </template>
        <!-- What failed stays in view, the last few of it, until Clear -->
        <div v-for="item of copy_failed" :key="item.label" class="fm-copy">
            <code :title="item.label">{{ item.label }}</code>
            <span class="fm-copy-state bad" :title="item.said">{{ item.said }}</span>
        </div>
    </copy-progress>
    <!-- Copies between this disk and another, run by the server: they go on with the page closed.
         All of them are one copy, as Uploads is: one count, Pause, the file on its way -->
    <copy-progress v-if="(transfers_here.length > 0)" :copy="transfer_copy">
        <template #acts>
            <button v-if="(transfer_going && (transfers_paused === false))" type="button" @click="transfers_pause">Pause</button>
            <button v-if="(transfer_going && transfers_paused)" type="button" class="primary" @click="transfers_resume">Resume</button>
            <button v-if="transfer_going" type="button" @click="transfers_cancel">Cancel</button>
            <button v-else type="button" @click="transfers_clear">Clear</button>
        </template>
        <!-- What failed or was left out stays in view, the last few of it, until Clear -->
        <div v-for="item of transfer_failed" :key="item.id" class="fm-copy">
            <code :title="item.title">{{ item.name }}</code>
            <span class="fm-copy-state bad" :title="item.title">{{ item.said }}</span>
        </div>
    </copy-progress>
    <!-- The whole row is the control: a folder opens, a file takes the tick -->
    <data-table v-if="(path !== null)" class="fm-table" :columns="columns" :rows="items_shown" row_key="name" :empty="empty_text" :sort="{key: sort, down: sort_desc}" :selected="chosen_names" :chosen="row_chosen" :on_row="row_click" @sort="sort_by" @selected="chosen_set">
        <template #cell="{row, column}">
            <template v-if="(column.key === 'name')">
                <svg v-if="(row.kind === 'dir')" class="dt-icon fm-dir" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>
                <svg v-else class="dt-icon fm-file" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z"/><path d="M13 3v6h6"/></svg>
                <b v-if="(row.kind === 'dir')">{{ row.name }}</b>
                <a v-else :href="file_url(row)" target="_blank" rel="noreferrer" :title="(is_editable(row) ? 'Open it here — Ctrl-click opens it in a tab' : 'Open it in a tab of its own')" @click.stop="name_click(row, $event)">{{ row.name }}</a>
            </template>
            <template v-else-if="(column.key === 'size')">{{ (row.kind === 'dir' ? '—' : (row.size === null ? '' : format_bytes(row.size))) }}</template>
            <span v-else class="muted" :title="mtime_title(row)">{{ (row.mtime_ms === null ? '' : format_ms_ago(now - row.mtime_ms)) }}</span>
        </template>
    </data-table>
    <p v-if="(path !== null)" class="muted fm-foot">{{ summary }} · drop files or folders here, or paste them with Ctrl+V, to copy them in</p>
    </template>
    <!-- One file of the folder, read into an editor in place of the list -->
    <template v-else>
        <div class="list-tools fm-bar picked">
            <template v-if="(edit_ask === 'conflict')">
                <span class="bad">{{ open_file.name }} changed on the disk since it was opened here.</span>
                <button type="button" class="danger" :disabled="saving" @click="save(true)">Overwrite it</button>
                <button type="button" @click="discard('reload')">Load theirs</button>
                <button type="button" @click="edit_ask = ''">Cancel</button>
            </template>
            <template v-else-if="(edit_ask !== '')">
                <span class="bad">{{ ask_text }}</span>
                <button type="button" class="primary" :disabled="saving" @click="save_then_go">Save</button>
                <button type="button" class="danger" @click="discard(edit_ask)">Discard changes</button>
                <button type="button" @click="edit_ask = ''">Keep editing</button>
            </template>
            <template v-else>
                <b>{{ open_file.name }}</b>
                <span class="muted">{{ file_meta }}</span>
                <span v-if="dirty" class="fm-dirty">● not saved</span>
                <span class="list-right">
                    <select v-model="language" aria-label="Language" :disabled="(open_file.state !== 'ready')">
                        <option v-for="item of LANGUAGES" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <button type="button" class="chip" :class="{on: wrap}" title="Wrap long lines" @click="wrap = !wrap">wrap</button>
                    <a class="button" :href="file_url(open_file)" target="_blank" rel="noreferrer">Open in a tab</a>
                    <button type="button" class="primary" :disabled="(dirty === false || saving || offline)" title="Ctrl+S" @click="save(false)">{{ saving ? 'saving…' : 'Save' }}</button>
                    <button type="button" @click="file_close">Close</button>
                </span>
            </template>
        </div>
        <p v-if="(edit_note !== '')" :class="(edit_bad ? 'bad' : 'muted')" class="fm-note">{{ edit_note }}</p>
        <div v-if="(open_file.state === 'loading')" class="card fm-editor-msg muted">reading {{ open_file.name }}…</div>
        <div v-else-if="(open_file.state === 'binary')" class="card fm-editor-msg">
            <p><b>{{ open_file.name }}</b> is not text, so it is not opened here.</p>
            <p><a :href="file_url(open_file)" target="_blank" rel="noreferrer">Open it in a tab</a> · <a :href="download_one(open_file)" download>Download it</a></p>
        </div>
        <div v-else-if="(open_file.state === 'error')" class="card fm-editor-msg bad">{{ open_file.error }}</div>
        <div v-show="(open_file.state === 'ready')" ref="editor" class="card fm-editor"></div>
    </template>
    <!-- Files and folders dropped anywhere on the file manager are copied into the folder shown.
         Fixed over the part of it in view, wherever the page is scrolled. -->
    <div v-if="dragging" class="fm-drop" :style="drop_style"><span>Drop files or folders to copy into <code>{{ here }}</code><template v-if="user">, written as {{ user }}</template></span></div>
</article>
`,
    // base       where the API is: GET base?path=, base/file/<path>, base/tar, POST base/upload…
    // open_base  where a file opens in a tab of its own, its path appended; base/file by default
    // title      the name of the place, for the question before a delete
    // user       who the files are written as, for the hint on a drop
    // home_title what the home button says it goes to
    // start      the folder opened first; the disk's starting folder when none
    // transfers  where the host's copies between disks are; none, and no file is copied away
    // disk       this disk's name among them
    // targets    the other disks a file may be copied to: [{value, label}]
    components: {'copy-progress': copy_progress, 'data-table': data_table},
    props: ['base', 'theme', 'offline', 'open_base', 'title', 'user', 'home_title', 'start', 'transfers', 'disk', 'targets'],
    // path       the folder now shown, each time another one is, for the host to keep: in the
    //            address, say, where a reload finds it and gives it back as `start`
    emits: ['path'],
    data: function () {
        return {
            LANGUAGES,
            // The file read into the editor, while there is one: {name, path, size, mtime_ms,
            // state: loading | ready | binary | error, error}
            open_file: null,
            // The text as it was read or last saved, to tell an edit from a revert
            original_text: '',
            dirty: false,
            saving: false,
            // The question the editor bar is asking: close, leave, reload or conflict
            edit_ask: '',
            // Where a leave was going, for when the question is answered
            leave_to: '',
            language: 'text',
            wrap: false,
            edit_note: '',
            edit_bad: false,
            path: null,
            typed: '',
            items: [],
            now: Date.now(),
            note: '',
            bad: false,
            busy: false,
            show_dot_files: false,
            // Narrows the open folder by name; walking into another folder keeps it
            filter: '',
            sort: 'name',
            sort_desc: false,
            // The one question the bar is asking, if any: folder, rename, move, copy or delete
            mode: '',
            // The path bar as a field to type into, instead of the folders on the way
            editing: false,
            // What is ticked, by name; walking into another folder unticks everything
            chosen: {},
            new_name: '',
            move_to: '',
            folder_name: '',
            act_note: '',
            act_bad: false,
            acting: false,
            // The files chosen for this disk, and what became of each. The page keeps them,
            // not this tab: a copy goes on while another tab is open, and is here on coming back.
            queue: upload_queue(this.base),
            dragging: false,
            // Where the drop zone stands on the screen while something is dragged over
            drop_style: {},
            // A drop being read: {files, bytes, stop}; null when none is
            counting: null,
            // Not room enough on the disk for a drop: what it needs, what fits; null when all fits
            room_ask: null,
            // The last file that was under way, shown while none is
            copy_last: null,
            // What Uploads said when it was paused, held as it was until Resume
            frozen: null,
            // Shown, not kept aside: only a tab in view takes a paste
            active: true,
            // The copies between disks the host is running, as it last said
            transfer_items: [],
            // The host's copies are paused: none goes until Resume
            transfers_paused: false,
            copy_disk: '',
            copy_dir: '',
        };
    },
    computed: {
        // A folder is open and its machine is there: what is dropped or pasted has a place
        can_take: function () {
            return (this.path !== null) && (this.offline === false);
        },
        copy_able: function () {
            return Boolean(this.transfers) && Array.isArray(this.targets) && (this.targets.length > 0);
        },
        transfers_here: function () {
            return this.transfer_items.filter(v => (v.from.disk === this.disk) || (v.to.disk === this.disk));
        },
        transfer_going: function () {
            return this.transfers_here.some(transfer_going_of);
        },
        // Every copy of this disk at once, as Uploads counts its files: the files and bytes in,
        // and how long the copies have run and what they carried in that time, for their rate.
        // A copy not weighed yet (a folder still walked) is counted once it is.
        transfer_total: function () {
            const out = {files: 0, files_done: 0, failed: 0, bytes: 0, bytes_done: 0, unweighed: 0, ms: 0, bytes_since: 0, ratio: 0};
            for (const item of this.transfers_here) {
                const dir = (item.kind === 'dir');
                if (item.size === null) {
                    if (item.phase === 'error') {
                        out.files++;
                        out.failed++;
                    }
                    else if (transfer_going_of(item)) {
                        out.unweighed++;
                    }
                    continue;
                }
                const files = dir ? item.files : 1;
                const done = dir ? item.files_done : ((item.phase === 'ok') ? 1 : 0);
                out.files += files;
                out.files_done += done;
                out.bytes += item.size;
                out.bytes_done += (item.phase === 'ok') ? item.size : item.received;
                // What a folder left out, and what a copy that failed did not carry
                if ((item.phase === 'ok') || (item.phase === 'error')) {
                    out.failed += files - done;
                }
                if (item.ms > 0) {
                    out.ms += item.ms;
                    out.bytes_since += ((item.phase === 'ok') ? item.size : item.received) - ((item.began_at === null) ? 0 : item.began_at);
                }
            }
            out.ratio = (out.bytes === 0) ? ((out.files === 0) ? 0 : out.files_done/out.files) : Math.min(1, out.bytes_done/out.bytes);
            return out;
        },
        // "48% · 1417 of 2940 files · 1.4GB of 2.9GB", as Uploads says it
        transfer_summary: function () {
            const total = this.transfer_total;
            if ((total.files === 0) && (total.unweighed > 0)) {
                return 'counting what to copy…';
            }
            const said = [`${total.files_done} of ${total.files} ${plural(total.files, 'file', 'files')}`, `${format_bytes(total.bytes_done)} of ${format_bytes(total.bytes)}`];
            if (total.files > 1) {
                said.unshift(`${Math.floor(total.ratio*100)}%`);
            }
            if (total.unweighed > 0) {
                said.push(`${total.unweighed} more ${plural(total.unweighed, 'copy', 'copies')} counted…`);
            }
            if (total.failed > 0) {
                said.push(`${total.failed} failed`);
            }
            return said.join(' · ');
        },
        // From the rate the copies have carried at, their pauses aside; null while it is too
        // early to tell, or while a copy in line is not counted yet
        transfer_left_ms: function () {
            const total = this.transfer_total;
            if ((this.transfer_going === false) || (total.unweighed > 0) || (total.ms <= 2000) || (total.bytes_since <= 0)) {
                return null;
            }
            return Math.max(0, total.bytes - total.bytes_done)*total.ms/total.bytes_since;
        },
        // The speed across every copy, each copy's own graph laid where its bytes fall among all
        transfer_samples: function () {
            const total = this.transfer_total.bytes;
            const out = [];
            let offset = 0;
            for (const item of this.transfers_here) {
                if (item.size === null) {
                    continue;
                }
                if ((total > 0) && Array.isArray(item.samples)) {
                    for (const point of item.samples) {
                        out.push({x: Math.min(1, (offset + point.x*item.size)/total), y: point.y});
                    }
                }
                offset += item.size;
            }
            return out;
        },
        // The copy the file line is of: the one under way, else the last that carried anything
        // (one that failed before its first byte is a row below), else the first in line
        transfer_shown: function () {
            const going = this.transfers_here.find(v => ['copying', 'retrying', 'paused'].includes(v.phase));
            if (going !== undefined) {
                return going;
            }
            const ended = this.transfers_here.filter(v => ['ok', 'error', 'cancelled'].includes(v.phase) && (v.size !== null));
            if (ended.length > 0) {
                return ended.at(-1);
            }
            const waiting = this.transfers_here.find(v => v.phase === 'waiting');
            return (waiting === undefined) ? null : waiting;
        },
        // Every copy of this disk as one copy, for the panel Uploads has
        transfer_copy: function () {
            const total = this.transfer_total;
            const places = new Set(this.transfers_here.map(v => this.transfer_where(v)));
            let state = 'going';
            if (this.transfer_going === false) {
                state = (total.files_done + total.failed === total.files) ? 'done' : 'stopped';
            }
            else if (this.transfers_paused) {
                state = 'paused';
            }
            return {
                title: (places.size === 1) ? `Copy ${Array.from(places)[0]}` : 'Copies',
                state,
                summary: this.transfer_summary,
                files: total.files,
                files_done: total.files_done,
                failed: total.failed,
                bytes: total.bytes,
                bytes_done: total.bytes_done,
                samples: this.transfer_samples,
                left_ms: this.transfer_left_ms,
                now: this.transfer_now,
            };
        },
        // The file line: what is on its way, and while nothing is, why
        transfer_now: function () {
            const item = this.transfer_shown;
            if (item === null) {
                return null;
            }
            const now = ((item.now === null) || (item.now === undefined)) ? {label: item.name, size: item.size, done: item.received} : item.now;
            const out = {label: now.label, size: now.size, done: now.done, going: ['copying', 'paused'].includes(item.phase), said: '', bad: false};
            if (item.phase === 'waiting') {
                out.said = this.transfers_paused ? 'not started yet' : 'waits for a copy between other machines';
            }
            else if ((item.size === null) && transfer_going_of(item)) {
                out.said = (item.kind === 'dir') ? 'reading the folder…' : 'weighing the file…';
            }
            else if (item.phase === 'retrying') {
                out.said = `${item.said} — trying again in ${item.wait_s}s`;
                out.bad = true;
            }
            return out;
        },
        // What failed, the latest few, as Uploads lists its files that failed: a copy that
        // failed, each name a folder left out, and what else it left out (links, sockets, the
        // names past those kept). The rest are counted in the line above.
        transfer_failed: function () {
            const rows = [];
            for (const item of this.transfers_here) {
                if (item.phase === 'error') {
                    rows.push({id: item.id, name: item.name, said: item.said, title: `${item.from.disk}:${item.from.path} → ${item.to.disk}:${item.to.dir}\n${item.said}`});
                    continue;
                }
                if ((item.phase !== 'ok') || (item.said === '')) {
                    continue;
                }
                const left = item.left;
                for (const name of left.names) {
                    rows.push({id: `${item.id}/${name.path}`, name: `${item.name}/${name.path}`, said: name.said, title: `${item.name}/${name.path}\n${name.said}`});
                }
                if ((left.unread > left.names.length) || (left.links > 0) || (left.others > 0)) {
                    rows.push({id: item.id, name: item.name, said: item.said, title: this.transfer_done_title(item)});
                }
            }
            return rows.slice(-COPY_FAILED_ROWS);
        },
        open_root: function () {
            return this.open_base ? this.open_base : `${this.base}/file`;
        },
        parent: function () {
            if ((this.path === null) || (this.path === '/')) {
                return null;
            }
            const at = this.path.lastIndexOf('/');
            return (at === 0) ? '/' : this.path.slice(0, at);
        },
        // What the editor bar says about the open file, beside its name
        file_meta: function () {
            const file = this.open_file;
            const said = [format_bytes(file.size)];
            if (file.mtime_ms !== null) {
                said.push(`modified ${format_ms_ago(Date.now() - file.mtime_ms)}`);
            }
            return said.join(' · ');
        },
        ask_text: function () {
            const name = this.open_file.name;
            if (this.edit_ask === 'reload') {
                return `Read ${name} again, and lose what was changed here?`;
            }
            return `${name} has changes that are not saved.`;
        },
        // Every folder on the way from the root to here, each one a place to go back to
        crumbs: function () {
            if (this.path === null) {
                return [];
            }
            const out = [{label: '/', path: '/'}];
            let at = '';
            for (const part of this.path.split('/')) {
                if (part === '') {
                    continue;
                }
                at = `${at}/${part}`;
                out.push({label: part, path: at});
            }
            return out;
        },
        here: function () {
            return (this.crumbs.length === 0) ? '' : this.crumbs[this.crumbs.length - 1].label;
        },
        columns: function () {
            return [{key: 'name', label: 'Name', sort: true, wraps: true}, {key: 'size', label: 'Size', sort: true, fold: 2, align: 'right'}, {key: 'mtime', label: 'Modified', sort: true, fold: 1}];
        },
        dot_count: function () {
            return this.items.filter(v => v.name.startsWith('.')).length;
        },
        // Folders first whatever the order, then by the column picked
        items_shown: function () {
            const wanted = this.filter.toLowerCase();
            const out = this.items.filter(v => (this.show_dot_files || (v.name.startsWith('.') === false)) && ((wanted === '') || v.name.toLowerCase().includes(wanted)));
            const sign = this.sort_desc ? -1 : 1;
            const sort = this.sort;
            out.sort(function (a, b) {
                if ((a.kind === 'dir') !== (b.kind === 'dir')) {
                    return (a.kind === 'dir') ? -1 : 1;
                }
                if ((sort === 'size') && (a.size !== b.size)) {
                    return sign*((a.size || 0) - (b.size || 0));
                }
                if ((sort === 'mtime') && (a.mtime_ms !== b.mtime_ms)) {
                    return sign*((a.mtime_ms || 0) - (b.mtime_ms || 0));
                }
                // Equal sizes and dates fall back to the name, always A to Z
                return ((sort === 'name') ? sign : 1)*a.name.localeCompare(b.name, undefined, {numeric: true});
            });
            return out;
        },
        chosen_text: function () {
            const count = this.chosen_names.length;
            return (count === 1) ? this.chosen_names[0] : `${count} items`;
        },
        empty_text: function () {
            if (this.items.length === 0) {
                return 'An empty folder. Upload files or a folder here, drop them anywhere on this page, or paste them with Ctrl+V.';
            }
            if (this.filter !== '') {
                return 'Nothing in this folder matches the filter.';
            }
            return 'Only dot files here — the dot files chip shows them.';
        },
        // What the folder holds, under the list: what is shown, and what is not
        summary: function () {
            const dirs = this.items_shown.filter(v => v.kind === 'dir').length;
            const files = this.items_shown.length - dirs;
            let bytes = 0;
            for (const item of this.items_shown) {
                bytes += ((item.kind === 'dir') || (item.size === null)) ? 0 : item.size;
            }
            const said = [`${dirs} ${plural(dirs, 'folder', 'folders')}`, `${files} ${plural(files, 'file', 'files')}`, format_bytes(bytes)];
            const hidden = this.items.length - this.items_shown.length;
            if (hidden > 0) {
                said.push(`${hidden} not shown`);
            }
            return said.join(' · ');
        },
        // The bar says what went wrong, or what an action did; reading a folder says nothing
        // when it works, since the list is the answer
        note_shown: function () {
            return (this.act_note !== '') ? this.act_note : (this.bad ? this.note : '');
        },
        note_bad: function () {
            return (this.act_note !== '') ? this.act_bad : this.bad;
        },
        // Every upload at once: files and bytes in, and what the copying under way has done since
        // it began, for its rate. Bytes that were in before (a file carried on) are not its work.
        copy_total: function () {
            const out = {files: 0, files_done: 0, failed: 0, bytes: 0, bytes_done: 0, files_since: 0, bytes_since: 0, ratio: 0};
            for (const item of this.queue.copies) {
                out.files++;
                out.bytes += item.size;
                if (item.phase === 'ok') {
                    out.files_done++;
                    out.bytes_done += item.size;
                }
                else if ((item.phase === 'copying') || (item.phase === 'retrying') || (item.phase === 'sent')) {
                    out.bytes_done += item.sent;
                }
                else if (item.phase === 'error') {
                    out.failed++;
                }
                if ((item.began >= this.queue.began) && (item.began > 0)) {
                    out.files_since += (item.phase === 'ok') ? 1 : 0;
                    out.bytes_since += ((item.phase === 'ok') ? item.size : item.sent) - (((item.began_at === null) || (item.began_at === undefined)) ? 0 : item.began_at);
                }
            }
            out.ratio = (out.bytes === 0) ? ((out.files === 0) ? 0 : out.files_done/out.files) : out.bytes_done/out.bytes;
            return out;
        },
        // "48% · 1417 of 2940 files · 1.4GB of 2.9GB"; the speed and the time left are under the
        // graph. One file has no graph: its own row says it all.
        copy_summary: function () {
            const total = this.copy_total;
            if (this.queue.making !== null) {
                return `making ${this.queue.making.total} ${plural(this.queue.making.total, 'folder', 'folders')}: ${this.queue.making.done} made`;
            }
            const said = [`${total.files_done} of ${total.files} ${plural(total.files, 'file', 'files')}`, `${format_bytes(total.bytes_done)} of ${format_bytes(total.bytes)}`];
            if (total.files > 1) {
                said.unshift(`${Math.floor(total.ratio*100)}%`);
            }
            if (total.failed > 0) {
                said.push(`${total.failed} failed`);
            }
            if (this.queue.bad && (this.queue.copying === false)) {
                said.push(this.queue.note);
            }
            return said.join(' · ');
        },
        // The longer of two guesses, from the whole copy's rate: by bytes, and by files, since a
        // thousand small files are a thousand answers to wait for, whatever their bytes; null
        // while it is too early to tell
        copy_left_ms: function () {
            const total = this.copy_total;
            const ms = Date.now() - this.queue.began - this.queue.paused_ms;
            if ((this.queue.copying === false) || (ms < 2000) || (total.bytes_since === 0)) {
                return null;
            }
            const by_bytes = (total.bytes - total.bytes_done)*ms/total.bytes_since;
            const by_files = (total.files_since > 0) ? (total.files - total.files_done - total.failed)*ms/total.files_since : 0;
            return Math.max(by_bytes, by_files);
        },
        // The file under way: in a stream, the one whose bytes are going now
        copy_now: function () {
            const going = this.queue.copies.filter(v => (v.phase === 'copying') || (v.phase === 'retrying'));
            const item = going.find(v => (v.sent > 0) && (v.sent < v.size));
            return (item !== undefined) ? item : ((going.length > 0) ? going[0] : null);
        },
        // The file under way, or the last one while none is: what the line under the graph shows
        copy_shown: function () {
            if (this.queue.copies.length === 0) {
                return null;
            }
            if (this.copy_now !== null) {
                return this.copy_now;
            }
            return (this.copy_last !== null) ? this.copy_last : this.queue.copies[0];
        },
        // Uploads as one copy, for the panel every copy has. Paused, it stands still as it was:
        // its figures, its graph, its file line.
        upload_copy: function () {
            if (this.frozen !== null) {
                return this.frozen;
            }
            const total = this.copy_total;
            const shown = this.copy_shown;
            let state = 'going';
            if (this.queue.copying === false) {
                state = (total.files_done + total.failed === total.files) ? 'done' : 'stopped';
            }
            return {
                title: 'Uploads',
                state,
                summary: this.copy_summary,
                files: total.files,
                files_done: total.files_done,
                failed: total.failed,
                bytes: total.bytes,
                bytes_done: total.bytes_done,
                samples: this.queue.samples,
                left_ms: this.copy_left_ms,
                now: (shown === null) ? null : {label: shown.label, done: shown.sent, size: shown.size, going: (shown.phase === 'copying'), said: (shown.phase === 'retrying') ? this.copy_retry(shown) : '', bad: (shown.phase === 'retrying')},
            };
        },
        // A drop being read: what it holds so far, in the panel Uploads will take over, so
        // nothing under it moves when the copy takes its place
        counting_copy: function () {
            return {title: 'Uploads', state: 'counting', files: null, files_done: this.counting.files, failed: 0, bytes: null, bytes_done: this.counting.bytes, samples: [], left_ms: null, now: null};
        },
        // The failed files, the latest few: the rest are counted in the line above
        copy_failed: function () {
            return this.queue.copies.filter(v => v.phase === 'error').slice(-COPY_FAILED_ROWS);
        },
        // Ticks on names the dot-files toggle has hidden do not count
        chosen_names: function () {
            return this.items_shown.filter(v => this.chosen[v.name] === true).map(v => v.name);
        },
        // One chosen file comes as itself; a folder, or several names, come as one tar. The
        // saving stays on this origin: the download attribute holds there and nowhere else.
        download_url: function () {
            const names = this.chosen_names;
            if (names.length === 1) {
                const item = this.items.find(v => v.name === names[0]);
                if ((item !== undefined) && (item.kind === 'file')) {
                    return `${this.base}/file${url_path(`${this.path}/${names[0]}`)}`;
                }
            }
            return `${this.base}/tar?dir=${encodeURIComponent(this.path)}${names.map(v => `&names=${encodeURIComponent(v)}`).join('')}`;
        },
    },
    watch: {
        // A folder that failed while the machine was away is read again once it is back
        offline: function (value) {
            if ((value === false) && this.bad && (this.open_file === null)) {
                this.open((this.path === null) ? (this.start ? this.start : '') : this.path);
            }
        },
        theme: function () {
            this.editor_look();
        },
        language: function () {
            this.editor_language();
        },
        wrap: function () {
            this.editor_wrap();
        },
        // A file landed in the folder shown: the list reads it again, quietly. One landed deeper,
        // in a folder of its own, changes nothing this list shows: its folder was made first.
        copy_now: function (value) {
            if (value !== null) {
                this.copy_last = value;
            }
        },
        // A pause takes back what was in flight; the screen does not show that, it stands still
        'queue.paused': function (value) {
            if (value) {
                const copy = this.upload_copy;
                this.frozen = Object.assign({}, copy, {state: 'paused', now: (copy.now === null) ? null : Object.assign({}, copy.now, {going: true, said: '', bad: false})});
            }
            else {
                this.frozen = null;
            }
        },
        'queue.landed': function () {
            if ((this.path !== null) && this.queue.landed_dirs.includes(this.path)) {
                this.reread_soon();
            }
        },
        // One chosen name is the one a rename starts from; nothing chosen asks nothing about it
        chosen_names: function (value) {
            if (value.length === 1) {
                this.new_name = value[0];
            }
            if ((value.length === 0) && (this.mode !== 'folder')) {
                this.mode = '';
            }
        },
    },
    methods: {
        plural,
        format_bytes,
        format_ms_ago,
        open: async function (where) {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading…', false);
            this.act_report('', false);
            try {
                const answer = await fetch(`${this.base}?path=${encodeURIComponent(where)}`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.path = outcome.path;
                this.typed = outcome.path;
                this.items = outcome.items;
                this.$emit('path', outcome.path);
                this.crumbs_end();
                this.now = Date.now();
                this.chosen = {};
                this.report(`${outcome.items.length} ${plural(outcome.items.length, 'entry', 'entries')}`, false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        // The folder asked for first, or the nearest one on its way there that is: a link may
        // name a folder deleted since, and a page that only says so has nowhere to go
        open_nearest: async function (where) {
            await this.open(where);
            let at = where;
            while ((this.path === null) && (at.lastIndexOf('/') > 0)) {
                at = at.slice(0, at.lastIndexOf('/'));
                await this.open(at);
            }
            if ((this.path === null) && at.startsWith('/') && (at !== '/')) {
                at = '/';
                await this.open(at);
            }
            if ((at !== where) && (this.path !== null)) {
                this.act_report(`${where} is not there: the nearest folder on its way is shown`, true);
            }
        },
        // One quiet read for all that lands within a second
        reread_soon: function () {
            if (this.reread_timer !== null) {
                return;
            }
            const self = this;
            this.reread_timer = setTimeout(function () {
                self.reread_timer = null;
                self.reread();
            }, REREAD_MS);
        },
        // The folder shown, read again in place: nothing greys, the bar keeps what it said, and
        // a tick stays on a name that is still there. A walk elsewhere meanwhile wins; a read
        // under way may have started before the file was in, so this one waits for it.
        reread: async function () {
            const path = this.path;
            if (path === null) {
                return;
            }
            if (this.busy) {
                this.reread_soon();
                return;
            }
            try {
                const answer = await fetch(`${this.base}?path=${encodeURIComponent(path)}`, {cache: 'no-store'});
                const outcome = await answer.json();
                if ((answer.ok === false) || (this.path !== path) || this.busy) {
                    return;
                }
                this.items = outcome.items;
                this.now = Date.now();
                for (const name of Object.keys(this.chosen)) {
                    if (outcome.items.some(v => v.name === name) === false) {
                        delete this.chosen[name];
                    }
                }
            }
            catch {
                // The next landing reads it again
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // Every walk to another folder comes here: an open file with changes asks first
        go: function (where) {
            if ((this.open_file !== null) && this.dirty) {
                this.leave_to = where;
                this.edit_ask = 'leave';
                return;
            }
            this.file_forget();
            this.open(where);
        },
        refresh: function () {
            if (this.open_file === null) {
                this.open(this.path);
                return;
            }
            if (this.dirty) {
                this.edit_ask = 'reload';
                return;
            }
            this.file_open(this.open_file);
        },
        // Text small enough to hold in a page is opened here; everything else in a tab of its own
        is_editable: function (item) {
            return (item.kind === 'file') && (item.size !== null) && (item.size <= EDIT_MAX_BYTES) && (RE_NOT_TEXT.test(item.name) === false);
        },
        // A plain click opens the file here; a click with a key held, or a middle click, keeps
        // what a link does
        name_click: function (item, event) {
            if ((this.is_editable(item) === false) || event.ctrlKey || event.metaKey || event.shiftKey || (event.button !== 0)) {
                return;
            }
            event.preventDefault();
            this.file_open(item);
        },
        download_one: function (file) {
            return `${this.base}/file${url_path(file.path)}`;
        },
        file_open: async function (item) {
            const path = (item.path === undefined) ? `${this.path}/${item.name}` : item.path;
            this.editor_destroy();
            this.open_file = {name: item.name, path, size: item.size, mtime_ms: item.mtime_ms, state: 'loading', error: ''};
            this.edit_ask = '';
            this.edit_report('', false);
            this.dirty = false;
            this.language = language_of(item.name);
            let bytes;
            try {
                const answer = await fetch(this.download_one(this.open_file), {cache: 'no-store'});
                if (answer.ok === false) {
                    const said = await answer.json().catch(() => null);
                    throw new Error((said === null) ? `the server answered ${answer.status}` : said.error);
                }
                bytes = new Uint8Array(await answer.arrayBuffer());
            }
            catch (error) {
                this.open_file.state = 'error';
                this.open_file.error = error.message;
                return;
            }
            // A zero byte near the start is a file that is not text, whatever its name says
            if (bytes.subarray(0, 8000).includes(0)) {
                this.open_file.state = 'binary';
                return;
            }
            this.original_text = new TextDecoder('utf-8').decode(bytes);
            this.open_file.size = bytes.length;
            this.open_file.state = 'ready';
            await this.editor_make(this.original_text);
        },
        file_close: function () {
            if (this.dirty) {
                this.edit_ask = 'close';
                return;
            }
            this.file_forget();
        },
        file_forget: function () {
            this.editor_destroy();
            this.open_file = null;
            this.dirty = false;
            this.edit_ask = '';
            this.edit_report('', false);
        },
        // What a question about unsaved changes does when the answer is to drop them
        discard: function (asked) {
            this.dirty = false;
            this.edit_ask = '';
            if (asked === 'close') {
                this.file_forget();
                return;
            }
            if (asked === 'leave') {
                this.go(this.leave_to);
                return;
            }
            this.file_open(this.open_file);
        },
        save_then_go: async function () {
            const asked = this.edit_ask;
            const ok = await this.save(false);
            if (ok) {
                this.discard(asked);
            }
        },
        // The text goes back the way a copied file goes in, over the one that is there. What was
        // changed on the machine since it was read here is not written over without a word.
        save: async function (overwrite) {
            if (this.saving || (this.editor === null)) {
                return false;
            }
            const file = this.open_file;
            const dir = file.path.slice(0, file.path.lastIndexOf('/')) || '/';
            this.saving = true;
            this.edit_report('saving…', false);
            try {
                if (overwrite !== true) {
                    const now = await this.file_stat(dir, file.name);
                    if ((now !== null) && ((now.mtime_ms !== file.mtime_ms) || (now.size !== file.size))) {
                        this.edit_ask = 'conflict';
                        this.edit_report('', false);
                        return false;
                    }
                }
                const text = this.editor.state.doc.toString();
                const answer = await fetch(`${this.base}/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`, {method: 'POST', body: new Blob([text], {type: 'text/plain'})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.edit_report(outcome.error, true);
                    return false;
                }
                this.original_text = text;
                this.dirty = false;
                this.edit_ask = '';
                const now = await this.file_stat(dir, file.name);
                if (now !== null) {
                    file.mtime_ms = now.mtime_ms;
                    file.size = now.size;
                }
                this.edit_report(`saved · ${format_bytes(outcome.bytes)}`, false);
                return true;
            }
            catch (error) {
                this.edit_report(error.message || 'the answer never came back', true);
                return false;
            }
            finally {
                this.saving = false;
            }
        },
        // What the machine says about one file now, from a read of its folder
        file_stat: async function (dir, name) {
            const answer = await fetch(`${this.base}?path=${encodeURIComponent(dir)}`, {cache: 'no-store'});
            if (answer.ok === false) {
                return null;
            }
            const outcome = await answer.json();
            return outcome.items.find(v => v.name === name) || null;
        },
        edit_report: function (note, bad) {
            this.edit_note = note;
            this.edit_bad = bad;
        },
        // CodeMirror is loaded the first time a file is opened, and not before: most visits to
        // this tab never open one
        editor_make: async function (text) {
            const cm = (await import('codemirror')).default;
            this.cm = cm;
            this.look_part = new cm.Compartment();
            this.language_part = new cm.Compartment();
            this.wrap_part = new cm.Compartment();
            const self = this;
            const state = cm.EditorState.create({
                doc: text,
                extensions: [
                    cm.basicSetup,
                    cm.keymap.of([cm.indentWithTab, {key: 'Mod-s', preventDefault: true, run: function () {
                        self.save(false);
                        return true;
                    }}]),
                    this.look_part.of(this.look_of(cm)),
                    this.language_part.of(this.language_of(cm)),
                    this.wrap_part.of(this.wrap ? cm.EditorView.lineWrapping : []),
                    cm.EditorView.updateListener.of(function (update) {
                        if (update.docChanged) {
                            self.dirty = editor_changed(update.state.doc, self.original_text);
                        }
                    }),
                ],
            });
            this.editor_destroy();
            this.editor = new cm.EditorView({state, parent: this.$refs.editor});
            this.editor.focus();
        },
        editor_destroy: function () {
            if ((this.editor !== undefined) && (this.editor !== null)) {
                this.editor.destroy();
            }
            this.editor = null;
        },
        // The editor wears the page's own colours, so it follows the theme switch like the rest
        look_of: function (cm) {
            const dark = (this.theme === 'dark');
            return [
                cm.EditorView.theme({
                    '&': {height: '100%', backgroundColor: 'var(--panel)', color: 'var(--fg)'},
                    '&.cm-focused': {outline: 'none'},
                    '.cm-scroller': {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px'},
                    '.cm-gutters': {backgroundColor: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--line)'},
                    '.cm-activeLine, .cm-activeLineGutter': {backgroundColor: 'var(--hover)'},
                    '.cm-cursor': {borderLeftColor: 'var(--fg)'},
                    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)'},
                    '.cm-panels': {backgroundColor: 'var(--bg)', color: 'var(--fg)'},
                }, {dark}),
                cm.syntaxHighlighting(dark ? cm.oneDarkHighlightStyle : cm.defaultHighlightStyle),
            ];
        },
        language_of: function (cm) {
            const make = cm.languages[this.language];
            return (make === undefined) ? [] : make();
        },
        editor_look: function () {
            if (this.editor) {
                this.editor.dispatch({effects: this.look_part.reconfigure(this.look_of(this.cm))});
            }
        },
        editor_language: function () {
            if (this.editor) {
                this.editor.dispatch({effects: this.language_part.reconfigure(this.language_of(this.cm))});
            }
        },
        editor_wrap: function () {
            if (this.editor) {
                this.editor.dispatch({effects: this.wrap_part.reconfigure(this.wrap ? this.cm.EditorView.lineWrapping : [])});
            }
        },
        mtime_title: function (item) {
            return (item.mtime_ms === null) ? '' : new Date(item.mtime_ms).toLocaleString();
        },
        sort_by: function (key) {
            this.sort_desc = (this.sort === key) ? this.sort_desc === false : key !== 'name';
            this.sort = key;
        },
        // The bar turns into the one question; its field is where the typing goes
        mode_open: function (mode) {
            this.mode = mode;
            this.act_report('', false);
            if (mode === 'folder') {
                this.folder_name = '';
            }
            if (mode === 'move') {
                this.move_to = this.path;
            }
            // Each time on the first machine offered, the one shown, never the last one picked:
            // a machine kept from a copy before is one nobody looks at the next time
            if (mode === 'copy') {
                this.copy_dir = this.path;
                this.copy_disk = this.targets[0].value;
            }
            const self = this;
            this.$nextTick(function () {
                // Delete asks with buttons alone; it has no field to type in
                if (self.$refs.ask) {
                    self.$refs.ask.focus();
                    self.$refs.ask.select();
                }
            });
        },
        // A long path shows its end, where the open folder is; the start is a scroll away
        crumbs_end: function () {
            const self = this;
            this.$nextTick(function () {
                const crumbs = self.$refs.crumbs;
                if (crumbs) {
                    crumbs.scrollLeft = crumbs.scrollWidth;
                }
            });
        },
        edit_start: function () {
            this.typed = (this.path === null) ? '' : this.path;
            this.editing = true;
            const self = this;
            this.$nextTick(function () {
                if (self.$refs.path_field) {
                    self.$refs.path_field.focus();
                    self.$refs.path_field.select();
                }
            });
        },
        edit_end: function () {
            this.editing = false;
            this.crumbs_end();
        },
        typed_open: function () {
            this.editing = false;
            this.go(this.typed);
        },
        // Only files from outside light the file manager up, and only with a folder shown; a drag
        // of text or a link is not a copy, and an open file takes no drop
        drag_over: function (event) {
            if ((this.can_take === false) || (this.open_file !== null) || (Array.from(event.dataTransfer.types).includes('Files') === false)) {
                return;
            }
            event.preventDefault();
            if (this.dragging === false) {
                this.drop_style = drop_style_of(this.$el.getBoundingClientRect());
                this.dragging = true;
            }
        },
        // Leaving for a part inside the file manager is not leaving it
        drag_leave: function (event) {
            if (this.$el.contains(event.relatedTarget) === false) {
                this.dragging = false;
            }
        },
        choose: function (item, on) {
            if (on) {
                this.chosen[item.name] = true;
            }
            else {
                delete this.chosen[item.name];
            }
        },
        row_chosen: function (item) {
            return (this.chosen[item.name] === true);
        },
        // The names ticked in the list; a name the filter hides keeps its tick
        chosen_set: function (names) {
            const shown = this.items_shown.map(v => v.name);
            const kept = Object.keys(this.chosen).filter(v => (shown.includes(v) === false));
            this.chosen = Object.fromEntries(kept.concat(names).map(v => [v, true]));
        },
        row_click: function (item) {
            if (item.kind === 'dir') {
                this.open(`${this.path}/${item.name}`);
                return;
            }
            this.choose(item, this.chosen[item.name] !== true);
        },
        // A file opens in its own tab, served as what it is — a video plays and can seek. The
        // whole path is the address, so a page finds its style.css one name over.
        file_url: function (item) {
            return `${this.open_root}${url_path(`${this.path}/${item.name}`)}`;
        },
        rename: function () {
            return this.acts([['rename', {from: `${this.path}/${this.chosen_names[0]}`, to: `${this.path}/${this.new_name}`}]], 'renamed');
        },
        move: function () {
            return this.acts(this.chosen_names.map(v => ['rename', {from: `${this.path}/${v}`, to: `${this.move_to}/${v}`}]), 'moved');
        },
        remove: function () {
            return this.acts(this.chosen_names.map(v => ['delete', {path: `${this.path}/${v}`}]), 'deleted');
        },
        folder_make: async function () {
            await this.acts([['mkdir', {path: `${this.path}/${this.folder_name}`}]], 'made');
            if (this.act_bad === false) {
                this.folder_name = '';
            }
        },
        // One change after another, and the folder read again either way: what a stop in the
        // middle left standing is on the screen, not in somebody's guess
        acts: async function (list, done_word) {
            this.acting = true;
            this.act_report('asking the disk…', false);
            let said = [done_word, false];
            try {
                for (const [action, request] of list) {
                    await this.fs_call(action, request);
                }
            }
            catch (error) {
                said = [error.message, true];
            }
            finally {
                this.acting = false;
                if (said[1] === false) {
                    this.mode = '';
                }
                await this.open(this.path);
                this.act_report(said[0], said[1]);
            }
        },
        fs_call: async function (action, request) {
            const answer = await fetch(`${this.base}/${action}`, {method: 'POST', body: JSON.stringify(request)});
            if (answer.ok === false) {
                throw new Error((await answer.json()).error);
            }
        },
        act_report: function (note, bad) {
            this.act_note = note;
            this.act_bad = bad;
        },
        // A folder's dialog names each file by its way from the folder chosen: photos/2024/a.jpg
        picked: function (event) {
            this.take(Array.from(event.target.files).map(v => ({file: v, dir: v.webkitRelativePath.split('/').slice(0, -1).join('/')})), []);
            // The same file chosen twice in a row is two copies, and a picker that remembers
            // the last one would answer the second choice with nothing
            event.target.value = '';
        },
        dropped: function (event) {
            const taken = this.dragging;
            this.dragging = false;
            if (taken === false) {
                return;
            }
            event.preventDefault();
            this.transfer_take(event.dataTransfer);
        },
        // Ctrl+V with files or a folder in the clipboard, anywhere but a field or the editor: they
        // are copied here as a drop would be. A paste of text is left to the page.
        pasted: function (event) {
            if ((this.active === false) || (this.open_file !== null) || (this.can_take === false)) {
                return;
            }
            if ((event.target.closest !== undefined) && (event.target.closest('input, textarea, select, [contenteditable]') !== null)) {
                return;
            }
            if (Array.from(event.clipboardData.types).includes('Files') === false) {
                return;
            }
            event.preventDefault();
            this.transfer_take(event.clipboardData);
        },
        // A drop or a paste, read before the browser empties it: a folder file by file
        transfer_take: async function (transfer) {
            this.counting = {files: 0, bytes: 0, stop: false, shown: false};
            const counting = this.counting;
            const timer = setTimeout(function () {
                counting.shown = true;
            }, COUNTING_SHOWN_MS);
            const read = await data_transfer_read(transfer, true, this.counting);
            clearTimeout(timer);
            this.counting = null;
            if (read.stopped) {
                return;
            }
            this.queue.refuse(read.unread, 'not sent: the browser could not read it; a folder also goes by Upload folder');
            await this.take(read.files, read.dirs);
        },
        // Before a copy of more than one file: does it fit on that disk, in bytes and in inodes
        // (a file and a folder are one each)? When not, the page asks: what fits, in the order
        // they go, or nothing. A disk that cannot say lets everything go. files: [{file, dir}]
        room_check: async function (path, files, dirs) {
            const folders = folders_all(files.map(v => v.dir).concat(dirs).filter(v => v !== ''));
            const bytes = files.reduce((sum, v) => sum + v.file.size, 0);
            let room = null;
            try {
                const answer = await fetch(`${this.base}/room?path=${encodeURIComponent(path)}`, {cache: 'no-store'});
                room = answer.ok ? await answer.json() : null;
            }
            catch {
                room = null;
            }
            const inodes_short = (room !== null) && (room.inodes_free !== null) && (files.length + folders.length > room.inodes_free);
            if ((room === null) || ((bytes <= room.bytes_free) && (inodes_short === false))) {
                return {files, dirs};
            }
            const fit = files_that_fit(files, room);
            const said = [`Not room enough on ${this.title ? this.title : 'this disk'} for all of it.`];
            said.push(`${format_bytes(room.bytes_free)} free, this needs ${format_bytes(bytes)}.`);
            if (room.inodes_free !== null) {
                said.push(`Inodes: ${files.length + folders.length} needed, ${room.inodes_free} free.`);
            }
            this.room_ask = {files: files.length, bytes, text: said.join(' '), fit_files: fit.files.length, fit_bytes: fit.bytes};
            const self = this;
            const yes = await new Promise(function (resolve) {
                self.room_resolve = resolve;
            });
            this.room_ask = null;
            return yes ? {files: fit.files, dirs: []} : null;
        },
        room_answer: function (yes) {
            this.room_resolve(yes);
        },
        // Choosing is the act, and the copy follows it, into the folder shown now. files: [{file,
        // dir}], `dir` the way under this folder. The files join Uploads at once; when their turn
        // comes their folders are made first, the deepest of each branch the way mkdir -p does:
        // a container's disk writes a file only into a folder that is there, and an empty folder
        // has no file to bring it. Only empty folders, with no file to wait for, are made now.
        take: async function (files_asked, dirs_asked) {
            const path = this.path;
            const sorted = files_asked.slice().sort((a, b) => file_label(a).localeCompare(file_label(b), undefined, {numeric: true}));
            const room = ((sorted.length > 1) || (dirs_asked.length > 0)) ? await this.room_check(path, sorted, dirs_asked) : {files: sorted, dirs: dirs_asked};
            if (room === null) {
                return;
            }
            const files = room.files;
            const dirs = room.dirs;
            const made = folders_deepest(files.map(v => v.dir).concat(dirs).filter(v => v !== ''));
            // A folder's names come in the order the disk keeps them: they go A to Z, by path
            const list = files.map(v => ({file: v.file, dir: (v.dir === '') ? path : `${path}/${v.dir}`, label: file_label(v)}));
            if (list.length > 0) {
                this.queue.take(list, {path, folders: made});
                return;
            }
            const why = await this.queue.folders_make(path, made);
            this.act_report((why === '') ? `${made.length} ${plural(made.length, 'folder', 'folders')} made` : why, (why !== ''));
        },
        // One copy for each file or folder ticked, into the folder named on the machine picked;
        // the host runs them one after another
        copy_start: async function () {
            this.acting = true;
            this.act_report('asking for the copies…', false);
            let said = ['the copy is on its way, below', false];
            try {
                for (const name of this.chosen_names) {
                    const answer = await fetch(this.transfers, {method: 'POST', body: JSON.stringify({from: {disk: this.disk, path: `${this.path}/${name}`}, to: {disk: this.copy_disk, dir: this.copy_dir}})});
                    if (answer.ok === false) {
                        throw new Error((await answer.json()).error);
                    }
                }
                this.mode = '';
                this.chosen = {};
            }
            catch (error) {
                said = [error.message, true];
            }
            finally {
                this.acting = false;
                this.act_report(said[0], said[1]);
                this.transfers_read();
            }
        },
        // What the host says about the copies; asked again every second while one is under way.
        // A copy that lands in the folder shown reads the folder again.
        transfers_read: async function () {
            clearTimeout(this.transfers_timer);
            if (!this.transfers) {
                return;
            }
            try {
                const answer = await fetch(this.transfers, {cache: 'no-store'});
                if (answer.ok) {
                    const before = this.transfer_items;
                    const read = await answer.json();
                    this.transfer_items = read.items;
                    this.transfers_paused = (read.paused === true);
                    const landed = this.transfer_items.filter(v => (v.phase === 'ok') && (v.to.disk === this.disk) && (v.to.dir === this.path) && before.some(vv => (vv.id === v.id) && (vv.phase !== 'ok')));
                    if (landed.length > 0) {
                        this.reread_soon();
                    }
                }
            }
            catch {
                // The next read tries again
            }
            if (this.transfer_going) {
                this.transfers_timer = setTimeout(this.transfers_read, TRANSFERS_POLL_MS);
            }
        },
        // Pause and Resume are the host's: one copy goes at a time, for every machine
        transfers_pause: async function () {
            this.transfers_paused = true;
            await fetch(`${this.transfers}/pause`, {method: 'POST'});
            this.transfers_read();
        },
        transfers_resume: async function () {
            this.transfers_paused = false;
            await fetch(`${this.transfers}/resume`, {method: 'POST'});
            this.transfers_read();
        },
        // Cancel stops every copy of this disk, as it stops every upload: the ones in line first,
        // so none of them starts as the one under way ends
        transfers_cancel: async function () {
            const going = this.transfers_here.filter(transfer_going_of);
            const order = going.filter(v => v.phase === 'waiting').concat(going.filter(v => v.phase !== 'waiting'));
            for (const item of order) {
                await fetch(`${this.transfers}/${item.id}/cancel`, {method: 'POST'});
            }
            this.transfers_read();
        },
        transfers_clear: async function () {
            await fetch(`${this.transfers}/clear`, {method: 'POST'});
            this.transfers_read();
        },
        target_label: function (name) {
            const found = Array.isArray(this.targets) ? this.targets.find(v => v.value === name) : undefined;
            return (found === undefined) ? name : found.label;
        },
        // Where a copy goes, or where it comes from, in a few words: the folder by its last name
        transfer_where: function (item) {
            if (item.from.disk === this.disk) {
                return `to ${this.target_label(item.to.disk)}, ${item.to.dir.split('/').filter(v => v !== '').pop() || '/'}`;
            }
            return `from ${this.target_label(item.from.disk)}`;
        },
        // A copy that is over: where it went and how much; for a folder, how many files
        transfer_done: function (item) {
            const said = [this.transfer_where(item)];
            if (item.kind === 'dir') {
                said.push(`${item.files_done} ${plural(item.files_done, 'file', 'files')}`);
            }
            said.push(format_bytes(item.size), 'done');
            return said.join(' · ');
        },
        // The same, with what a folder's copy left out, each name and why, a line each
        transfer_done_title: function (item) {
            const names = ((item.left === undefined) || (item.left === null)) ? [] : item.left.names;
            return [this.transfer_done(item)].concat((item.said === '') ? [] : [item.said], names.map(v => `${v.path}: ${v.said}`)).join('\n');
        },
        copy_retry: function (item) {
            return `${item.said} — trying again in ${item.wait_s}s · ${format_bytes(item.sent)} of ${format_bytes(item.size)} is in`;
        },
    },
    mounted: function () {
        // The editor lives outside what vue watches: it is a large object that changes itself
        this.editor = null;
        this.open_nearest(this.start ? this.start : '');
        // A tab closed with an edit that is not saved asks first, the way a browser can
        const self = this;
        this.unload_guard = function (event) {
            if (self.dirty) {
                event.preventDefault();
            }
        };
        addEventListener('beforeunload', this.unload_guard);
        document.addEventListener('paste', this.pasted);
        // A timer is not something vue watches
        this.reread_timer = null;
        this.transfers_read();
    },
    unmounted: function () {
        removeEventListener('beforeunload', this.unload_guard);
        document.removeEventListener('paste', this.pasted);
        clearTimeout(this.reread_timer);
        this.editor_destroy();
        clearTimeout(this.transfers_timer);
    },
    // A tab kept aside stops asking about copies, and asks again when it is shown
    activated: function () {
        this.active = true;
        this.transfers_read();
    },
    deactivated: function () {
        this.active = false;
        clearTimeout(this.transfers_timer);
    },
};

// The part of the file manager in view, for the drop zone fixed over it
function drop_style_of(rect)
{
    const top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const bottom = Math.min(innerHeight, rect.bottom);
    const right = Math.min(innerWidth, rect.right);
    return {top: `${top}px`, left: `${left}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px`};
}

// Files from outside, dragged anywhere but over a field or an editor that takes them itself
function is_files_drag(event)
{
    if ((event.target.closest !== undefined) && (event.target.closest('input, textarea, [contenteditable]') !== null)) {
        return false;
    }
    return Array.from(event.dataTransfer.types).includes('Files');
}

// {file, dir: 'photos/2024'} -> 'photos/2024/a.jpg': a file by its way from the folder taken
function file_label(item)
{
    return (item.dir === '') ? item.file.name : `${item.dir}/${item.file.name}`;
}

// ['a/b/c', 'd'] -> ['a', 'a/b', 'a/b/c', 'd']: every folder on the way, once
function folders_all(dirs)
{
    const seen = new Set();
    for (const dir of dirs) {
        const parts = dir.split('/');
        for (let i = 1; i <= parts.length; i++) {
            seen.add(parts.slice(0, i).join('/'));
        }
    }
    return Array.from(seen);
}

// The files, in the order they go, as far as the room on the disk reaches: its bytes, less a
// hundredth for what a file system keeps for itself, and its inodes, a folder one each
function files_that_fit(files, room)
{
    const out = {files: [], bytes: 0};
    const folders = new Set();
    const bytes_max = room.bytes_free*0.99;
    for (const item of files) {
        const fresh = folders_all((item.dir === '') ? [] : [item.dir]).filter(v => folders.has(v) === false);
        const inodes = out.files.length + folders.size + fresh.length + 1;
        if ((out.bytes + item.file.size > bytes_max) || ((room.inodes_free !== null) && (inodes > room.inodes_free))) {
            break;
        }
        for (const dir of fresh) {
            folders.add(dir);
        }
        out.files.push(item);
        out.bytes += item.file.size;
    }
    return out;
}

// ['a', 'a/b', 'a/b/c', 'd'] -> ['a/b/c', 'd']: each folder no other one is inside of
function folders_deepest(dirs)
{
    const unique = Array.from(new Set(dirs));
    return unique.filter(v => unique.every(vv => (vv.startsWith(`${v}/`) === false)));
}

// "Dockerfile", "nginx.conf", "app.test.js" -> the language to highlight it as
function language_of(name)
{
    const lower = name.toLowerCase();
    if ((lower === 'dockerfile') || lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) {
        return 'dockerfile';
    }
    if ((lower === 'makefile') || lower.startsWith('.bash') || (lower === '.profile') || (lower === '.zshrc')) {
        return 'shell';
    }
    if (lower.includes('nginx') && lower.endsWith('.conf')) {
        return 'nginx';
    }
    const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    return (LANGUAGE_BY_EXTENSION[extension] === undefined) ? 'text' : LANGUAGE_BY_EXTENSION[extension];
}

// Whether the text differs from what was read; the length first, so a keystroke in a big file
// does not copy the whole of it every time
function editor_changed(doc, original)
{
    if (doc.length !== original.length) {
        return true;
    }
    return doc.toString() !== original;
}

// A copy between machines still to come: in line, under way, or paused halfway
function transfer_going_of(item)
{
    return ['waiting', 'copying', 'retrying', 'paused'].includes(item.phase);
}

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

// A disk path as a url path: each name encoded, the slashes kept
function url_path(text)
{
    return text.split('/').map(encodeURIComponent).join('/');
}

// The age of a thing, said in its one biggest unit: a file from years back does not need its
// minutes read out. format_ms is for the short ranges, where every part still matters.
// A date ahead of now — a machine's clock standing ahead, a file dated forward on purpose —
// is said as "in …" rather than clamped into the past.
function format_ms_ago(ms)
{
    if (ms < -500) {
        return `in ${age_text(-ms)}`;
    }
    return `${age_text(ms)} ago`;
}

function age_text(ms)
{
    const total = Math.max(0, Math.round(ms/1000));
    if (total < 60) {
        return `${total}s`;
    }
    if (total < 3600) {
        return `${Math.floor(total/60)}m`;
    }
    if (total < 86400) {
        return `${Math.floor(total/3600)}h`;
    }
    if (total < 86400*365) {
        return `${Math.floor(total/86400)}d`;
    }
    return `${Math.floor(total/86400/365)}y`;
}

function format_bytes(bytes)
{
    if (typeof bytes !== 'number') {
        return 'unknown';
    }
    const names = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const step = Math.min(names.length - 1, Math.max(0, Math.floor(Math.log(Math.max(1, bytes))/Math.log(1024))));
    const value = bytes/Math.pow(1024, step);
    return `${value.toFixed(((step === 0) || (value >= 100)) ? 0 : 1)}${names[step]}`;
}

function format_ms(ms)
{
    if (ms < 1000) {
        return `${Math.max(0, Math.round(ms))}ms`;
    }
    const total = Math.max(0, Math.round(ms/1000));
    const days = Math.floor(total/86400);
    const hours = Math.floor(total % 86400/3600);
    const minutes = Math.floor(total % 3600/60);
    const seconds = total % 60;
    const items = [];
    if (days > 0) {
        items.push(`${days}d`);
    }
    if (hours > 0) {
        items.push(`${hours}h`);
    }
    if (minutes > 0) {
        items.push(`${minutes}m`);
    }
    if (items.length < 2) {
        items.push(`${seconds}s`);
    }
    return items.join(' ');
}

export default file_manager;
