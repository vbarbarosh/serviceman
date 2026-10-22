import command_copy from '../../command_copy.js';
import data_table from '../../data_table.js';
import format_bytes from '../../format_bytes.js';

// The packages of one machine, for a web page. The host gives the API, a GET that answers
// {items, commands, manual_known, updates_known}, the colours and its usual classes:
// list-tools, list-right, chip, seg, tag, muted, bad; its tables are the page's data-table and
// its command button the page's command-copy, imported from the page beside it.

// Rows of the package list drawn before the rest are asked for
const PACKAGES_AT_ONCE = 300;

// Every package dpkg keeps on a machine: what each is, how much room it takes, which were
// asked for by name, and which an upgrade would move on. A machine carries a few thousand,
// so a filter comes first and the table shows a screenful until asked for the rest.
// A machine's packages' columns: Package never folds; the rest where the pane is narrow, What
// it is first and Size last
const PACKAGE_COLUMNS = [
    {key: 'name', label: 'Package'},
    {key: 'version', label: 'Version', fold: 4},
    {key: 'size', label: 'Size', fold: 5, align: 'right', hide: v => (v.size === null)},
    {key: 'section', label: 'Section', fold: 2},
    {key: 'installed', label: 'Installed', fold: 3},
    {key: 'summary', label: 'What it is', fold: 1, wraps: true},
];

const packages = {
    template: `
<article class="packages">
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="filter by name, section, what it is" spellcheck="false">
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" :title="chip.title" @click="show = chip.value">
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
        <span class="list-right">
            <span class="muted">Sort by</span>
            <span class="seg">
                <button type="button" :class="{on: (order === 'name')}" @click="order = 'name'">Name</button>
                <button type="button" :class="{on: (order === 'size')}" @click="order = 'size'">Size</button>
            </span>
            <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
            <command-copy :commands="commands"/>
        </span>
    </div>
    <p v-if="(note !== '' || summary !== '')" :class="(bad ? 'bad' : 'muted')">{{ (note !== '' ? note : summary) }}</p>
    <!-- Package never folds, nor its held and half installed; the rest fold where the pane is
         narrow, Size last. A screenful first: the table shows the rest when asked, and a new
         filter starts from a screenful again. -->
    <data-table v-if="(items.length > 0)" :key="(filter + ' ' + show + ' ' + order)" :columns="package_columns" :rows="matching" :row_key="row_key" :limit="at_once" empty="No package here matches.">
        <template #cell="{row, column}">
            <template v-if="(column.key === 'name')">
                <code>{{ row.name }}</code><span v-if="(row.arch !== native && row.arch !== 'all')" class="muted">:{{ row.arch }}</span>
                <span v-if="row.held" class="tag" title="apt-mark hold: an upgrade leaves it where it is">held</span>
                <span v-if="row.broken" class="tag bad" title="dpkg did not finish with it; sudo dpkg --configure -a finishes what was interrupted">half installed</span>
            </template>
            <template v-else-if="(column.key === 'version')">
                <code>{{ row.version }}</code>
                <div v-if="(row.update !== null)" class="package-next">→ <code>{{ row.update.version }}</code><span v-if="row.update.security" class="tag package-security">security</span></div>
            </template>
            <template v-else-if="(column.key === 'size')">{{ ((row.size === null) ? '' : format_bytes(row.size)) }}</template>
            <span v-else-if="(column.key === 'section')" class="muted">{{ row.section }}</span>
            <span v-else-if="(column.key === 'installed')" :class="{muted: (row.manual === false)}">{{ (row.manual ? 'by hand' : 'as a need') }}</span>
            <template v-else-if="(column.key === 'summary')">{{ row.summary }}</template>
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
        return {items: [], commands: undefined, filter: '', show: 'all', order: 'name', at_once: PACKAGES_AT_ONCE, manual_known: true, updates_known: true, note: '', bad: false, busy: false};
    },
    computed: {
        // The machine's own architecture, the one most of its packages are built for: only
        // a package of another one says which it is
        native: function () {
            const count = {};
            let out = 'all';
            for (const item of this.items) {
                count[item.arch] = (count[item.arch] || 0) + 1;
                if ((item.arch !== 'all') && ((out === 'all') || (count[item.arch] > count[out]))) {
                    out = item.arch;
                }
            }
            return out;
        },
        chips: function () {
            const out = [
                {value: 'all', label: 'all', count: this.items.length, title: 'Every installed package'},
                {value: 'manual', label: 'by hand', count: this.items.filter(v => v.manual).length, title: 'Asked for by name; the rest came along as something else needed them'},
                {value: 'update', label: 'to update', count: this.items.filter(v => v.update !== null).length, title: 'What apt-get upgrade would move on, as of the last apt-get update'},
            ];
            const held = this.items.filter(v => v.held).length;
            if (held > 0) {
                out.push({value: 'held', label: 'held', count: held, title: 'Kept where they are by apt-mark hold'});
            }
            const broken = this.items.filter(v => v.broken).length;
            if (broken > 0) {
                out.push({value: 'broken', label: 'half installed', count: broken, title: 'dpkg did not finish with these'});
            }
            return out;
        },
        matching: function () {
            const words = this.filter.toLowerCase().split(/\s+/).filter(v => v !== '');
            const show = this.show;
            const out = this.items.filter(function (item) {
                if (((show === 'manual') && (item.manual === false)) || ((show === 'update') && (item.update === null)) || ((show === 'held') && (item.held === false)) || ((show === 'broken') && (item.broken === false))) {
                    return false;
                }
                const text = `${item.name} ${item.section} ${item.summary}`.toLowerCase();
                return words.every(v => text.includes(v));
            });
            if (this.order === 'size') {
                out.sort((a, b) => (b.size || 0) - (a.size || 0));
            }
            return out;
        },
        package_columns: function () {
            return PACKAGE_COLUMNS;
        },
        summary: function () {
            if (this.items.length === 0) {
                return '';
            }
            let size = 0;
            for (const item of this.items) {
                size += item.size || 0;
            }
            const update = this.items.filter(v => v.update !== null);
            const security = update.filter(v => v.update.security).length;
            const parts = [`${this.items.length} ${plural(this.items.length, 'package', 'packages')} · ${format_bytes(size)}`];
            if (this.updates_known === false) {
                parts.push('apt could not be asked what an upgrade would bring');
            }
            else if (update.length > 0) {
                parts.push(`${update.length} to update${(security > 0) ? `, ${security} of them security` : ''}`);
            }
            else {
                parts.push('nothing to update');
            }
            if (this.manual_known === false) {
                parts.push('apt-mark could not say which were installed by hand');
            }
            return parts.join(' · ');
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
            this.report('reading… dpkg, then a dry-run upgrade, which takes a second or two', false);
            try {
                const answer = await fetch(this.base, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.manual_known = outcome.manual_known;
                this.updates_known = outcome.updates_known;
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
        // libc6:amd64 and libc6:i386 are two rows
        row_key: function (item) {
            return `${item.name}:${item.arch}`;
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

export default packages;
