import agent_current from './agent_current.js';

// The columns of the map, left to right: what a visitor types, what answers it, where that
// runs, and where the machines' lines go
const MAP_COLUMNS = [
    {value: 'address', label: 'Addresses'},
    {value: 'service', label: 'Services'},
    {value: 'machine', label: 'Machines'},
    {value: 'logline', label: 'Logs'},
];

// The whole of what serviceman looks after as one picture: every address to the service that
// answers it, every service to the machine it runs on — a solid line where it runs now, a
// dashed one where it may — and every machine to Logline where its lines go. Pointing at
// anything lights up everything it is joined to; clicking opens it.
const map_pane = {
    template: `
<article id="detail" class="list map-pane">
    <div class="list-head">
        <h1>Map</h1>
        <span class="muted">{{ graph.counts.address }} addresses · {{ graph.counts.service }} services · {{ graph.counts.machine }} machines</span>
    </div>
    <p class="muted map-legend">
        <span><i class="map-key run"></i>runs there now</span>
        <span><i class="map-key may"></i>may run there</span>
        <span><i class="map-key logs"></i>sends its logs</span>
        <span>Point at anything to see what it is joined to; click to open it.</span>
    </p>
    <div ref="board" class="map-board" :class="{focused: (focus !== null)}" @mouseleave="focus = null">
        <svg class="map-edges" :width="size.width" :height="size.height" aria-hidden="true">
            <path v-for="edge of paths" :key="edge.key" :d="edge.d" :class="[edge.kind, {lit: lit(edge.from) && lit(edge.to)}]"/>
        </svg>
        <div v-for="column of columns" :key="column.value" class="map-column">
            <div class="map-column-head muted">{{ column.label }}</div>
            <div class="map-nodes">
                <button
                    v-for="node of column.nodes"
                    :key="node.id"
                    type="button"
                    class="map-node"
                    :class="['map-' + node.kind, {lit: lit(node.id), host: node.host}]"
                    :data-id="node.id"
                    :title="node.hint"
                    @mouseenter="focus = node.id"
                    @focus="focus = node.id"
                    @click="click_node(node)"
                >
                    <span v-if="(node.phase !== null)" class="dot" :class="node.phase"/>
                    <code v-if="(node.kind === 'address')">{{ node.label }}</code>
                    <span v-else class="map-label">{{ node.label }}</span>
                    <span v-if="(node.sub !== '')" class="map-sub muted">{{ node.sub }}</span>
                    <svg v-if="node.behind" class="agent-behind" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
                </button>
                <p v-if="(column.nodes.length === 0)" class="muted map-none">none</p>
            </div>
        </div>
    </div>
</article>
`,
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        return {focus: null, paths: [], size: {width: 0, height: 0}, observer: null};
    },
    computed: {
        graph: function () {
            return map_graph(this.state);
        },
        columns: function () {
            const out = [];
            for (const column of MAP_COLUMNS) {
                const nodes = this.graph.nodes.filter(v => v.kind === column.value);
                if ((column.value === 'logline') && (nodes.length === 0)) {
                    continue;
                }
                out.push({value: column.value, label: column.label, nodes});
            }
            return out;
        },
        // Everything joined to the node pointed at, along the lines both ways: an address lights
        // its service, the machine under it and Logline beyond; a machine lights all it carries
        joined: function () {
            if (this.focus === null) {
                return null;
            }
            const out = new Set([this.focus]);
            for (const forward of [true, false]) {
                const queue = [this.focus];
                while (queue.length > 0) {
                    const at = queue.shift();
                    for (const edge of this.graph.edges) {
                        const from = forward ? edge.from : edge.to;
                        const to = forward ? edge.to : edge.from;
                        if ((from === at) && (out.has(to) === false)) {
                            out.add(to);
                            queue.push(to);
                        }
                    }
                }
            }
            return out;
        },
        // The lines are drawn again whenever what is on the map changes, not with every poll
        shape: function () {
            return `${this.graph.nodes.map(v => v.id).join(' ')}|${this.graph.edges.map(v => v.key).join(' ')}`;
        },
    },
    watch: {
        shape: function () {
            this.$nextTick(this.draw);
        },
    },
    methods: {
        lit: function (id) {
            return (this.joined === null) || this.joined.has(id);
        },
        // Each line from the right edge of one node to the left edge of the next, measured from
        // where the nodes stand on the page, so a long name never pulls a line off its box
        draw: function () {
            const board = this.$refs.board;
            if ((board === undefined) || (board === null)) {
                return;
            }
            const origin = board.getBoundingClientRect();
            const boxes = {};
            for (const element of board.querySelectorAll('.map-node')) {
                const box = element.getBoundingClientRect();
                boxes[element.dataset.id] = {left: box.left - origin.left, right: box.right - origin.left, middle: box.top - origin.top + box.height/2};
            }
            const paths = [];
            for (const edge of this.graph.edges) {
                const from = boxes[edge.from];
                const to = boxes[edge.to];
                if ((from === undefined) || (to === undefined)) {
                    continue;
                }
                const bend = Math.max(24, (to.left - from.right)/2);
                paths.push({key: edge.key, from: edge.from, to: edge.to, kind: edge.kind, d: `M${from.right} ${from.middle} C${from.right + bend} ${from.middle}, ${to.left - bend} ${to.middle}, ${to.left} ${to.middle}`});
            }
            this.paths = paths;
            this.size = {width: board.scrollWidth, height: board.scrollHeight};
        },
        click_node: function (node) {
            if ((node.kind === 'address') || (node.kind === 'service')) {
                this.$emit('select', node.service);
                return;
            }
            if ((node.kind === 'machine') && (node.host === false)) {
                this.$emit('remote', node.name);
                return;
            }
            if ((node.kind === 'logline') && (node.ui !== null)) {
                window.open(node.ui, '_blank', 'noopener');
            }
        },
    },
    mounted: function () {
        this.observer = new ResizeObserver(this.draw);
        this.observer.observe(this.$refs.board);
        this.$nextTick(this.draw);
    },
    unmounted: function () {
        this.observer.disconnect();
    },
};

// The nodes and the lines between them, from the status alone
function map_graph(state)
{
    const nodes = [];
    const edges = [];
    const remotes = state.remotes.slice().sort((a, b) => name_compare(a.title || a.name, b.title || b.name));
    const machine_index = {'': 0};
    nodes.push({id: 'm:', kind: 'machine', name: '', label: 'this host', sub: 'serviceman', phase: 'running', host: true, behind: false, hint: 'The machine serviceman itself runs on'});
    for (const remote of remotes) {
        machine_index[remote.name] = Object.keys(machine_index).length;
        const machine = (remote.machine === undefined) ? null : remote.machine;
        const online = (remote.phase === 'online');
        nodes.push({
            id: `m:${remote.name}`,
            kind: 'machine',
            name: remote.name,
            label: remote.title || remote.name,
            sub: (machine === null) ? '' : machine.hostname,
            phase: online ? 'running' : 'failed',
            host: false,
            behind: agent_current(remote, state.agent_built) === false,
            hint: `${remote.name} — ${online ? 'online' : 'offline'}`,
        });
    }
    // Where each service runs now, or where it may: the machines it names, a #tag standing for
    // every machine carrying it, and this host for one that names none
    const services = [];
    for (const service of state.services) {
        const running = new Set();
        for (const instance of service.instances) {
            if ((instance.phase === 'running') || (instance.phase === 'starting')) {
                running.add((instance.remote === null) ? '' : instance.remote);
            }
        }
        const places = (running.size > 0) ? Array.from(running) : service_places(service, state.remotes);
        const kind = (running.size > 0) ? 'run' : 'may';
        const order = places.reduce((sum, place) => sum + ((machine_index[place] === undefined) ? 0 : machine_index[place]), 0)/Math.max(1, places.length);
        services.push({service, places, kind, order});
    }
    services.sort((a, b) => (a.order - b.order) || name_compare(a.service.title || a.service.name, b.service.title || b.service.name));
    const addresses = [];
    for (const item of services) {
        const service = item.service;
        nodes.push({
            id: `s:${service.name}`,
            kind: 'service',
            name: service.name,
            service: service.name,
            label: service.title || service.name,
            sub: service.type,
            phase: service_dot(service.phase),
            host: false,
            behind: false,
            hint: `${service.name} — ${service.type}, ${service.phase}`,
        });
        for (const place of item.places) {
            edges.push({key: `s:${service.name}>m:${place}`, from: `s:${service.name}`, to: `m:${place}`, kind: item.kind});
        }
        for (const host of service.publish.hosts) {
            addresses.push({host, service: service.name});
        }
    }
    for (const item of addresses) {
        nodes.push({id: `a:${item.host}`, kind: 'address', name: item.host, service: item.service, label: item.host, sub: '', phase: null, host: false, behind: false, hint: `${item.host} — answered by ${item.service}`});
        edges.push({key: `a:${item.host}>s:${item.service}`, from: `a:${item.host}`, to: `s:${item.service}`, kind: 'run'});
    }
    // Logline, where machines send their lines to it
    const sending = remotes.filter(v => (v.logline !== undefined) && (v.logline !== null) && (v.logline.logs === 'all'));
    if (sending.length > 0) {
        const ui = sending.map(v => v.logline.ui).find(v => (v !== null) && (v !== undefined));
        nodes.push({id: 'l:', kind: 'logline', name: 'logline', label: 'Logline', sub: (ui === undefined) ? '' : 'open its viewer', phase: null, host: false, behind: false, ui: (ui === undefined) ? null : ui, hint: 'Where the machines send their logs'});
        for (const remote of sending) {
            edges.push({key: `m:${remote.name}>l:`, from: `m:${remote.name}`, to: 'l:', kind: 'logs'});
        }
    }
    const counts = {address: addresses.length, service: services.length, machine: remotes.length + 1};
    return {nodes, edges, counts};
}

// The machines a service that is not running may run on
function service_places(service, remotes)
{
    const names = [];
    for (const wanted of ((service.remotes === undefined) ? [] : service.remotes)) {
        if (wanted.startsWith('#')) {
            for (const remote of remotes) {
                if (remote.tags.includes(wanted.slice(1)) && (names.includes(remote.name) === false)) {
                    names.push(remote.name);
                }
            }
        }
        else if (names.includes(wanted) === false) {
            names.push(wanted);
        }
    }
    return (names.length === 0) ? [''] : names;
}

// The dot a service's phase is drawn with, as the rail draws it; a resting one is the empty ring
function service_dot(phase)
{
    return ['running', 'starting', 'stopping', 'failed', 'lost'].includes(phase) ? phase : 'stopped';
}

function name_compare(a, b)
{
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
}

export default map_pane;
