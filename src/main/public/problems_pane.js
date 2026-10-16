import format_ms from './format_ms.js';

// What is wrong now, the oldest first: everything serviceman watches and found broken, each with
// where it is, since when, why and what mends it. A problem leaves the list on its own once it
// is mended; nothing here is dismissed by hand.
const problems_pane = {
    template: `
<article id="detail" class="list problems">
    <div class="list-head">
        <h1>Problems</h1>
        <span :class="(problems.length > 0 ? 'bad' : 'muted')">{{ problems.length }}</span>
    </div>
    <p class="muted">Looked at every minute: machines that went offline, lines Logline does not take, containers Docker was meant to keep running, containers whose files are gone, and copies of services that stopped answering. A problem shows once it is seen twice in a row, and goes once it is mended.</p>
    <p v-if="(problems.length === 0)" class="card problems-none">Nothing is wrong that serviceman can see.</p>
    <section v-for="item of problems" :key="item.key" class="card problem">
        <div class="problem-head">
            <b class="problem-subject">{{ item.subject }}</b>
            <button v-if="(item.remote !== null)" type="button" class="tag" :title="('The page of ' + item.remote)" @click="$emit('remote', item.remote)">{{ item.remote }}</button>
            <button v-if="(item.service !== null)" type="button" class="tag" :title="('The page of ' + item.service)" @click="$emit('select', item.service)">{{ item.service }}</button>
            <span class="muted problem-since" :title="when(item.since)">for {{ format_ms(Math.max(0, state.now - item.since)) }}</span>
        </div>
        <p class="problem-cause">{{ item.cause }}</p>
        <p class="muted problem-fix">{{ item.fix }}</p>
    </section>
</article>
`,
    props: ['state'],
    emits: ['remote', 'select'],
    computed: {
        problems: function () {
            return ((this.state.problems === undefined) ? [] : this.state.problems);
        },
    },
    methods: {
        format_ms,
        when: function (ms) {
            return `since ${new Date(ms).toLocaleString()}`;
        },
    },
};

export default problems_pane;
