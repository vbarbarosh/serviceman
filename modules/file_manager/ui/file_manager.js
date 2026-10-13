import data_transfer_read from './data_transfer_read.js';
import upload_queue from './upload_queue.js';

// How often the copies between disks are asked about while one is under way
const TRANSFERS_POLL_MS = 1000;

// Files landing in the folder shown read it again at most this often: a thousand small files
// are a thousand landings
const REREAD_MS = 1000;

// How many folders are asked for at once: a tree of a hundred folders, one after another, is a
// hundred waits on a far machine
const MKDIR_AT_ONCE = 6;

// The rows of Uploads in view at once: two done, the file under way, the next ones. They slide
// up a place as each file lands; Show all lists every one.
const COPY_ROWS = 9;

// Failed rows kept on top of them, the latest
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
// (--bg, --panel, --fg, --muted, --line, --hover, --accent) and its usual classes.
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
            <button v-if="copy_able" type="button" :disabled="(offline || chosen_dirs > 0)" :title="(chosen_dirs > 0 ? 'Folders are not copied to another machine yet' : 'Copy to another machine')" @click="mode_open('copy')">Copy to…</button>
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
    <div v-if="(queue.copies.length > 0)" class="card fm-uploads" :class="{all: copies_all}">
        <div class="list-head">
            <b>Uploads</b>
            <span class="muted fm-copy-summary" :title="copy_summary">{{ copy_summary }}</span>
            <div class="list-acts">
                <button v-if="(queue.copies.length > COPY_ROWS)" type="button" @click="copies_all = (copies_all === false)">{{ (copies_all ? 'Show fewer' : ('Show all ' + queue.copies.length)) }}</button>
                <button v-if="queue.copying" type="button" @click="queue.stop()">Cancel</button>
                <button v-else type="button" @click="queue.clear()">Clear</button>
            </div>
            <span v-if="(copy_total.files > 1)" class="meter fm-copy-total"><i :style="{width: (Math.max(1, Math.round(copy_total.ratio * 100)) + '%')}"/></span>
        </div>
        <transition-group tag="div" name="fm-row" class="fm-copy-rows">
        <div v-for="{item, i} of copy_rows" :key="i" class="fm-copy">
            <code :title="item.label">{{ item.label }}</code>
            <span v-if="(item.phase === 'waiting')" class="muted">{{ format_bytes(item.size) }} — waiting</span>
            <span v-else-if="(item.phase === 'held')" class="muted">{{ format_bytes(item.size) }} — waiting for its folder</span>
            <template v-else-if="(item.phase === 'copying' || item.phase === 'retrying')">
                <span class="meter"><i :style="{width: (Math.max(2, Math.round(copy_ratio(item) * 100)) + '%')}"/></span>
                <span v-if="(item.phase === 'retrying')" class="bad" :title="copy_retry(item)">{{ copy_retry(item) }}</span>
                <span v-else class="muted" :title="copy_detail(item)">{{ copy_detail(item) }}</span>
            </template>
            <span v-else-if="(item.phase === 'ok')" class="muted">{{ format_bytes(item.size) }}{{ (item.replaced ? ' · over the one that was there' : '') }} · done</span>
            <span v-else-if="(item.phase === 'cancelled')" class="muted">stopped — nothing landed</span>
            <span v-else class="bad" :title="item.said">{{ item.said }}</span>
        </div>
        </transition-group>
    </div>
    <!-- Copies between this disk and another, run by the server: they go on with the page closed -->
    <div v-if="(transfers_here.length > 0)" class="card fm-copies">
        <div class="list-head">
            <b>Copies between machines</b>
            <span class="muted">{{ transfer_summary }}</span>
            <div class="list-acts">
                <button type="button" @click="transfers_clear">Clear</button>
            </div>
        </div>
        <div v-for="item of transfers_here" :key="item.id" class="fm-copy">
            <code :title="(item.from.disk + ':' + item.from.path + ' → ' + item.to.disk + ':' + item.to.dir)">{{ item.name }}</code>
            <span v-if="(item.phase === 'waiting')" class="muted">{{ transfer_where(item) }} · waiting</span>
            <template v-else-if="(item.phase === 'copying' || item.phase === 'retrying')">
                <span class="meter"><i :style="{width: (Math.max(2, Math.round(transfer_ratio(item) * 100)) + '%')}"/></span>
                <span class="fm-copy-acts" :class="(item.phase === 'retrying' ? 'bad' : 'muted')"><span :title="transfer_line(item)">{{ transfer_line(item) }}</span><button type="button" class="link" @click="transfer_cancel(item)">Cancel</button></span>
            </template>
            <span v-else-if="(item.phase === 'ok')" class="muted">{{ transfer_where(item) }} · {{ format_bytes(item.size) }} · done</span>
            <span v-else-if="(item.phase === 'cancelled')" class="muted">{{ transfer_where(item) }} · stopped — nothing landed</span>
            <span v-else class="bad" :title="(transfer_where(item) + ' · ' + item.said)">{{ transfer_where(item) }} · {{ item.said }}</span>
        </div>
    </div>
    <div class="card fm-list">
        <table class="list-table fm-table">
            <thead>
                <tr>
                    <th class="fm-pick"><input type="checkbox" aria-label="Tick every name shown" :checked="all_chosen" :disabled="(items_shown.length === 0)" @change="choose_all($event.target.checked)"></th>
                    <th v-for="column of columns" :key="column.key" :class="column.key">
                        <button type="button" class="fm-sort" :class="{on: (sort === column.key)}" @click="sort_by(column.key)">{{ column.label }}<span v-if="(sort === column.key)">{{ sort_desc ? ' ↓' : ' ↑' }}</span></button>
                    </th>
                </tr>
            </thead>
            <tbody>
                <!-- The whole row is the control: a folder opens, a file takes the tick. The
                     checkbox cell keeps clicks to itself, or a tick would also walk. -->
                <tr v-for="item of items_shown" :key="item.name" class="pick" :class="{chosen: (chosen[item.name] === true)}" @click="row_click(item)">
                    <td class="fm-pick" @click.stop><input type="checkbox" :aria-label="('Tick ' + item.name)" :checked="(chosen[item.name] === true)" @change="choose(item, $event.target.checked)"></td>
                    <td class="name">
                        <span class="row-of">
                            <svg v-if="(item.kind === 'dir')" class="fm-dir" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>
                            <svg v-else class="fm-file" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z"/><path d="M13 3v6h6"/></svg>
                            <b v-if="(item.kind === 'dir')">{{ item.name }}</b>
                            <a v-else :href="file_url(item)" target="_blank" rel="noreferrer" :title="(is_editable(item) ? 'Open it here — Ctrl-click opens it in a tab' : 'Open it in a tab of its own')" @click.stop="name_click(item, $event)">{{ item.name }}</a>
                        </span>
                    </td>
                    <td class="size">{{ (item.kind === 'dir' ? '—' : (item.size === null ? '' : format_bytes(item.size))) }}</td>
                    <td class="mtime muted" :title="mtime_title(item)">{{ (item.mtime_ms === null ? '' : format_ms_ago(now - item.mtime_ms)) }}</td>
                </tr>
                <tr v-if="(path !== null && items_shown.length === 0)">
                    <td colspan="4" class="muted fm-empty">{{ empty_text }}</td>
                </tr>
            </tbody>
        </table>
    </div>
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
    props: ['base', 'theme', 'offline', 'open_base', 'title', 'user', 'home_title', 'start', 'transfers', 'disk', 'targets'],
    data: function () {
        return {
            LANGUAGES,
            COPY_ROWS,
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
            // Every upload in the list, not only the few about the file under way
            copies_all: false,
            // Shown, not kept aside: only a tab in view takes a paste
            active: true,
            // The copies between disks the host is running, as it last said
            transfer_items: [],
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
        chosen_dirs: function () {
            return this.items.filter(v => (this.chosen[v.name] === true) && (v.kind === 'dir')).length;
        },
        transfers_here: function () {
            return this.transfer_items.filter(v => (v.from.disk === this.disk) || (v.to.disk === this.disk));
        },
        transfer_summary: function () {
            const done = this.transfers_here.filter(v => v.phase === 'ok').length;
            return `${done} of ${this.transfers_here.length} copied`;
        },
        open_root: function () {
            return (this.open_base ? this.open_base : `${this.base}/file`);
        },
        parent: function () {
            if ((this.path === null) || (this.path === '/')) {
                return null;
            }
            const at = this.path.lastIndexOf('/');
            return ((at === 0) ? '/' : this.path.slice(0, at));
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
            return ((this.crumbs.length === 0) ? '' : this.crumbs[this.crumbs.length - 1].label);
        },
        columns: function () {
            return [{key: 'name', label: 'Name'}, {key: 'size', label: 'Size'}, {key: 'mtime', label: 'Modified'}];
        },
        dot_count: function () {
            return this.items.filter(v => v.name.startsWith('.')).length;
        },
        // Folders first whatever the order, then by the column picked
        items_shown: function () {
            const wanted = this.filter.toLowerCase();
            const out = this.items.filter(v => (this.show_dot_files || (v.name.startsWith('.') === false)) && ((wanted === '') || v.name.toLowerCase().includes(wanted)));
            const sign = (this.sort_desc ? -1 : 1);
            const sort = this.sort;
            out.sort(function (a, b) {
                if ((a.kind === 'dir') !== (b.kind === 'dir')) {
                    return ((a.kind === 'dir') ? -1 : 1);
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
            return ((count === 1) ? this.chosen_names[0] : `${count} items`);
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
                bytes += (((item.kind === 'dir') || (item.size === null)) ? 0 : item.size);
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
            return ((this.act_note !== '') ? this.act_note : (this.bad ? this.note : ''));
        },
        note_bad: function () {
            return ((this.act_note !== '') ? this.act_bad : this.bad);
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
                else if ((item.phase === 'copying') || (item.phase === 'retrying')) {
                    out.bytes_done += item.sent;
                }
                else if (item.phase === 'error') {
                    out.failed++;
                }
                if ((item.began >= this.queue.began) && (item.began > 0)) {
                    out.files_since += ((item.phase === 'ok') ? 1 : 0);
                    out.bytes_since += ((item.phase === 'ok') ? item.size : item.sent) - (((item.began_at === null) || (item.began_at === undefined)) ? 0 : item.began_at);
                }
            }
            out.ratio = ((out.bytes === 0) ? ((out.files === 0) ? 0 : out.files_done/out.files) : out.bytes_done/out.bytes);
            return out;
        },
        // "54 of 3020 files · 120MB of 2.9GB · 1.2MB/s · ~25m left". The rate is the whole copy's,
        // as a file's is. The time left is the longer of two guesses: by bytes, and by files,
        // since a thousand small files are a thousand answers to wait for, whatever their bytes.
        copy_summary: function () {
            const total = this.copy_total;
            const said = [`${total.files_done} of ${total.files} ${plural(total.files, 'file', 'files')}`, `${format_bytes(total.bytes_done)} of ${format_bytes(total.bytes)}`];
            const ms = Date.now() - this.queue.began;
            if (this.queue.copying && (ms > 2000) && (total.bytes_since > 0)) {
                said.push(`${format_bytes(Math.round(total.bytes_since*1000/ms))}/s`);
                const by_bytes = (total.bytes - total.bytes_done)*ms/total.bytes_since;
                const by_files = ((total.files_since > 0) ? (total.files - total.files_done - total.failed)*ms/total.files_since : 0);
                said.push(`~${format_ms(Math.max(by_bytes, by_files))} left`);
            }
            if (total.failed > 0) {
                said.push(`${total.failed} failed`);
            }
            if (this.queue.bad && (this.queue.copying === false)) {
                said.push(this.queue.note);
            }
            return said.join(' · ');
        },
        // The rows of Uploads shown: the few about the file under way, the last failed ones above
        // them, so a thousand files are nine rows that slide, not a list to scroll. [{item, i}]
        copy_rows: function () {
            const rows = this.queue.copies.map((v, i) => ({item: v, i}));
            if (this.copies_all || (rows.length <= COPY_ROWS)) {
                return rows;
            }
            let at = rows.findIndex(v => ['copying', 'retrying', 'waiting', 'held'].includes(v.item.phase));
            if (at < 0) {
                at = rows.length;
            }
            const start = Math.max(0, Math.min(at - 2, rows.length - COPY_ROWS));
            const failed = rows.filter(v => (v.item.phase === 'error') && ((v.i < start) || (v.i >= start + COPY_ROWS))).slice(-COPY_FAILED_ROWS);
            return failed.concat(rows.slice(start, start + COPY_ROWS));
        },
        // Ticks on names the dot-files toggle has hidden do not count
        chosen_names: function () {
            return this.items_shown.filter(v => this.chosen[v.name] === true).map(v => v.name);
        },
        all_chosen: function () {
            return (this.items_shown.length > 0) && (this.chosen_names.length === this.items_shown.length);
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
        'queue.landed': function () {
            if ((this.path !== null) && (this.queue.landed_dir === this.path)) {
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
            const path = ((item.path === undefined) ? `${this.path}/${item.name}` : item.path);
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
            return ((make === undefined) ? [] : make());
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
            return ((item.mtime_ms === null) ? '' : new Date(item.mtime_ms).toLocaleString());
        },
        sort_by: function (key) {
            this.sort_desc = ((this.sort === key) ? this.sort_desc === false : key !== 'name');
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
            if (mode === 'copy') {
                this.copy_dir = this.path;
                if (this.targets.some(v => v.value === this.copy_disk) === false) {
                    this.copy_disk = this.targets[0].value;
                }
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
            this.typed = ((this.path === null) ? '' : this.path);
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
        choose_all: function (on) {
            this.chosen = {};
            if (on) {
                for (const item of this.items_shown) {
                    this.chosen[item.name] = true;
                }
            }
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
            const reading = data_transfer_read(transfer, true);
            this.act_report('reading what came…', false);
            const read = await reading;
            this.act_report('', false);
            this.queue.refuse(read.unread, 'not sent: the browser could not read it; a folder also goes by Upload folder');
            await this.take(read.files, read.dirs);
        },
        // Choosing is the act, and the copy follows it, into the folder shown now. files: [{file,
        // dir}], `dir` the way under this folder. The files show in Uploads at once; the folders
        // are made first, the deepest of each branch the way mkdir -p does: a container's disk
        // writes a file only into a folder that is there, and an empty folder has no file to
        // bring it.
        take: async function (files, dirs) {
            const path = this.path;
            const made = folders_deepest(files.map(v => v.dir).concat(dirs).filter(v => v !== ''));
            // A folder's names come in the order the disk keeps them: they go A to Z, by path
            const list = files.map(v => ((v.dir === '') ? {file: v.file, dir: path, label: v.file.name} : {file: v.file, dir: `${path}/${v.dir}`, label: `${v.dir}/${v.file.name}`}));
            const items = this.queue.take(list.sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric: true})), (made.length > 0));
            if (made.length > 0) {
                const why = await this.folders_make(path, made);
                this.queue.release(items, ((why === '') ? '' : `its folder was not made: ${why}`));
            }
        },
        // The folders asked for a few at a time, the bar counting them; the list shows them once
        // they are there. What comes back is '' or why one was refused.
        folders_make: async function (path, dirs) {
            const self = this;
            let done = 0;
            let why = '';
            const left = dirs.slice();
            this.act_report(`making ${dirs.length} ${plural(dirs.length, 'folder', 'folders')}…`, false);
            async function next() {
                while ((left.length > 0) && (why === '')) {
                    const dir = left.shift();
                    try {
                        await self.fs_call('mkdir', {path: `${path}/${dir}`});
                        done++;
                        self.act_report(`making ${dirs.length} ${plural(dirs.length, 'folder', 'folders')}: ${done} made`, false);
                    }
                    catch (error) {
                        why = `${dir}: ${error.message}`;
                    }
                }
            }
            await Promise.all(Array.from({length: Math.min(MKDIR_AT_ONCE, dirs.length)}, next));
            this.act_report(((why === '') ? `${done} ${plural(done, 'folder', 'folders')} made` : why), (why !== ''));
            await this.reread();
            return why;
        },
        // One copy for each file ticked, into the folder named on the machine picked; the host
        // runs them one after another
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
                    this.transfer_items = (await answer.json()).items;
                    const landed = this.transfer_items.filter(v => (v.phase === 'ok') && (v.to.disk === this.disk) && (v.to.dir === this.path) && before.some(vv => (vv.id === v.id) && (vv.phase !== 'ok')));
                    if (landed.length > 0) {
                        this.reread_soon();
                    }
                }
            }
            catch {
                // The next read tries again
            }
            if (this.transfers_here.some(v => (v.phase === 'waiting') || (v.phase === 'copying') || (v.phase === 'retrying'))) {
                this.transfers_timer = setTimeout(this.transfers_read, TRANSFERS_POLL_MS);
            }
        },
        transfer_cancel: async function (item) {
            await fetch(`${this.transfers}/${item.id}/cancel`, {method: 'POST'});
            this.transfers_read();
        },
        transfers_clear: async function () {
            await fetch(`${this.transfers}/clear`, {method: 'POST'});
            this.transfers_read();
        },
        target_label: function (name) {
            const found = (Array.isArray(this.targets) ? this.targets.find(v => v.value === name) : undefined);
            return ((found === undefined) ? name : found.label);
        },
        // Where a copy goes, or where it comes from, in a few words: the folder by its last name
        transfer_where: function (item) {
            if (item.from.disk === this.disk) {
                return `to ${this.target_label(item.to.disk)}, ${item.to.dir.split('/').filter(v => v !== '').pop() || '/'}`;
            }
            return `from ${this.target_label(item.from.disk)}`;
        },
        transfer_ratio: function (item) {
            return (((item.size === null) || (item.size === 0)) ? 0 : item.received/item.size);
        },
        // What has gone over, how fast this run carried it, and what that leaves
        transfer_detail: function (item) {
            if (item.size === null) {
                return `${this.transfer_where(item)} · weighing the file…`;
            }
            const said = [this.transfer_where(item), `${format_bytes(item.received)} of ${format_bytes(item.size)}`];
            const before = ((item.began_at === null) ? 0 : item.began_at);
            const ms = item.ms;
            const sent = item.received - before;
            if (before > 0) {
                said.push(`carried on from ${format_bytes(before)}`);
            }
            if ((ms > 1000) && (sent > 0)) {
                said.push(`${format_bytes(Math.round(sent*1000/ms))}/s`);
                said.push(`~${format_ms((item.size - item.received)*ms/sent)} left`);
            }
            return said.join(' · ');
        },
        // A copy under way, or why it waits to try again
        transfer_line: function (item) {
            if (item.phase === 'retrying') {
                return `${this.transfer_where(item)} · ${item.said} — trying again in ${item.wait_s}s`;
            }
            return this.transfer_detail(item);
        },
        copy_retry: function (item) {
            return `${item.said} — trying again in ${item.wait_s}s · ${format_bytes(item.sent)} of ${format_bytes(item.size)} is in`;
        },
        copy_ratio: function (item) {
            return ((item.size === 0) ? 1 : item.sent/item.size);
        },
        // The numbers under the bar, in the words this page uses for a download: what has gone
        // over, how fast, and what that leaves. The rate is the whole copy's, not the last
        // second's — a number that stands still is easier to read than one that jumps. What
        // was in before this page carried the copy on is not counted into it.
        copy_detail: function (item) {
            const ms = Date.now() - item.began;
            const ratio = this.copy_ratio(item);
            const before = (((item.began_at === null) || (item.began_at === undefined)) ? 0 : item.began_at);
            const sent = item.sent - before;
            const said = [`${format_bytes(item.sent)} of ${format_bytes(item.size)}`];
            if (before > 0) {
                said.push(`carried on from ${format_bytes(before)}`);
            }
            if ((ms > 1000) && (sent > 0)) {
                said.push(`${format_bytes(Math.round(sent*1000/ms))}/s`);
            }
            if ((ratio < 1) && (ms > 1000) && (sent > item.size*0.01)) {
                said.push(`~${format_ms((item.size - item.sent)*ms/sent)} left`);
            }
            if (ratio >= 1) {
                // The bytes are over the link; the machine is still writing the last of them
                // down, and a big file is a moment of exactly that
                said.push('waiting for the disk to say where it landed');
            }
            return said.join(' · ');
        },
    },
    mounted: function () {
        // The editor lives outside what vue watches: it is a large object that changes itself
        this.editor = null;
        this.open(this.start ? this.start : '');
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
    const extension = (lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '');
    return ((LANGUAGE_BY_EXTENSION[extension] === undefined) ? 'text' : LANGUAGE_BY_EXTENSION[extension]);
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

function plural(count, one, many)
{
    return ((count === 1) ? one : many);
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
