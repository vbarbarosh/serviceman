import file_manager from 'file_manager/file_manager.js';
import items_view from '../../items_view.js';
import terminal from 'terminal/terminal.js';

// Every container of one machine, each compose project together: what runs, from which
// image, on which ports, since when — and the few things done to it most often. A project is
// updated the way it is by hand in its folder, its output shown as it comes; a container
// opens in place, its files in the File Manager and a shell in the Terminal. The host page
// gives the API, the colours and its usual classes: card, list-head, dot, muted, bad; its lists
// are the page's items-view, drawn as the manifest's columns say, imported from the page beside
// it.
const docker = {
    template: `
<article class="dk">
    <!-- A container or a volume, opened: its files through the File Manager, a shell through the
         Terminal -->
    <template v-if="(open !== null)">
        <div class="list-head dk-open-head">
            <button type="button" @click="close_open">← {{ (tab === 'volumes' ? 'Volumes' : 'Containers') }}</button>
            <b :title="open.title">{{ open.title }}</b>
            <span class="muted" :title="open.subtitle">{{ open.subtitle }}</span>
            <div class="list-acts">
                <button v-if="(open.files !== null)" type="button" class="chip" :class="{on: (open.what === 'files')}" @click="open.what = 'files'">Files</button>
                <button v-if="(open.shell !== null)" type="button" class="chip" :class="{on: (open.what === 'shell')}" @click="open.what = 'shell'">Shell</button>
            </div>
        </div>
        <file-manager v-if="(open.what === 'files')" :key="('files-' + open.key)" :base="open.files" :start="open.start" :theme="theme" :offline="offline" :title="open.title" :home_title="open.home_title"/>
        <terminal v-else :key="('shell-' + open.key)" class="dk-terminal" :url="open.shell" :theme="theme" :restart="true">
            <template #head><span/></template>
        </terminal>
    </template>
    <template v-else>
        <!-- Containers, images, volumes and networks, one at a time, each with its count -->
        <div class="list-head dk-tabs">
            <button v-for="item of TABS" :key="item.value" type="button" class="chip" :class="{on: (tab === item.value)}" @click="tab_open(item.value)">{{ item.label }} <span class="muted">{{ count_of(item.value) }}</span></button>
            <span v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
            <span v-else-if="(tab === 'containers' && containers !== null)" class="muted">{{ summary }}</span>
            <div class="list-acts">
                <template v-if="(pruning !== '')">
                    <span class="bad">{{ PRUNE_ASKS[pruning] }}</span>
                    <button type="button" class="danger" @click="prune(pruning)">Remove</button>
                    <button type="button" @click="pruning = ''">Cancel</button>
                </template>
                <template v-else>
                    <button v-if="(tab === 'images')" type="button" :disabled="(busy || running_now || offline)" title="Images with no name left, which a newer pull replaced" @click="pruning = 'images'">Prune dangling…</button>
                    <button v-if="(tab === 'images')" type="button" :disabled="(busy || running_now || offline)" title="Every image no container was made from" @click="pruning = 'images-all'">Prune unused…</button>
                    <button v-if="(tab === 'volumes')" type="button" :disabled="(busy || running_now || offline)" title="Every volume no container mounts, and what is in it" @click="pruning = 'volumes'">Prune unused…</button>
                    <button v-if="(tab === 'networks')" type="button" :disabled="(busy || running_now || offline)" title="Every network no container is on" @click="pruning = 'networks'">Prune unused…</button>
                    <button type="button" :disabled="(busy || running_now || offline)" @click="tab_read">Read again</button>
                </template>
            </div>
        </div>
        <!-- A long action as it goes: that it runs and for how long, which step, how far, what is
             left, and what it printed -->
        <div v-if="(run !== null)" class="card dk-run">
            <div class="list-head">
                <span v-if="(run.phase === 'running')" class="dk-spin" aria-label="running"/>
                <b>{{ run.title }}</b>
                <span :class="(run.phase === 'failed' ? 'bad' : 'muted')">{{ run_said }}</span>
                <div class="list-acts">
                    <button v-if="(run.text !== '')" type="button" class="link" @click="run.log = !run.log">{{ run.log ? 'Hide the log' : 'Show the log' }}</button>
                    <button type="button" :disabled="(run.phase === 'running')" @click="run = null">Close</button>
                </div>
            </div>
            <div v-if="(run.progress !== null && run.progress.total > 0)" class="dk-progress">
                <span class="meter"><i :style="{width: (Math.max(1, Math.round(run_ratio * 100)) + '%')}"/></span>
                <span class="muted">{{ run_progress_text }}</span>
            </div>
            <pre v-show="run.log" ref="output" class="dk-output">{{ run.text }}</pre>
        </div>
        <!-- Containers, each compose project together under a row of its own: its name, its
             folder, and Update or Down and up for the whole project -->
        <items-view v-if="((tab === 'containers') && (containers !== null))" class="dk-table" :items="container_rows" module="docker" kind="containers" :head="false" actions_label="Change" empty="No containers on this machine, running or not.">
            <template #group_head="{group}">
                <div class="dk-group-head">
                    <b>{{ group_of(group).title }}</b>
                    <span class="muted" :title="group_of(group).dir">{{ group_of(group).counts }}{{ (group_of(group).dir === null ? '' : ' · ' + group_of(group).dir) }}</span>
                    <div v-if="(group_of(group).project !== null && group_of(group).dir !== null)" class="list-acts">
                        <template v-if="(asking === group_of(group).project)">
                            <span class="bad">Take every container of {{ group_of(group).project }} down, then up again?</span>
                            <button type="button" class="danger" @click="project_act(group_of(group).project, 'recreate')">Down and up</button>
                            <button type="button" @click="asking = ''">Cancel</button>
                        </template>
                        <template v-else>
                            <button type="button" class="primary" :disabled="(acting !== '' || running_now || offline)" title="docker compose pull, then up -d: only what changed is made again" @click="project_act(group_of(group).project, 'update')">Update</button>
                            <button type="button" :disabled="(acting !== '' || running_now || offline)" title="docker compose pull, down, up -d: every container is made again" @click="asking = group_of(group).project">Down and up…</button>
                        </template>
                    </div>
                </div>
            </template>
            <template #cell-name="{item}">
                <span class="dot" :class="dot_of(item)"/>
                <b>{{ (item.service === null ? item.name : item.service) }}</b>
                <span v-if="(item.service !== null)" class="muted dk-cut" :title="item.name">{{ item.name }}</span>
            </template>
            <template #cell-image="{item, more}"><span class="muted" :class="{'dk-cut': (more === false)}" :title="item.image">{{ item.image }}</span></template>
            <template #cell-ports="{item}"><span class="muted">{{ item.ports.join(', ') }}</span></template>
            <template #cell-status="{item}"><span :class="{bad: (dot_of(item) === 'failed')}">{{ item.status }}</span></template>
            <template #actions="{item, ask}">
                <template v-if="(item.state === 'running')">
                    <button v-if="files_able" type="button" :disabled="running_now" @click="container_open(item, 'files')">Files</button>
                    <button v-if="shell_able" type="button" :disabled="running_now" @click="container_open(item, 'shell')">Shell</button>
                </template>
                <span v-if="item.own" class="muted" title="Started and stopped by its service">run by its service</span>
                <template v-else-if="(item.state !== 'running')">
                    <button type="button" :disabled="(acting !== '' || running_now || offline)" @click="container_act(item, 'start')">Start</button>
                    <button type="button" class="danger" :disabled="(acting !== '' || running_now || offline)" title="Take the container away; its image and volumes stay" @click="ask('Remove it?', 'Remove', () => container_act(item, 'remove'))">Remove…</button>
                </template>
                <template v-else>
                    <button type="button" :disabled="(acting !== '' || running_now || offline)" @click="container_act(item, 'restart')">Restart</button>
                    <button type="button" :disabled="(acting !== '' || running_now || offline)" @click="container_act(item, 'stop')">Stop</button>
                </template>
            </template>
        </items-view>
        <!-- Images: what each is called, how big, how old, which containers were made from it -->
        <items-view v-else-if="((tab === 'images') && (images !== null))" class="dk-table" :items="images_sorted" module="docker" kind="images" actions_label="Change" empty="No images on this machine.">
            <template #cell-tags="{item}"><b class="dk-cut" :title="item.tags.join(', ')">{{ (item.tags.length === 0 ? '<none>' : item.tags.join(', ')) }}</b></template>
            <template #cell-id="{item}"><span class="muted">{{ short_id(item.id) }}</span></template>
            <template #cell-used_by="{item, more}"><span :class="{muted: (item.used_by.length === 0), 'dk-cut': (more === false)}" :title="item.used_by.join(', ')">{{ (item.used_by.length === 0 ? 'unused' : item.used_by.join(', ')) }}{{ (item.read_only ? ' · read-only' : '') }}</span></template>
            <template #actions="{item, ask}">
                <button v-if="(item.tags.length > 0)" type="button" :disabled="(acting !== '' || running_now || offline)" :title="('docker pull ' + item.tags[0])" @click="pull(item)">Pull</button>
                <button type="button" class="danger" :disabled="(item.used_by.length > 0 || item.read_only || acting !== '' || running_now || offline)" :title="(item.read_only ? 'In a store this engine may only read' : (item.used_by.length > 0 ? 'A container was made from it' : 'Take it off the machine'))" @click="ask('Remove it?', 'Remove', () => remove('images', bare_id(item.id)))">Remove…</button>
            </template>
        </items-view>
        <!-- Volumes: whose they are, and which containers mount them -->
        <items-view v-else-if="((tab === 'volumes') && (volumes !== null))" class="dk-table" :items="volumes_sorted" module="docker" kind="volumes" actions_label="Change" empty="No volumes on this machine.">
            <template #cell-name="{item}"><b class="dk-cut" :title="item.name">{{ volume_label(item.name) }}</b></template>
            <template #cell-project="{item, more}"><span class="muted" :class="{'dk-cut': (more === false)}" :title="item.project">{{ item.project }}</span></template>
            <template #cell-used_by="{item, more}"><span :class="{muted: (item.used_by.length === 0), 'dk-cut': (more === false)}" :title="item.used_by.join(', ')">{{ (item.used_by.length === 0 ? 'unused' : item.used_by.join(', ')) }}</span></template>
            <template #actions="{item, ask}">
                <button v-if="(volume_way(item) !== null)" type="button" :disabled="(opening !== '' || running_now || offline)" :title="volume_way(item).subtitle" @click="volume_open(item)">{{ (opening === item.name ? 'opening…' : 'Files') }}</button>
                <button type="button" class="danger" :disabled="(item.used_by.length > 0 || acting !== '' || running_now || offline)" :title="(item.used_by.length > 0 ? 'A container mounts it' : 'Take it off the machine, with what is in it')" @click="ask('Remove it, and what is in it?', 'Remove', () => remove('volumes', item.name))">Remove…</button>
            </template>
        </items-view>
        <!-- Networks: whose they are, their addresses, and which containers are on them -->
        <items-view v-else-if="((tab === 'networks') && (networks !== null))" class="dk-table" :items="networks_sorted" module="docker" kind="networks" actions_label="Change" empty="No networks on this machine.">
            <template #cell-name="{item}"><b class="dk-cut" :title="item.name">{{ item.name }}</b></template>
            <template #cell-project="{item, more}"><span class="muted" :class="{'dk-cut': (more === false)}" :title="item.project">{{ item.project }}</span></template>
            <template #cell-subnet="{item, more}"><span class="muted" :class="{'dk-cut': (more === false)}" :title="item.subnet">{{ item.subnet }}</span></template>
            <template #cell-used_by="{item, more}"><span :class="{muted: (item.used_by.length === 0), 'dk-cut': (more === false)}" :title="item.used_by.join(', ')">{{ (item.used_by.length === 0 ? 'none' : item.used_by.join(', ')) }}</span></template>
            <template #actions="{item, ask}">
                <span v-if="item.builtin" class="muted">built in</span>
                <button v-else type="button" class="danger" :disabled="(item.used_by.length > 0 || acting !== '' || running_now || offline)" :title="(item.used_by.length > 0 ? 'A container is on it' : 'Take it off the machine')" @click="ask('Remove it?', 'Remove', () => remove('networks', item.id))">Remove…</button>
            </template>
        </items-view>
    </template>
</article>
`,
    components: {'file-manager': file_manager, 'items-view': items_view, terminal},
    // base        where the API is: GET base/containers, POST base/containers/<id>/<action>…
    // offline     true greys out everything that asks the machine
    // theme       light or dark, for the File Manager's editor and the Terminal
    // files_base  container -> where the File Manager's API for its files is; none, no Files
    // shell_url   container -> the websocket of a shell in it; none, no Shell
    // streams     where the host lists the streams it keeps, GET streams?base=…: a long action
    //             still running is shown again when the page opens; none, it is not looked for
    props: ['base', 'offline', 'theme', 'files_base', 'shell_url', 'streams'],
    data: function () {
        return {
            TABS,
            PRUNE_ASKS,
            tab: tab_kept(),
            containers: null,
            images: null,
            volumes: null,
            networks: null,
            // The prune being asked about: images, images-all, volumes or networks
            pruning: '',
            busy: false,
            note: '',
            bad: false,
            // The container being started, stopped or restarted, by id
            acting: '',
            // The project whose "down and up" is being asked about; a row's removal is asked in
            // its own actions (data-table's ask)
            asking: '',
            // The long action under way or last done: {title, phase, said, text, log, progress,
            // step, began, ms}
            run: null,
            // Ticks once a second while something runs, for the panel's clock
            now: Date.now(),
            // A container or a volume opened in place of the list: {key, title, subtitle, files,
            // start, home_title, shell, helper, what: files | shell}; helper is the volume whose
            // helper container is closed with it
            open: null,
            // The volume whose helper container is being started
            opening: '',
        };
    },
    computed: {
        files_able: function () {
            return typeof this.files_base === 'function';
        },
        shell_able: function () {
            return typeof this.shell_url === 'function';
        },
        images_sorted: function () {
            return (this.images === null) ? [] : this.images.slice().sort((a, b) => (a.tags[0] || '~').localeCompare(b.tags[0] || '~') || (b.created_ms - a.created_ms));
        },
        volumes_sorted: function () {
            return (this.volumes === null) ? [] : this.volumes.slice().sort((a, b) => a.name.localeCompare(b.name));
        },
        networks_sorted: function () {
            return (this.networks === null) ? [] : this.networks.slice().sort((a, b) => a.name.localeCompare(b.name));
        },
        // What the panel says beside its title: the step it is on and the time so far while it
        // runs, then how it ended
        run_said: function () {
            const run = this.run;
            if (run.phase !== 'running') {
                return `${run.said}${(run.ms === undefined) ? '' : ` · ${this.clock_text(run.ms)}`}`;
            }
            const step = (run.step === null) ? '' : `step ${run.step.at} of ${run.step.of}: ${run.step.name} · `;
            return `${step}${this.clock_text(this.now - run.began)}`;
        },
        // How far, as a share; a finished action stands full, whatever its last word said
        run_ratio: function () {
            const progress = this.run.progress;
            if (this.run.phase === 'done') {
                return 1;
            }
            return ((progress === null) || (progress.total === 0)) ? 0 : progress.done/progress.total;
        },
        // How far, in what it counts, and the time left at the rate so far
        run_progress_text: function () {
            const progress = this.run.progress;
            const said = [`${Math.round(this.run_ratio*100)}%`];
            if (progress.unit === 'bytes') {
                said.push(`${format_bytes(progress.done)} of ${format_bytes(progress.total)}`);
            }
            else {
                said.push(`${progress.done} of ${progress.total}`);
                if (progress.bytes > 0) {
                    said.push(`up to ${format_bytes(progress.bytes)} freed`);
                }
            }
            const ms = this.now - progress.since;
            const gone = progress.done - progress.from;
            if ((this.run.phase === 'running') && (gone > 0) && (ms > 2000) && (progress.done < progress.total)) {
                said.push(`~${this.clock_text(ms*(progress.total - progress.done)/gone)} left`);
            }
            return said.join(' · ');
        },
        running_now: function () {
            return (this.run !== null) && (this.run.phase === 'running');
        },
        summary: function () {
            if (this.containers === null) {
                return 'Containers';
            }
            const up = this.containers.filter(v => v.state === 'running').length;
            return `${this.containers.length} ${plural(this.containers.length, 'container', 'containers')}, ${up} running`;
        },
        // Every container in the order of its group
        container_rows: function () {
            return this.groups.flatMap(v => v.containers);
        },
        // Each compose project by its name, then everything that belongs to none
        groups: function () {
            const out = [];
            const by_project = {};
            const alone = [];
            for (const item of ((this.containers === null) ? [] : this.containers)) {
                if (item.project === null) {
                    alone.push(item);
                    continue;
                }
                if (by_project[item.project] === undefined) {
                    by_project[item.project] = {key: `p:${item.project}`, project: item.project, title: item.project, dir: item.dir, containers: []};
                    out.push(by_project[item.project]);
                }
                by_project[item.project].containers.push(item);
            }
            out.sort((a, b) => a.title.localeCompare(b.title));
            if (alone.length > 0) {
                out.push({key: 'alone', project: null, title: 'Not in a compose project', dir: null, containers: alone});
            }
            for (const group of out) {
                group.containers.sort((a, b) => ((a.state === 'running') === (b.state === 'running')) ? a.name.localeCompare(b.name) : ((a.state === 'running') ? -1 : 1));
                const up = group.containers.filter(v => v.state === 'running').length;
                group.counts = `${up} of ${group.containers.length} running`;
            }
            return out;
        },
    },
    watch: {
        // A tab that failed while the machine was away is read again once it is back
        offline: function (value) {
            if ((value === false) && this.bad) {
                this.tab_read();
            }
        },
    },
    methods: {
        read: async function () {
            this.busy = true;
            try {
                const answer = await fetch(`${this.base}/containers`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.containers = outcome.items;
                this.report('', false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        container_act: async function (item, action) {
            this.acting = item.id;
            this.asking = '';
            this.report(`${CONTAINER_DOING[action]} ${item.name}…`, false);
            try {
                const answer = await fetch(`${this.base}/containers/${item.id}/${action}`, {method: 'POST'});
                if (answer.ok === false) {
                    this.report((await answer.json()).error, true);
                    return;
                }
                this.report('', false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.acting = '';
                await this.read();
            }
        },
        // The steps run on the machine one after another; their output comes in as they print it
        project_act: function (project, action) {
            this.asking = '';
            return this.run_stream(`${project} · ${ACTION_LABELS[action]}`, `${this.base}/projects/${encodeURIComponent(project)}/${action}`);
        },
        // An image pulled again under its name, its progress as it comes
        pull: function (item) {
            return this.run_stream(`pull ${item.tags[0]}`, `${this.base}/images/${bare_id(item.id)}/pull`);
        },
        // A command on the machine whose answer is text written as it goes, shown as it comes
        // The answer is one JSON object a line: {text}, {progress}, {step, steps, name}, {end, said}
        // A long action, its lines read as it goes. A host that keeps streams answers where to
        // read them, and the action goes on there whatever this page does; one that does not
        // answers with the lines themselves.
        run_stream: async function (title, url) {
            const run = this.run_begin(title, Date.now());
            try {
                const asked = await fetch(url, {method: 'POST'});
                if (asked.ok === false) {
                    run.said = (await asked.json()).error;
                    run.phase = 'failed';
                    return;
                }
                const answer = (asked.status === 202) ? await fetch((await asked.json()).url, {cache: 'no-store'}) : asked;
                await this.run_follow(run, answer);
            }
            catch {
                run.phase = 'failed';
                run.said = 'the answer never came back';
            }
            finally {
                await this.run_over(run);
            }
        },
        // A long action asked for before this page opened, still running: shown again, from its
        // first line
        run_find: async function () {
            if ((this.streams === undefined) || (this.streams === null)) {
                return;
            }
            try {
                const listed = await fetch(`${this.streams}?base=${encodeURIComponent(this.base)}`, {cache: 'no-store'});
                const found = listed.ok ? (await listed.json()).items.find(v => v.ended_at === null) : undefined;
                if ((found === undefined) || (this.run !== null)) {
                    return;
                }
                const run = this.run_begin(found.title, found.started_at);
                try {
                    await this.run_follow(run, await fetch(found.url, {cache: 'no-store'}));
                }
                catch {
                    run.phase = 'failed';
                    run.said = 'the answer never came back';
                }
                finally {
                    await this.run_over(run);
                }
            }
            catch {
                // Nothing found is nothing shown
            }
        },
        run_begin: function (title, began) {
            this.run = {title, phase: 'running', said: '', text: '', log: false, progress: null, step: null, began};
            this.clock_start();
            return this.run;
        },
        run_follow: async function (run, answer) {
            if (answer.ok === false) {
                run.said = (await answer.json()).error;
                run.phase = 'failed';
                return;
            }
            const reader = answer.body.getReader();
            const decoder = new TextDecoder();
            let held = '';
            for (;;) {
                const part = await reader.read();
                if (part.done) {
                    break;
                }
                held += decoder.decode(part.value, {stream: true});
                const lines = held.split('\n');
                held = lines.pop();
                for (const line of lines) {
                    this.run_line(run, line);
                }
            }
            this.run_line(run, held);
            if (run.phase === 'running') {
                run.phase = 'failed';
                run.said = 'the answer stopped before the end';
            }
        },
        run_over: async function (run) {
            run.ms = Date.now() - run.began;
            this.clock_stop();
            await this.tab_read();
        },
        run_line: function (run, line) {
            if (line.trim() === '') {
                return;
            }
            const item = JSON.parse(line);
            if (item.step !== undefined) {
                run.step = {at: item.step, of: item.steps, name: item.name};
            }
            if (item.progress !== undefined) {
                // The first word of progress is where the clock for its rate starts
                run.progress = Object.assign({since: (run.progress === null) ? Date.now() : run.progress.since, from: (run.progress === null) ? item.progress.done : run.progress.from}, item.progress);
            }
            if (item.text !== undefined) {
                run.text += `${item.text}\n`;
                this.output_end();
            }
            if (item.end !== undefined) {
                run.phase = item.end;
                run.said = item.said;
            }
        },
        // A clock for the panel while something runs: the time so far, and what is left
        clock_start: function () {
            this.clock_stop();
            const self = this;
            this.clock = setInterval(function () {
                self.now = Date.now();
            }, 1000);
        },
        clock_stop: function () {
            if (this.clock !== undefined) {
                clearInterval(this.clock);
                this.clock = undefined;
            }
        },
        // "2m 05s", the short way a clock says it
        clock_text: function (ms) {
            const total = Math.max(0, Math.round(ms/1000));
            return (total < 60) ? `${total}s` : `${Math.floor(total/60)}m ${String(total % 60).padStart(2, '0')}s`;
        },
        tab_open: function (tab) {
            this.tab = tab;
            tab_keep(tab);
            this.asking = '';
            this.pruning = '';
            this.report('', false);
            this.tab_read();
        },
        // What the tab shown lists, read again
        tab_read: async function () {
            if (this.tab === 'containers') {
                await this.read();
                return;
            }
            const tab = this.tab;
            this.busy = true;
            try {
                const answer = await fetch(`${this.base}/${tab}`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this[tab] = outcome.items;
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        remove: async function (kind, key) {
            this.asking = '';
            this.acting = key;
            this.report(`removing ${(kind === 'images') ? key.slice(0, 12) : key}…`, false);
            try {
                const answer = await fetch(`${this.base}/${kind}/${encodeURIComponent(key)}/remove`, {method: 'POST'});
                this.report(answer.ok ? '' : (await answer.json()).error, (answer.ok === false));
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.acting = '';
            }
            await this.tab_read();
        },
        // One thing at a time on the machine, so the panel can say how far it is
        prune: function (asked) {
            this.pruning = '';
            const kind = asked.replace(/-all$/, '');
            return this.run_stream(PRUNE_TITLES[asked], `${this.base}/${kind}/prune${asked.endsWith('-all') ? '?all=1' : ''}`);
        },
        count_of: function (tab) {
            const list = this[tab];
            return (list === null) ? '' : list.length;
        },
        short_id: function (id) {
            return id.replace(/^sha256:/, '').slice(0, 12);
        },
        format_bytes,
        bare_id,
        // How long ago, in its one biggest unit
        ago: function (ms) {
            const total = Math.max(0, Math.round((Date.now() - ms)/1000));
            const units = [[86400*365, 'y'], [86400, 'd'], [3600, 'h'], [60, 'm']];
            for (const [size, letter] of units) {
                if (total >= size) {
                    return `${Math.floor(total/size)}${letter} ago`;
                }
            }
            return `${total}s ago`;
        },
        // The newest line in view, as a terminal keeps it
        output_end: function () {
            const self = this;
            this.$nextTick(function () {
                if (self.$refs.output) {
                    self.$refs.output.scrollTop = self.$refs.output.scrollHeight;
                }
            });
        },
        container_open: async function (item, what) {
            if ((what === 'files') && (await this.files_check(this.files_base(item), '') === false)) {
                return;
            }
            this.open = {
                key: item.id,
                title: item.name,
                subtitle: item.image,
                files: this.files_able ? this.files_base(item) : null,
                start: '',
                home_title: 'The container\'s working folder',
                shell: this.shell_able ? this.shell_url(item) : null,
                what,
            };
        },
        // How a volume's files are reached: through a running container that mounts it, at the
        // path it sees them under; or else through a helper container started to mount it. The
        // folder on the machine is not used: a rootful docker keeps it where only root may look.
        volume_way: function (item) {
            if (this.files_able === false) {
                return null;
            }
            const mount = Array.isArray(item.mounts) ? item.mounts.find(v => v.running) : undefined;
            if (mount === undefined) {
                return {helper: true, subtitle: `through a helper container, at ${HELPER_PATH}`, mount: null};
            }
            return {helper: false, subtitle: `through ${mount.name}, at ${mount.destination}`, mount};
        },
        volume_open: async function (item) {
            const way = this.volume_way(item);
            let id = (way.mount === null) ? null : way.mount.id;
            let start = (way.mount === null) ? HELPER_PATH : way.mount.destination;
            if (way.helper) {
                this.opening = item.name;
                this.report('starting a helper container that mounts the volume…', false);
                try {
                    const answer = await fetch(`${this.base}/volumes/${encodeURIComponent(item.name)}/open`, {method: 'POST'});
                    const outcome = await answer.json();
                    if (answer.ok === false) {
                        this.report(outcome.error, true);
                        return;
                    }
                    id = outcome.id;
                    start = outcome.path;
                    this.report('', false);
                }
                catch {
                    this.report('the answer never came back', true);
                    return;
                }
                finally {
                    this.opening = '';
                }
            }
            if (await this.files_check(this.files_base({id}), start) === false) {
                if (way.helper) {
                    fetch(`${this.base}/volumes/${encodeURIComponent(item.name)}/close`, {method: 'POST'}).catch(function () {});
                }
                return;
            }
            this.open = {
                key: `volume-${item.name}`,
                title: `volume ${this.volume_label(item.name)}`,
                subtitle: way.subtitle,
                files: this.files_base({id}),
                start,
                home_title: way.helper ? 'The helper container\'s root' : `${way.mount.name}'s working folder`,
                shell: this.shell_able ? this.shell_url({id}) : null,
                helper: way.helper ? item.name : null,
                what: 'files',
            };
        },
        // Whether the folder can be read at all, asked before the File Manager is shown in place
        // of the list: a folder that refuses says so in the bar, and the list stays
        files_check: async function (files, start) {
            this.report('looking in…', false);
            try {
                const answer = await fetch(`${files}?path=${encodeURIComponent(start)}`, {cache: 'no-store'});
                if (answer.ok === false) {
                    this.report(`no way in: ${(await answer.json()).error}`, true);
                    return false;
                }
                this.report('', false);
                return true;
            }
            catch {
                this.report('the answer never came back', true);
                return false;
            }
        },
        // The way back to the list; a helper container goes with the volume it was opened for
        close_open: function () {
            const helper = (this.open === null) ? null : this.open.helper;
            this.open = null;
            if ((helper !== null) && (helper !== undefined)) {
                fetch(`${this.base}/volumes/${encodeURIComponent(helper)}/close`, {method: 'POST'}).catch(function () {});
            }
        },
        // An anonymous volume's name is 64 characters of hex: the first twelve say it
        volume_label: function (name) {
            return /^[0-9a-f]{64}$/.test(name) ? `${name.slice(0, 12)}…` : name;
        },
        // A group of the containers by its compose project, null for those of none
        group_of: function (project) {
            return this.groups.find(v => (v.project === project));
        },
        dot_of: function (item) {
            if (item.state === 'running') {
                return 'running';
            }
            if (item.state === 'restarting') {
                return 'starting';
            }
            if ((item.state === 'dead') || ((item.state === 'exited') && (/\(0\)/.test(item.status) === false))) {
                return 'failed';
            }
            return '';
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
    mounted: function () {
        this.tab_read();
        this.run_find();
    },
    // A helper container is not left behind by a page that goes elsewhere
    unmounted: function () {
        this.close_open();
    },
};

// Where a helper container sees the volume it was started for
const HELPER_PATH = '/volume';

// The tab last shown, kept for the page whichever machine it shows next, and for a reload
const TAB_KEY = 'docker.tab';
let tab_last = null;

// What each project action is called on the screen
const ACTION_LABELS = {update: 'update', recreate: 'down and up'};

// The four lists of a machine's docker, as the tabs show them
const TABS = [
    {value: 'containers', label: 'Containers'},
    {value: 'images', label: 'Images'},
    {value: 'volumes', label: 'Volumes'},
    {value: 'networks', label: 'Networks'},
];

// What the bar says while a container's action is under way
const CONTAINER_DOING = {start: 'starting', stop: 'stopping', restart: 'restarting', remove: 'removing'};

// What each prune is called in the panel while it runs
const PRUNE_TITLES = {
    'images': 'Removing dangling images',
    'images-all': 'Removing unused images',
    'volumes': 'Removing unused volumes',
    'networks': 'Removing unused networks',
};

// What each prune asks before it removes anything
const PRUNE_ASKS = {
    'images': 'Remove every image with no name left?',
    'images-all': 'Remove every image no container was made from?',
    'volumes': 'Remove every volume no container mounts, with what is in it?',
    'networks': 'Remove every network no container is on?',
};

function tab_kept()
{
    if (tab_last === null) {
        try {
            tab_last = localStorage.getItem(TAB_KEY);
        }
        catch {
            tab_last = null;
        }
    }
    return TABS.some(v => v.value === tab_last) ? tab_last : 'containers';
}

function tab_keep(tab)
{
    tab_last = tab;
    try {
        localStorage.setItem(TAB_KEY, tab);
    }
    catch {
        // A browser that keeps nothing still keeps the tab for as long as the page is open
    }
}

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

// An image's id without its "sha256:", the way the engine takes it in an address too
function bare_id(id)
{
    return id.replace(/^sha256:/, '');
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

export default docker;
