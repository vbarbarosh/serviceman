import CATEGORIES from './categories.js';
import format_ms_ago from './format_ms_ago.js';
import page_head from './page_head.js';

// How many items a big tile draws one mark each for; past it, one bar split by share
const MARKS_MAX = 48;
// How many names a card's line gives before "and N more"
const NAMED_MAX = 3;
// The order a tile's marks come in, as drawn: up first, then on its way, in trouble, asleep
const MARK_ORDER = ['run', 'busy', 'bad', 'idle', 'accent'];

// All categories: what needs you first, as a card per category in trouble with its count big;
// then what you have, four tiles with a mark per item; then everything else, the other
// categories as short lists in their groups. Every card, tile and row opens its category, and
// says what it is for in its tooltip. The category the page came from keeps its outline.
const categories_pane = {
    template: `
<article id="detail" class="list categories">
    <page-head category="categories" :count="count"/>
    <template v-if="(needs.length > 0)">
        <h2 class="cat-label" :class="needs_kind">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>
            {{ (needs_kind === 'bad') ? 'Needs you' : 'To look at' }} · {{ needs.length }}
        </h2>
        <div class="cat-cards">
            <button v-for="card of needs" :key="card.key" type="button" class="cat-card" :class="[card.kind, {on: (card.key === category)}]" :title="card.says" @click="$emit('pick', card.key)">
                <span class="cat-card-count">{{ card.count }}</span>
                <span class="cat-card-body">
                    <b class="cat-card-what">{{ card.what }}</b>
                    <span class="cat-card-line">{{ card.line }}<span v-if="(card.more > 0)" class="muted"> and {{ card.more }} more</span><span v-if="(card.since !== '')"> · {{ card.since }}</span></span>
                    <span class="cat-card-go">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="card.icon"/>
                        {{ card.name }} · {{ card.verb }} →
                    </span>
                </span>
            </button>
        </div>
    </template>
    <div v-else class="cat-well">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>
        <b>Nothing needs you</b>
        <span v-if="(looked !== '')" class="muted">· looked {{ looked }}</span>
    </div>
    <h2 class="cat-label">What you have</h2>
    <div class="cat-bigs">
        <button v-for="tile of bigs" :key="tile.key" type="button" class="cat-big" :class="{on: (tile.key === category)}" :title="tile.says" @click="$emit('pick', tile.key)">
            <span class="cat-big-head">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="tile.icon"/>
                {{ tile.name }}
            </span>
            <span class="cat-big-count">{{ tile.count }}</span>
            <span v-if="(tile.marks.length <= MARKS_MAX)" class="cat-marks" aria-hidden="true"><i v-for="(mark, index) of tile.marks" :key="index" class="cat-mark" :class="[mark, tile.shape]"/></span>
            <span v-else class="cat-bar" aria-hidden="true"><i v-for="part of tile.shares" :key="part.kind" :class="part.kind" :style="{flexGrow: part.count}"/></span>
            <span class="cat-big-line"><template v-for="(part, index) of tile.line" :key="index"><span v-if="(index > 0)"> · </span><span :class="part.kind">{{ part.text }}</span></template></span>
        </button>
    </div>
    <h2 class="cat-label">Everything else</h2>
    <div class="cat-lists">
        <div v-for="group of groups" :key="group.name" class="cat-list-group">
            <h3>{{ group.name }}</h3>
            <div class="cat-list">
                <button v-for="item of group.items" :key="item.key" type="button" class="cat-row" :class="[tally_of(item.key).state, {on: (item.key === category)}]" :title="item.says" @click="$emit('pick', item.key)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>
                    <span class="cat-row-name">{{ item.name }}</span>
                    <span class="cat-row-tally" :title="tally_of(item.key).title">{{ tally_of(item.key).text }}</span>
                </button>
            </div>
        </div>
    </div>
</article>
`,
    components: {'page-head': page_head},
    emits: ['pick'],
    props: {
        // What each category says on its right, {key: {text, state, title}}, as the first
        // crumb's menu shows it; state bad or warn puts it among the cards on top
        tallies: {type: Object, required: true},
        // The category the page came from, outlined: the way back to it is in plain sight
        category: {type: String, default: ''},
        // The page's state: its services, remotes, security and health
        state: {type: Object, required: true},
        // The problems the top of the page names, oldest first
        problems: {type: Array, required: true},
        // {addresses, guarded, apps, boards}: the counts the first crumb's menu has
        counts: {type: Object, required: true},
    },
    data: function () {
        return {MARKS_MAX};
    },
    computed: {
        count: function () {
            return CATEGORIES.length;
        },
        // A card for each category whose tally is bad, then each that is warn: Health first, as
        // drawn, then the others in the order of CATEGORIES
        needs: function () {
            const ordered = CATEGORIES.filter(v => v.key === 'health').concat(CATEGORIES.filter(v => v.key !== 'health'));
            const bad = ordered.filter(v => this.tally_of(v.key).state === 'bad');
            const warn = ordered.filter(v => this.tally_of(v.key).state === 'warn');
            return bad.concat(warn).map(v => this.card_of(v));
        },
        needs_kind: function () {
            return this.needs.some(v => v.kind === 'bad') ? 'bad' : 'warn';
        },
        // When Health looked last, said as an age
        looked: function () {
            const health = this.state.health;
            if ((health === undefined) || (health === null) || (typeof health.checked_at !== 'number')) {
                return '';
            }
            return format_ms_ago(Date.now() - health.checked_at);
        },
        bigs: function () {
            return CATEGORIES.filter(v => v.big > 0).sort((a, b) => a.big - b.big).map(v => this.big_of(v));
        },
        // The other categories in their groups, a short list each
        groups: function () {
            const out = [];
            for (const item of CATEGORIES.filter(v => (v.big === undefined) || (v.big === 0))) {
                let group = out.find(v => v.name === item.group);
                if (group === undefined) {
                    group = {name: item.group, items: []};
                    out.push(group);
                }
                group.items.push(item);
            }
            return out;
        },
    },
    methods: {
        tally_of: function (key) {
            return (this.tallies[key] === undefined) ? {text: '', state: 'muted', title: ''} : this.tallies[key];
        },
        // One card: its count big, what it counts, a line of what it is about, and the way in
        card_of: function (item) {
            const tally = this.tally_of(item.key);
            const kind = (tally.state === 'bad') ? 'bad' : 'warn';
            const base = {key: item.key, name: item.name, icon: item.icon, says: item.says, kind, more: 0, since: '', verb: 'see them'};
            const card = Object.assign(base, this.card_own(item.key, kind, tally));
            // One thing is "see it", more are "see them"
            card.verb = (card.count === 1) ? card.verb.replace(/ them$/, ' it') : card.verb;
            return card;
        },
        // What a card of this category says beyond the defaults
        card_own: function (key, kind, tally) {
            if (key === 'health') {
                return this.health_card(kind, tally);
            }
            if (key === 'remotes') {
                return this.remotes_card();
            }
            if (key === 'security') {
                return this.security_card(kind);
            }
            const count = parseInt(tally.text, 10);
            return {count: Number.isNaN(count) ? '!' : count, what: tally.text.replace(/^\d+\s*/, ''), line: tally.title};
        },
        health_card: function (kind, tally) {
            if (kind === 'warn') {
                const count = parseInt(tally.text, 10);
                return {count: Number.isNaN(count) ? '!' : count, what: 'to look at', line: tally.title, verb: 'see them'};
            }
            const first = (this.problems.length === 0) ? '' : this.problems[0].subject;
            return {count: this.problems.length, what: (this.problems.length === 1) ? 'problem' : 'problems', line: first, more: Math.max(0, this.problems.length - 1)};
        },
        remotes_card: function () {
            const away = this.state.remotes.filter(v => v.phase !== 'online');
            const left = away.map(v => v.left_at).filter(v => typeof v === 'number').sort((a, b) => b - a);
            return {
                count: away.length,
                what: (away.length === 1) ? 'machine offline' : 'machines offline',
                line: away.slice(0, NAMED_MAX).map(v => v.title || v.name).join(', '),
                more: Math.max(0, away.length - NAMED_MAX),
                since: (left.length === 0) ? '' : `not linked since ${clock_of(left[0])}`,
            };
        },
        security_card: function (kind) {
            const security = this.state.security;
            const checks = [];
            for (const row of ((security === undefined) || (security === null)) ? [] : security.rows) {
                for (const check of row.checks.filter(v => v.state === kind)) {
                    checks.push(`${check.key} on ${row.name}`);
                }
            }
            const checks_said = (checks.length === 1) ? 'check' : 'checks';
            return {
                count: checks.length,
                what: (kind === 'bad') ? `${checks_said} to mend` : `${checks_said} to look at`,
                line: checks.slice(0, NAMED_MAX).join(' · '),
                more: Math.max(0, checks.length - NAMED_MAX),
                verb: (kind === 'bad') ? 'mend them' : 'look at them',
            };
        },
        // One big tile: its count, a mark per item in the colour of its state, and a line
        big_of: function (item) {
            const base = {key: item.key, name: item.name, icon: item.icon, says: item.says};
            const tile = this[`${item.key.replace(/-/g, '_')}_tile`]();
            const shares = [];
            for (const mark of tile.marks) {
                const share = shares.find(v => v.kind === mark);
                if (share === undefined) {
                    shares.push({kind: mark, count: 1});
                }
                else {
                    share.count++;
                }
            }
            const marks = tile.marks.slice().sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b));
            return Object.assign(base, tile, {marks, shares: shares.sort((a, b) => MARK_ORDER.indexOf(a.kind) - MARK_ORDER.indexOf(b.kind))});
        },
        services_tile: function () {
            const marks = this.state.services.map(v => this.service_mark(v));
            const up = marks.filter(v => v === 'run').length;
            const failed = marks.filter(v => v === 'bad').length;
            const line = [{text: `${up} up`, kind: 'run'}, {text: `${marks.length - up - failed} asleep`, kind: ''}];
            if (failed > 0) {
                line.push({text: `${failed} failed`, kind: 'bad'});
            }
            return {count: marks.length, marks, shape: 'square', line};
        },
        remotes_tile: function () {
            const marks = this.state.remotes.map(v => (v.phase === 'online') ? 'run' : 'bad');
            const online = marks.filter(v => v === 'run').length;
            const line = [{text: `${online} online`, kind: 'run'}];
            if (online < marks.length) {
                line.push({text: `${marks.length - online} offline`, kind: 'bad'});
            }
            return {count: marks.length, marks, shape: 'dot', line};
        },
        addresses_tile: function () {
            const total = this.counts.addresses;
            const guarded = Math.min(total, this.counts.guarded);
            const marks = Array.from({length: total}, (v, index) => (index < guarded) ? 'busy' : 'accent');
            return {count: total, marks, shape: 'square', line: [{text: `${total} ${(total === 1) ? 'name' : 'names'}`, kind: ''}, {text: `${guarded} behind a wall`, kind: (guarded > 0) ? 'busy' : ''}]};
        },
        apps_tile: function () {
            const total = this.counts.apps;
            const boards = this.counts.boards;
            return {count: total, marks: Array.from({length: total}, () => 'accent'), shape: 'square', line: [{text: 'a card each', kind: ''}, {text: `on ${boards} ${(boards === 1) ? 'board' : 'boards'}`, kind: ''}]};
        },
        // A service's mark, as its dot in the Services table: running green, starting orange,
        // failed or its machine away red, asleep or stopped grey
        service_mark: function (service) {
            const remotes = Array.isArray(service.remotes) ? service.remotes : [];
            const away = (remotes.length > 0) && remotes.every(v => this.state.remotes.some(vv => (vv.name === v) && (vv.phase !== 'online')));
            if (away || (service.phase === 'failed') || (service.phase === 'lost')) {
                return 'bad';
            }
            if ((service.doing !== null) || (service.phase === 'starting')) {
                return 'busy';
            }
            return (service.phase === 'running') ? 'run' : 'idle';
        },
    },
};

// A time of today as the page's clock says it: 11:02
function clock_of(ms)
{
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default categories_pane;
