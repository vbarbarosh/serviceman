import command_copy from '../../command_copy.js';
import data_table from '../../data_table.js';
import format_bytes from '../../format_bytes.js';

// The disks of one machine, for a web page. The host gives the API, a GET that answers
// {items, commands}, the colours and its usual classes: list-tools, list-right, chip, meter,
// tag, muted, bad; its tables are the page's data-table and its command button the page's
// command-copy, imported from the page beside it.

// Every filesystem of a machine: the room each has, and the files it may still hold. A disk
// out of inodes refuses new files with space to spare, so the two stand side by side.
// A machine's disks' columns: Disk and Space used never fold, the rest where the pane is
// narrow, Inodes free first and Free last
const DISK_COLUMNS = [
    {key: 'device', label: 'Disk', wraps: true},
    {key: 'mounted', label: 'Mounted at', fold: 4},
    {key: 'type', label: 'Type', fold: 3},
    {key: 'used', label: 'Space used'},
    {key: 'free', label: 'Free', fold: 5},
    {key: 'inodes_used', label: 'Inodes used', fold: 2},
    {key: 'inodes_free', label: 'Inodes free', fold: 1},
];

const disks = {
    template: `
<article class="disks">
    <div class="list-tools">
        <span>{{ summary }}</span>
        <button type="button" class="chip" :class="{on: show_all}" :title="(show_all ? 'Show the disks alone' : 'Show tmpfs, overlay and loop mounts too')" @click="show_all = !show_all">everything mounted <span class="muted">{{ items.length }}</span></button>
        <span class="list-right">
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
            <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
            <command-copy :commands="commands"/>
        </span>
    </div>
    <!-- Disk and Space used never fold; the rest fold where the pane is narrow, Free last -->
    <data-table v-if="(items.length > 0)" :columns="disk_columns" :rows="rows" :row_key="row_key" :more="disk_more" empty="No disks of its own — everything mounted here is tmpfs, overlay or a loop image. The chip above shows them.">
        <template #cell="{row, column, more}">
            <code v-if="(column.key === 'device')" :class="{muted: (row.disk === false)}">{{ row.device }}</code>
            <template v-else-if="(column.key === 'mounted')">
                <code :class="{muted: (row.disk === false)}">{{ row.mounts[0] }}</code>
                <div v-if="(row.mounts.length > 1)" class="muted" :title="row.mounts.slice(1).join(', ')">also at {{ (more ? row.mounts.slice(1).join(', ') : also_text(row.mounts)) }}</div>
                <div v-if="(row.key_of !== undefined && row.key_of !== null)" class="muted">holds the key of {{ row.key_of }}</div>
            </template>
            <span v-else-if="(column.key === 'type')" :class="{muted: (row.disk === false)}">{{ row.type }}<span v-if="row.encrypted" class="tag disk-lock">encrypted</span></span>
            <template v-else-if="(column.key === 'used')">
                <div class="disk-use" :class="{muted: (row.disk === false)}">
                    <span class="meter" :class="level_of(row.used, row.total)"><i :style="{width: (percent_of(row.used, row.total) + '%')}"/></span>
                    <span>{{ percent_of(row.used, row.total) }}%</span>
                </div>
                <div class="muted">{{ format_bytes(row.used) }} of {{ format_bytes(row.total) }}</div>
            </template>
            <span v-else-if="(column.key === 'free')" :class="{muted: (row.disk === false)}">{{ format_bytes(row.free) }}</span>
            <template v-else-if="(column.key === 'inodes_used')">
                <template v-if="(row.inodes_total !== null)">
                    <div class="disk-use" :class="{muted: (row.disk === false)}">
                        <span class="meter" :class="level_of(row.inodes_used, row.inodes_total)"><i :style="{width: (percent_of(row.inodes_used, row.inodes_total) + '%')}"/></span>
                        <span>{{ percent_of(row.inodes_used, row.inodes_total) }}%</span>
                    </div>
                    <div class="muted">{{ count_text(row.inodes_used) }} of {{ count_text(row.inodes_total) }}</div>
                </template>
                <span v-else class="muted">not counted</span>
            </template>
            <span v-else-if="(column.key === 'inodes_free')" :class="{muted: ((row.disk === false) || (row.inodes_total === null))}">{{ ((row.inodes_total === null) ? 'not counted' : count_text(row.inodes_free)) }}</span>
        </template>
    </data-table>
</article>
`,
    components: {'command-copy': command_copy, 'data-table': data_table},
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        // Changes each time the machine dials back in, so a read that failed while it was
        // away is read again
        connected_at: {type: Number, default: null},
    },
    data: function () {
        return {items: [], commands: undefined, show_all: false, note: '', bad: false, busy: false};
    },
    computed: {
        disk_columns: function () {
            return DISK_COLUMNS;
        },
        rows: function () {
            return this.show_all ? this.items : this.items.filter(v => v.disk);
        },
        // The disks together, as the card on the Remotes page counts them
        summary: function () {
            const disks = this.items.filter(v => v.disk);
            if (disks.length === 0) {
                return '';
            }
            let used = 0;
            let total = 0;
            for (const item of disks) {
                used += item.used;
                total += item.total;
            }
            return `${disks.length} ${plural(disks.length, 'disk', 'disks')} · ${format_bytes(used)} of ${format_bytes(total)} used`;
        },
    },
    watch: {
        // A read that failed while the machine was away, or restarting, is read again once it
        // has dialled back in
        connected_at: function () {
            if (this.bad && (this.offline === false)) {
                this.read();
            }
        },
    },
    methods: {
        format_bytes,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading…', false);
            try {
                const answer = await fetch(this.base, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.report('', false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // A device mounted in more places than its row names reads them all in its details
        disk_more: function (row, key) {
            return (key === 'mounted') && (row.mounts.length > 4);
        },
        // The other places a device is mounted at, the first three, as its row says them
        also_text: function (mounts) {
            return `${mounts.slice(1, 4).join(', ')}${(mounts.length > 4) ? ` and ${mounts.length - 4} more` : ''}`;
        },
        // A device may be mounted twice and a tmpfs is mounted everywhere: the two name a row
        row_key: function (item) {
            return `${item.device} ${item.mounts[0]}`;
        },
        percent_of: function (part, whole) {
            return (whole > 0) ? Math.round(part/whole*100) : 0;
        },
        // A disk past nine tenths is one to look at; past three quarters, one to keep an eye on
        level_of: function (part, whole) {
            const percent = this.percent_of(part, whole);
            return (percent >= 90) ? 'full' : ((percent >= 75) ? 'filling' : '');
        },
        // 8775070 -> "8.8M": inodes are a count, not bytes
        count_text: function (count) {
            if (count < 10000) {
                return String(count);
            }
            if (count < 1000000) {
                return `${Math.round(count/1000)}K`;
            }
            return `${(count/1000000).toFixed(1)}M`;
        },
    },
    mounted: function () {
        this.read();
    },
};

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

export default disks;
