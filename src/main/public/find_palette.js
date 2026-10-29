import remote_dot from './remote_dot.js';
import remote_state_text from './remote_state_text.js';

// Ctrl K: one box that finds anything on the page by any word it carries — a service by its
// name, address or image, a machine by its hostname, a folder by its path — and says what kind
// of thing each hit is. Enter opens the page the hit belongs to.
const KINDS = [
    {value: 'remote', label: 'Remotes', title: 'Remotes'},
    {value: 'service', label: 'Services', title: 'Services'},
    {value: 'address', label: 'Addresses', title: 'Addresses'},
    {value: 'folder', label: 'Storage', title: 'Storage'},
];

// Hits shown per kind while every kind is shown; picking the kind shows all of them
const HITS_PER_KIND = 6;

const find_palette = {
    template: `
<div class="shade" @click.self="$emit('close')">
    <div class="palette" role="dialog" aria-label="Find">
        <div class="palette-q">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input ref="input" v-model="query" placeholder="Find a service, remote, address or folder" spellcheck="false" autocomplete="off" @keydown="key">
        </div>
        <div class="palette-kinds">
            <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === kind)}" @click="kind_pick(chip.value)">
                {{ chip.label }}
                <span class="muted">{{ chip.count }}</span>
            </button>
        </div>
        <div class="palette-hits" ref="hits">
            <template v-for="section of sections" :key="section.kind">
                <div class="palette-sec">{{ section.title }}</div>
                <button v-for="hit of section.hits" :key="hit.key" type="button" class="palette-hit" :class="{on: (hit.index === at)}" @click="pick(hit)" @mousemove="at = hit.index">
                    <span v-if="(hit.phase !== null)" class="dot" :class="hit.phase"/>
                    <span class="palette-text"><template v-for="(part, i) of hit.parts" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                    <span class="muted">{{ hit.sub }}</span>
                    <span class="tag">{{ hit.kind }}</span>
                </button>
            </template>
            <p v-if="(sections.length === 0)" class="muted">Nothing matches.</p>
        </div>
        <div class="palette-foot muted">
            <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Tab</kbd> next kind</span>
            <span><kbd>Esc</kbd> close</span>
        </div>
    </div>
</div>
`,
    props: ['state'],
    emits: ['close', 'pick'],
    data: function () {
        return {query: '', kind: 'all', at: 0, volumes: []};
    },
    computed: {
        // Everything that can be found, each with the page it opens
        items: function () {
            const out = [];
            const services = this.state.services;
            const remotes = this.state.remotes;
            for (const remote of remotes) {
                const machine = ((remote.machine === undefined) || (remote.machine === null)) ? null : remote.machine;
                const count = services.filter(v => v.remotes.includes(remote.name)).length;
                const sub = `${remote_state_text(remote).split(' · ')[0]} · ${count} ${(count === 1) ? 'service' : 'services'}`;
                const words = [remote.name, (machine === null) ? '' : machine.hostname].concat(remote.tags);
                out.push({kind: 'remote', key: `remote ${remote.name}`, text: remote.title || remote.name, sub, words, phase: remote_dot(remote), target: {kind: 'remote', name: remote.name}});
            }
            for (const service of services) {
                const sub = [service.publish.hosts[0] || '', service.phase].filter(v => v !== '').join(' · ');
                const words = [service.name, service.type, service.image || ''].concat(service.publish.hosts, service.remotes);
                out.push({kind: 'service', key: `service ${service.name}`, text: service.title || service.name, sub, words, phase: service.phase, target: {kind: 'service', name: service.name}});
            }
            for (const service of services) {
                for (const host of service.publish.hosts) {
                    out.push({kind: 'address', key: `address ${service.name} ${host}`, text: host, sub: `goes to ${service.title || service.name}`, words: [service.name], phase: null, target: {kind: 'service', name: service.name}});
                }
            }
            for (const remote of remotes) {
                const rule_by_host = (remote.inbound === undefined) ? {} : remote.inbound;
                for (const host of Object.keys(rule_by_host)) {
                    const service = rule_by_host[host].service;
                    out.push({kind: 'address', key: `address ${remote.name} ${host}`, text: host, sub: `goes to ${service} · door of ${remote.title || remote.name}`, words: [service, remote.name], phase: null, target: {kind: 'service', name: service}});
                }
            }
            for (const volume of this.volumes) {
                const users = volume.used_by.map(v => v.service);
                const sub = `on ${volume.machine}${(users.length === 0) ? '' : ` · kept for ${users.join(', ')}`}`;
                const target = (users.length === 0) ? {kind: 'storage', name: ''} : {kind: 'service', name: users[0]};
                out.push({kind: 'folder', key: `folder ${volume.machine} ${volume.name}`, text: volume.name, sub, words: users.concat([volume.machine]), phase: null, target});
            }
            return out;
        },
        matched: function () {
            const wanted = this.query.trim().toLowerCase();
            if (wanted === '') {
                return this.items;
            }
            return this.items.filter(v => [v.text, v.sub].concat(v.words).join(' ').toLowerCase().includes(wanted));
        },
        chips: function () {
            const out = [{value: 'all', label: 'Everything', count: this.matched.length}];
            for (const item of KINDS) {
                out.push({value: item.value, label: item.label, count: this.matched.filter(v => v.kind === item.value).length});
            }
            return out;
        },
        // The hits under their kinds, each numbered in the order the arrows walk them
        sections: function () {
            const out = [];
            let index = 0;
            for (const item of KINDS) {
                if ((this.kind !== 'all') && (this.kind !== item.value)) {
                    continue;
                }
                let hits = this.matched.filter(v => v.kind === item.value);
                if (this.kind === 'all') {
                    hits = hits.slice(0, HITS_PER_KIND);
                }
                if (hits.length === 0) {
                    continue;
                }
                const shown = [];
                for (const hit of hits) {
                    shown.push({key: hit.key, kind: hit.kind, sub: hit.sub, phase: hit.phase, target: hit.target, parts: this.parts_of(hit.text), index});
                    index++;
                }
                out.push({kind: item.value, title: item.title, hits: shown});
            }
            return out;
        },
        hits_flat: function () {
            const out = [];
            for (const section of this.sections) {
                for (const hit of section.hits) {
                    out.push(hit);
                }
            }
            return out;
        },
    },
    watch: {
        query: function () {
            this.at = 0;
        },
        kind: function () {
            this.at = 0;
        },
        at: function () {
            const self = this;
            this.$nextTick(function () {
                const on = self.$refs.hits.querySelector('.palette-hit.on');
                if (on !== null) {
                    on.scrollIntoView({block: 'nearest'});
                }
            });
        },
    },
    methods: {
        // The text cut where the query matches, so the match can be marked
        parts_of: function (text) {
            const wanted = this.query.trim().toLowerCase();
            const at = (wanted === '') ? -1 : text.toLowerCase().indexOf(wanted);
            if (at === -1) {
                return [{text, hit: false}];
            }
            return [
                {text: text.slice(0, at), hit: false},
                {text: text.slice(at, at + wanted.length), hit: true},
                {text: text.slice(at + wanted.length), hit: false},
            ];
        },
        kind_pick: function (value) {
            this.kind = value;
            this.$refs.input.focus();
        },
        key: function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.$emit('close');
                return;
            }
            if ((event.key === 'ArrowDown') || (event.key === 'ArrowUp')) {
                event.preventDefault();
                const count = this.hits_flat.length;
                if (count > 0) {
                    this.at = (this.at + ((event.key === 'ArrowDown') ? 1 : count - 1)) % count;
                }
                return;
            }
            if (event.key === 'Tab') {
                event.preventDefault();
                const values = ['all'].concat(KINDS.map(v => v.value));
                const step = event.shiftKey ? values.length - 1 : 1;
                this.kind = values[(values.indexOf(this.kind) + step) % values.length];
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                const hit = this.hits_flat[this.at];
                if (hit !== undefined) {
                    this.pick(hit);
                }
            }
        },
        pick: function (hit) {
            this.$emit('pick', hit.target);
        },
        volumes_load: async function () {
            try {
                const answer = await fetch('/api/v1/volumes', {cache: 'no-store'});
                this.volumes = (await answer.json()).volumes;
            }
            catch {
                this.volumes = [];
            }
        },
    },
    mounted: function () {
        this.$refs.input.focus();
    },
    created: function () {
        this.volumes_load();
    },
};

export default find_palette;
