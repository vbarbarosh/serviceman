import state_pill from './state_pill.js';

// The labels a slim row says shorter than its head does
const LABELS_SHORT = {Memory: 'Mem'};

// A page's head folded into one slim row, docked under serviceman's bar once the head has
// scrolled away: its icon, its name, its state in a word, its facts as numbers, its tabs, and
// what the page puts at its right end (a machine's charts switch). It stands right after the
// head's card, in the page that scrolls: a mark there says when the head is gone, and the row
// takes no room in the page, so nothing under it moves when it shows. Tabs that do not fit fold
// into one button, the open tab's, whose menu has them all; a phone has no tabs in it, and what
// is at its right end takes a row of its own.
//
//     icon     the inside of a 24x24 stroked svg
//     name     what the head says in its h1
//     state    the head's pill: {tone, text}; the row says its first word, before ' · '
//     facts    the head's facts (item_facts): [{label, value, dim, title}, …]
//     tabs     the tabs in the head's foot: [{key, label, icon, count}, …]
//     more     the tabs under its More ▾, as many
//     tab      the key of the tab open
//     @tab     a tab picked: its key
const item_slim = {
    template: `
<div ref="mark" aria-hidden="true"></div>
<div class="item-slim" :class="{shown}">
    <div class="item-slim-bar" :inert="(shown === false)">
        <span class="item-slim-where">
            <span class="item-slim-tile"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icon"/></span>
            <b class="item-slim-name" :title="name">{{ name }}</b>
            <state-pill :tone="state.tone" :text="word"/>
        </span>
        <span v-if="(facts.length > 0)" class="item-slim-facts">
            <span v-for="fact of facts" :key="fact.label" :title="fact.title"><span class="muted">{{ label_short(fact.label) }}</span> <b :class="{dim: (fact.dim === true)}">{{ fact.value }}</b></span>
        </span>
        <nav ref="room" class="item-slim-tabs">
            <template v-if="(fold === false)">
                <button v-for="item of tabs" :key="item.key" type="button" class="tab" :class="{on: (tab === item.key)}" @click="click_tab(item.key)">{{ item.label }}<span v-if="((item.count !== null) && (item.count !== undefined))" class="tab-count">{{ item.count }}</span></button>
                <span v-if="(more.length > 0)" class="item-menu-wrap">
                    <button type="button" class="tab" :class="{on: (more_now !== null)}" :aria-expanded="(menu === 'more')" @click="click_more">{{ (more_now === null) ? 'More' : more_now.label }} ▾</button>
                    <span v-if="(menu === 'more')" class="item-menu" role="menu">
                        <button v-for="item of more" :key="item.key" type="button" role="menuitem" :class="{on: (tab === item.key)}" @click="click_tab(item.key)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>{{ item.label }}</button>
                    </span>
                </span>
            </template>
            <span v-else class="item-menu-wrap">
                <button type="button" class="tab on" :aria-expanded="(menu === 'tabs')" title="Every tab of the page" @click="click_tabs">{{ (tab_now === null) ? 'Tabs' : tab_now.label }} ▾</button>
                <span v-if="(menu === 'tabs')" class="item-menu" role="menu">
                    <button v-for="item of tabs_all" :key="item.key" type="button" role="menuitem" :class="{on: (tab === item.key)}" @click="click_tab(item.key)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>{{ item.label }}</button>
                </span>
            </span>
            <!-- The tabs as they would stand unfolded, out of sight: the room they need -->
            <span class="item-slim-need" aria-hidden="true" inert><span ref="need">
                <span v-for="item of tabs" :key="item.key" class="tab">{{ item.label }}<span v-if="((item.count !== null) && (item.count !== undefined))" class="tab-count">{{ item.count }}</span></span>
                <span v-if="(more.length > 0)" class="tab">{{ (more_now === null) ? 'More' : more_now.label }} ▾</span>
            </span></span>
        </nav>
        <slot/>
    </div>
</div>
`,
    components: {'state-pill': state_pill},
    props: {
        icon: {type: String, required: true},
        name: {type: String, required: true},
        state: {type: Object, required: true},
        facts: {type: Array, required: true},
        tabs: {type: Array, required: true},
        more: {type: Array, default: () => []},
        tab: {type: String, required: true},
    },
    emits: ['tab'],
    data: function () {
        // shown: the head is scrolled away, and the row docked; fold: its tabs do not fit, and are
        // one button; menu: the menu open, 'more', 'tabs' or ''
        return {shown: false, fold: false, menu: ''};
    },
    computed: {
        word: function () {
            return this.state.text.split(' · ')[0];
        },
        tabs_all: function () {
            return this.tabs.concat(this.more);
        },
        tab_now: function () {
            return this.tabs_all.find(v => v.key === this.tab) || null;
        },
        more_now: function () {
            return this.more.find(v => v.key === this.tab) || null;
        },
    },
    methods: {
        label_short: function (label) {
            return LABELS_SHORT[label] || label;
        },
        // A tab picked here opens at its top, the head over it again, as a page opens: kept
        // folded, a pane that is read in after it opens (Settings reads the config) would land
        // wherever the page was left
        click_tab: function (key) {
            this.menu = '';
            this.$emit('tab', key);
            if (this.scroller === null) {
                window.scrollTo(0, 0);
            }
            else {
                this.scroller.scrollTop = 0;
            }
        },
        click_more: function () {
            this.menu = (this.menu === 'more') ? '' : 'more';
        },
        click_tabs: function () {
            this.menu = (this.menu === 'tabs') ? '' : 'tabs';
        },
        // The head is gone once the mark under it has passed the top of the page that scrolls
        refresh_shown: function (entries) {
            const entry = entries[entries.length - 1];
            const top = (entry.rootBounds === null) ? 0 : entry.rootBounds.top;
            this.shown = (entry.isIntersecting === false) && (entry.boundingClientRect.top < top);
            if (this.shown === false) {
                this.menu = '';
            }
        },
        refresh_fold: function () {
            const room = this.$refs.room;
            const need = this.$refs.need;
            if ((room === undefined) || (room === null) || (need === undefined) || (need === null)) {
                return;
            }
            this.fold = (need.offsetWidth > room.clientWidth);
        },
    },
    // The page scrolls in the nearest box that scrolls; with none, the window does
    mounted: function () {
        const self = this;
        this.scroller = scroller_of(this.$refs.mark);
        this.watcher = new IntersectionObserver(this.refresh_shown, {root: this.scroller});
        this.watcher.observe(this.$refs.mark);
        this.sizes = new ResizeObserver(this.refresh_fold);
        this.sizes.observe(this.$refs.room);
        this.sizes.observe(this.$refs.need);
        // A click outside its menu, or Esc, puts the menu away
        this.menus_away = function (event) {
            if ((event.type === 'keydown') && (event.key !== 'Escape')) {
                return;
            }
            if ((event.type === 'click') && (event.target.closest('.item-slim .item-menu-wrap') !== null)) {
                return;
            }
            self.menu = '';
        };
        document.addEventListener('click', this.menus_away);
        document.addEventListener('keydown', this.menus_away);
    },
    unmounted: function () {
        this.watcher.disconnect();
        this.sizes.disconnect();
        document.removeEventListener('click', this.menus_away);
        document.removeEventListener('keydown', this.menus_away);
    },
};

// The nearest box around an element that scrolls up and down; null for the window
function scroller_of(element)
{
    for (let at = element.parentElement; at !== null; at = at.parentElement) {
        const overflow = getComputedStyle(at).overflowY;
        if ((overflow === 'auto') || (overflow === 'scroll')) {
            return at;
        }
    }
    return null;
}

export default item_slim;
