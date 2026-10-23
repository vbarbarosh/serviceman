import format_bytes from '../../format_bytes.js';
import items_view from '../../items_view.js';

// The packages of one machine, for a web page. The host gives the API, a GET that answers
// {items, commands, manual_known, updates_known}, the colours and its usual classes:
// list-tools, list-right, chip, seg, tag, muted, bad; its list is the page's items-view, drawn
// as the manifest's columns say, imported from the page beside it.

// Every package dpkg keeps on a machine: what each is, how much room it takes, which were
// asked for by name, and which an upgrade would move on. A machine carries a few thousand,
// so a filter comes first and the table shows a screenful until asked for the rest.
const packages = {
    template: `
<article class="packages">
    <items-view :base="base" module="packages" :offline="offline" :connected_at="connected_at" :filter="shown" :filter_name="show" reading="reading… dpkg, then a dry-run upgrade, which takes a second or two" empty="dpkg lists no package on this machine." @answer="answer_read">
        <template #tools="{items}">
            <button v-for="chip of chips_of(items)" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" :title="chip.title" @click="show = chip.value">
                {{ chip.label }}
                <span class="muted">{{ chip.count }}</span>
            </button>
        </template>
        <template #summary="{items}">
            <p v-if="(items.length > 0)" class="muted">{{ summary_of(items) }}</p>
        </template>
        <template #cell-name="{item}">
            <code>{{ item.name }}</code><span v-if="((item.arch !== native) && (item.arch !== 'all'))" class="muted">:{{ item.arch }}</span>
            <span v-if="item.held" class="tag" title="apt-mark hold: an upgrade leaves it where it is">held</span>
            <span v-if="item.broken" class="tag bad" title="dpkg did not finish with it; sudo dpkg --configure -a finishes what was interrupted">half installed</span>
        </template>
        <template #cell-version="{item}">
            <code>{{ item.version }}</code>
            <div v-if="(item.update !== null)" class="package-next">→ <code>{{ item.update.version }}</code><span v-if="item.update.security" class="tag package-security">security</span></div>
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
    },
    data: function () {
        return {show: 'all', native: 'all', manual_known: true, updates_known: true};
    },
    methods: {
        answer_read: function (outcome) {
            this.manual_known = outcome.manual_known;
            this.updates_known = outcome.updates_known;
            this.native = native_of(outcome.items);
        },
        // What the chip on now lets through
        shown: function (item) {
            const show = this.show;
            return (show === 'all') || ((show === 'manual') && item.manual) || ((show === 'update') && (item.update !== null)) || ((show === 'held') && item.held) || ((show === 'broken') && item.broken);
        },
        chips_of: function (items) {
            const out = [
                {value: 'all', label: 'all', count: items.length, title: 'Every installed package'},
                {value: 'manual', label: 'by hand', count: items.filter(v => v.manual).length, title: 'Asked for by name; the rest came along as something else needed them'},
                {value: 'update', label: 'to update', count: items.filter(v => (v.update !== null)).length, title: 'What apt-get upgrade would move on, as of the last apt-get update'},
            ];
            const held = items.filter(v => v.held).length;
            if (held > 0) {
                out.push({value: 'held', label: 'held', count: held, title: 'Kept where they are by apt-mark hold'});
            }
            const broken = items.filter(v => v.broken).length;
            if (broken > 0) {
                out.push({value: 'broken', label: 'half installed', count: broken, title: 'dpkg did not finish with these'});
            }
            return out;
        },
        summary_of: function (items) {
            let size = 0;
            for (const item of items) {
                size += item.size || 0;
            }
            const update = items.filter(v => (v.update !== null));
            const security = update.filter(v => v.update.security).length;
            const parts = [`${items.length} ${plural(items.length, 'package', 'packages')} · ${format_bytes(size)}`];
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
};

// The machine's own architecture, the one most of its packages are built for: only a package
// of another one says which it is
function native_of(items)
{
    const count = {};
    let out = 'all';
    for (const item of items) {
        count[item.arch] = (count[item.arch] || 0) + 1;
        if ((item.arch !== 'all') && ((out === 'all') || (count[item.arch] > count[out]))) {
            out = item.arch;
        }
    }
    return out;
}

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

export default packages;
