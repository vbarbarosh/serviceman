import format_bytes from '../../format_bytes.js';
import items_view from '../../items_view.js';

// Everything running on one machine, as a tree, for a web page. The host gives the API, a GET
// that answers {items, commands, cpu_window_ms}, the colours and its usual classes: list-tools,
// list-right, seg, load, meter, muted, bad; its list is the page's items-view, drawn as the
// manifest's columns say, imported from the page beside it.

// Everything running on a machine, as the tree it is: a process sits under the one that
// started it, and a branch folds away. ps is run over there when the pane opens and when Read
// again is pressed — a table this long on a clock would be a machine talking about itself all
// day, and a tree that moves under the hand is one nobody can read.
const processes = {
    template: `
<article class="procs-pane">
    <items-view :base="base" module="processes" :offline="offline" :connected_at="connected_at" @answer="answer_read">
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
        return {window_ms: null};
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
        plural,
        answer_read: function (outcome) {
            this.window_ms = (outcome.cpu_window_ms === undefined) ? null : outcome.cpu_window_ms;
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
