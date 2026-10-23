import format_bytes from '../../format_bytes.js';
import items_view from '../../items_view.js';

// The disks of one machine, for a web page. The host gives the API, a GET that answers
// {items, commands}, the colours and its usual classes: list-tools, list-right, chip, meter,
// tag, muted, bad; its list is the page's items-view, drawn as the manifest's columns say,
// imported from the page beside it.

// Every filesystem of a machine: the room each has, and the files it may still hold. A disk
// out of inodes refuses new files with space to spare, so the two stand side by side.
const disks = {
    template: `
<article class="disks">
    <items-view :base="base" module="disks" :offline="offline" :connected_at="connected_at" :filter="(show_all ? null : (v => v.disk))" :filter_name="(show_all ? 'all' : 'disks')" :row_class="v => ((v.disk === false) ? 'dim' : [])" :more="(v, key) => ((key === 'mounts') && (v.mounts.length > 4))" empty="Nothing is mounted on this machine." none_shown="No disks of its own — everything mounted here is tmpfs, overlay or a loop image. The chip above shows them.">
        <template #tools="{items}">
            <span>{{ summary_of(items) }}</span>
            <button type="button" class="chip" :class="{on: show_all}" :title="(show_all ? 'Show the disks alone' : 'Show tmpfs, overlay and loop mounts too')" @click="show_all = (show_all === false)">everything mounted <span class="muted">{{ items.length }}</span></button>
        </template>
        <template #cell-mounts="{item, more}">
            <code>{{ item.mounts[0] }}</code>
            <div v-if="(item.mounts.length > 1)" class="muted" :title="item.mounts.slice(1).join(', ')">also at {{ (more ? item.mounts.slice(1).join(', ') : also_text(item.mounts)) }}</div>
            <div v-if="((item.key_of !== undefined) && (item.key_of !== null))" class="muted">holds the key of {{ item.key_of }}</div>
        </template>
        <template #cell-type="{item}">{{ item.type }}<span v-if="item.encrypted" class="tag disk-lock">encrypted</span></template>
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
        return {show_all: false};
    },
    methods: {
        // The disks together, as the card on the Remotes page counts them
        summary_of: function (items) {
            const disks = items.filter(v => v.disk);
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
        // The other places a device is mounted at, the first three, as its row says them
        also_text: function (mounts) {
            return `${mounts.slice(1, 4).join(', ')}${(mounts.length > 4) ? ` and ${mounts.length - 4} more` : ''}`;
        },
    },
};

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

export default disks;
