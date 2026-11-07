import items_view from '../../items_view.js';

// The critical CVEs of one machine, for a web page. The host gives the API, a GET that answers
// {at, reason, codename, kernel, list, items}, the colours and its usual classes: chip, tag,
// muted, bad, warn; its list is the page's items-view, drawn as the manifest's columns say,
// imported from the page beside it.

// Every critical CVE that hits the machine as Ubuntu's own list says it, what can be mended
// first: the CVE (its link opens Ubuntu's page of it), its score, what it hits, what mends it,
// whether it is new. A click on a row says Ubuntu's stopgap where it gives one, and the start of
// what the CVE is (a kernel's is its whole commit message): the rest on Ubuntu's page.
const vulnerabilities = {
    template: `
<article class="vulnerabilities">
    <items-view :base="base" module="vulnerabilities" :offline="offline" :connected_at="connected_at" :filter="shown" :filter_name="show" :more="more" reading="reading… the machine's last Security look" :empty="empty" @answer="answer_read">
        <template #tools="{items}">
            <button v-for="chip of chips_of(items)" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" :title="chip.title" @click="show = chip.value">
                {{ chip.label }}
                <span class="muted">{{ chip.count }}</span>
            </button>
        </template>
        <template #summary="{items}">
            <p v-if="((reason === null) && (list_line !== ''))" class="muted">{{ summary_of(items) }} {{ list_line }}</p>
        </template>
        <template #cell-id="{item}">
            <a :href="item.url" target="_blank" rel="noopener" :title="('Ubuntu\\'s page of ' + item.id)"><code>{{ item.id }}</code></a>
            <span v-if="item.new" class="tag vulnerability-new" title="Found since the problems bar was last closed on this machine">new</span>
        </template>
        <template #cell-score="{item}">
            <span :class="{bad: ((item.score !== null) && (item.score >= 9))}">{{ ((item.score === null) ? '—' : item.score) }}</span>
        </template>
        <template #cell-fix="{item, more}">
            <span :class="fix_class(item)">{{ item.fix }}</span>
            <template v-if="more">
                <div v-if="(item.stopgap !== null)" class="vulnerability-stopgap"><b class="warn">Ubuntu's stopgap until the fix</b><pre>{{ item.stopgap }}</pre></div>
                <div v-if="(item.description !== null)" class="vulnerability-text" :title="item.description">{{ item.description }}</div>
                <a :href="item.url" target="_blank" rel="noopener" class="vulnerability-more">All of it on Ubuntu's page</a>
            </template>
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
        return {show: 'all', reason: null, list_line: ''};
    },
    computed: {
        empty: function () {
            return (this.reason === null) ? 'No critical CVE hits this machine, as Ubuntu\'s list says it.' : `Not judged: ${this.reason}.`;
        },
    },
    methods: {
        answer_read: function (outcome) {
            this.reason = (outcome.reason === undefined) ? null : outcome.reason;
            this.list_line = list_line_of(outcome);
        },
        // What the chip on now lets through
        shown: function (item) {
            const show = this.show;
            return (show === 'all') || ((show === 'fix') && fixable(item)) || ((show === 'wait') && (fixable(item) === false)) || ((show === 'new') && item.new);
        },
        // The description and the stopgap open in the row's bar
        more: function (item, key) {
            return (key === 'fix') && ((item.description !== null) || (item.stopgap !== null));
        },
        // No chips where there is nothing to narrow
        chips_of: function (items) {
            if (items.length === 0) {
                return [];
            }
            const out = [{value: 'all', label: 'all', count: items.length, title: 'Every critical CVE that hits this machine'}];
            const fix = items.filter(fixable).length;
            if (fix > 0) {
                out.push({value: 'fix', label: 'fix out', count: fix, title: 'A fix is out: install the updates, or restart into the fixed kernel'});
            }
            const wait = items.length - fix;
            if (wait > 0) {
                out.push({value: 'wait', label: 'no fix yet', count: wait, title: 'Ubuntu has no fix out yet, or only Ubuntu Pro has one'});
            }
            const fresh = items.filter(v => v.new).length;
            if (fresh > 0) {
                out.push({value: 'new', label: 'new', count: fresh, title: 'Found since the problems bar was last closed on this machine'});
            }
            return out;
        },
        summary_of: function (items) {
            if (items.length === 0) {
                return '';
            }
            const fix = items.filter(fixable).length;
            return `${items.length} critical ${(items.length === 1) ? 'CVE hits' : 'CVEs hit'} this machine: ${fix} with a fix out, ${items.length - fix} waiting on Ubuntu.`;
        },
        fix_class: function (item) {
            return fixable(item) ? 'bad' : 'warn';
        },
    },
};

function fixable(item)
{
    return (item.state === 'fix_out') || (item.state === 'restart');
}

// Which of Ubuntu's lists it was held against
function list_line_of(outcome)
{
    if ((outcome.list === null) || (outcome.list === undefined) || (outcome.codename === null)) {
        return '';
    }
    const written = (outcome.list.generated === null) ? '' : `, written ${outcome.list.generated.replace('T', ' ').slice(0, 16)} UTC`;
    return `Held against Ubuntu's list for ${outcome.codename}${written}; kernel ${outcome.kernel} runs.`;
}

export default vulnerabilities;
