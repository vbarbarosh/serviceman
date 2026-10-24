import format_bytes from '../../format_bytes.js';
import format_ms from '../../format_ms.js';
import items_view from '../../items_view.js';

// Everything running on one machine, as a tree, for a web page. The host gives the API, a GET
// that answers {items, commands, cpu_window_ms}, the colours and its usual classes: list-tools,
// list-right, seg, load, meter, muted, bad; its list is the page's items-view, drawn as the
// manifest's columns say, imported from the page beside it.

// Everything running on a machine, as the tree it is: a process sits under the one that
// started it, and a branch folds away. A click on a process opens the ones it started, or
// closes them, and shows it whole: its full command and every number, which a row has no room
// for, in a bar at the foot of the view, so the rows stay where they were clicked. ps is run
// over there when the pane opens and when Read again is pressed — a table this long on a clock
// would be a machine talking about itself all day, and a tree that moves under the hand is one
// nobody can read.
const processes = {
    template: `
<article class="procs-pane">
    <items-view :base="base" module="processes" :offline="offline" :connected_at="connected_at" :pick="v => picked = v.pid" :picked="picked" @answer="answer_read">
        <template #summary="{items, matches}">
            <div v-if="(items.length > 0)" class="procs-summary muted">
                <span>{{ items.length }} {{ plural(items.length, 'process', 'processes') }}</span>
                <span>{{ users_of(items) }} {{ plural(users_of(items), 'user', 'users') }}</span>
                <span :title="cpu_title">CPU {{ cpu_share(items) }}% of {{ cores }} {{ plural(cores, 'core', 'cores') }}<template v-if="(window_ms === null)"> · lifetime averages</template></span>
                <span>RSS {{ format_bytes(rss_of(items)) }}</span>
                <span v-if="(matches !== null)">{{ matches }} {{ plural(matches, 'match', 'matches') }}</span>
            </div>
        </template>
    </items-view>
    <div v-if="(picked !== null)" class="dt-whole">
        <template v-if="(picked_in(items_now) !== null)">
            <div class="dt-whole-head">
                <b>{{ picked }}</b>
                <span class="muted">{{ picked_in(items_now).user }} · started by {{ parent_text(items_now, picked_in(items_now)) }} · {{ picked_in(items_now).state }}</span>
                <button type="button" class="link" @click="picked = null">Close</button>
            </div>
            <code class="proc-command">{{ picked_in(items_now).command }}</code>
            <dl class="proc-numbers">
                <dt>CPU</dt><dd>{{ picked_in(items_now).cpu.toFixed(1) }}%</dd>
                <dt>Memory</dt><dd>{{ picked_in(items_now).mem.toFixed(1) }}% · {{ format_bytes(picked_in(items_now).rss) }} RSS</dd>
                <dt>Running</dt><dd>{{ format_ms(picked_in(items_now).elapsed_ms) }}</dd>
                <dt>Started</dt><dd>{{ children_text(items_now, picked_in(items_now)) }}</dd>
            </dl>
        </template>
        <div v-else class="dt-whole-head">
            <span class="muted">Process {{ picked }} is not running any more.</span>
            <button type="button" class="link" @click="picked = null">Close</button>
        </div>
    </div>
</article>
`,
    components: {'items-view': items_view},
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        // Changes each time the machine dials back in, so a read that failed while it was
        // away is read again
        connected_at: {type: Number, default: null},
        // How many cores the machine has: the processes' CPU together is a share of them all
        cores: {type: Number, default: 1},
    },
    data: function () {
        // picked: the pid of the process shown whole above the tree, or null
        // items_now: the processes as last read, for the picked one's numbers
        return {window_ms: null, picked: null, items_now: []};
    },
    computed: {
        cpu_title: function () {
            if (this.window_ms === null) {
                return 'This agent is older and reports what ps does: each process\'s average over its whole life.';
            }
            return `What each process used over the ${this.window_ms} ms before the list was read; 100% is one whole core.`;
        },
    },
    methods: {
        format_bytes,
        format_ms,
        plural,
        picked_in: function (items) {
            return items.find(v => v.pid === this.picked) || null;
        },
        parent_text: function (items, item) {
            const parent = items.find(v => v.pid === item.ppid);
            return (parent === undefined) ? `${item.ppid}` : `${parent.pid} ${parent.command.split(' ')[0].split('/').pop()}`;
        },
        children_text: function (items, item) {
            const count = items.filter(v => v.ppid === item.pid).length;
            return (count === 0) ? 'nothing' : `${count} ${plural(count, 'process', 'processes')}, under it in the tree`;
        },
        answer_read: function (outcome) {
            this.window_ms = (outcome.cpu_window_ms === undefined) ? null : outcome.cpu_window_ms;
            this.items_now = outcome.items;
        },
        users_of: function (items) {
            return new Set(items.map(v => v.user)).size;
        },
        // Each process is a share of one core, as top shows it; together they are a share of
        // all the machine has
        cpu_share: function (items) {
            return Math.min(100, Math.round(items.reduce((sum, item) => sum + item.cpu, 0)/this.cores));
        },
        rss_of: function (items) {
            return items.reduce((sum, item) => sum + item.rss, 0);
        },
    },
};

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

export default processes;
