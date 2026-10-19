(function () {
    'use strict';

    const {createApp, h, Fragment} = Vue;
    const PAGE_SIZE = 500;
    const DEFAULT_REFRESH_SECONDS = 2.5;
    const ROW_HEIGHT = 32;
    const OVERSCAN = 12;
    const MARQUEE_THRESHOLD = 5;
    // Ranges ending now follow live; calendar ones start at a local midnight
    const RELATIVE_RANGES = [
        {value: '5m', label: 'Last 5 minutes', seconds: 300},
        {value: '15m', label: 'Last 15 minutes', seconds: 900},
        {value: '30m', label: 'Last 30 minutes', seconds: 1800},
        {value: '1h', label: 'Last 1 hour', seconds: 3600},
        {value: '3h', label: 'Last 3 hours', seconds: 10800},
        {value: '6h', label: 'Last 6 hours', seconds: 21600},
        {value: '12h', label: 'Last 12 hours', seconds: 43200},
        {value: '24h', label: 'Last 24 hours', seconds: 86400},
        {value: '2d', label: 'Last 2 days', seconds: 172800},
        {value: '7d', label: 'Last 7 days', seconds: 604800},
        {value: '30d', label: 'Last 30 days', seconds: 2592000},
    ];
    const CALENDAR_RANGES = [
        {value: 'today', label: 'Today'},
        {value: 'yesterday', label: 'Yesterday'},
        {value: 'week', label: 'This week'},
        {value: 'month', label: 'This month'},
    ];
    const RANGE_UNITS = {s: 1, m: 60, h: 3600, d: 86400, w: 604800};
    const RE_RANGE_NOW = /^now(?:\s*-\s*(\d+)\s*([smhdw]))?$/i;
    const RE_RANGE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
    const RE_RANGE_CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
    const MARQUEE_EDGE = 32;
    const SURROUNDING_SECONDS = 120;
    const GROUP_CONTEXT_SECONDS = 3600;
    const BUCKETS = [1, 5, 10, 30, 60, 300, 900, 1800, 3600, 21600, 86400];
    const GROUP_UID_EXPR = "if(empty(LogAttributes['group_uid']), extract(Body, '(?:^|[[:space:]])\\\\[([^\\\\]]+)\\\\]\\\\[[^\\\\]]+\\\\]'), LogAttributes['group_uid'])";
    const SUBJECT_EXPR = "if(empty(LogAttributes['subject']), extract(Body, '(?:^|[[:space:]])\\\\[[^\\\\]]+\\\\]\\\\[([^\\\\]]+)\\\\]'), LogAttributes['subject'])";
    const PARENT_GROUP_UID_EXPR = "if(empty(LogAttributes['parent_group_uid']), extract(Body, '(?:^|[[:space:]])parent=([^[:space:]]+)'), LogAttributes['parent_group_uid'])";
    // ClickHouse query parameters interpret C-style escapes. Keep this pattern
    // to the standard ESC-prefixed ANSI form: a C1 `\\x{009B}` escape is
    // decoded into an invalid standalone UTF-8 byte before RE2 sees it.
    const ANSI_QUERY_PATTERN = '\\x1B(?:\\[[0-?]*[ -/]*[@-~]|[@-_])';
    const EMPTY_WHITESPACE_QUERY_PATTERN = '[[:space:][:cntrl:]]+';
    // Where each label a line was sent with lives in otel_logs (the lines endpoint's own mapping).
    // A label not named here is a ResourceAttributes key of its own name.
    const LABEL_COLUMNS = {service: 'toString(ServiceName)', stream: "LogAttributes['log.iostream']"};
    const LABEL_RESOURCE_KEYS = {
        host: 'host.name',
        project: 'service.namespace',
        container: 'container.name',
        container_id: 'container.id',
        image: 'container.image.name',
    };
    const RESOURCE_LABEL_NAMES = Object.fromEntries(Object.entries(LABEL_RESOURCE_KEYS).map(v => [v[1], v[0]]));
    const LABEL_ORDER = ['remote', 'host', 'project', 'service', 'container', 'image', 'stream', 'container_id'];
    const LABELS_OPEN_BY_DEFAULT = ['remote', 'host', 'service'];
    const LABEL_VALUES_LIMIT = 40;
    const DISK_REFRESH_SECONDS = 60;
    const DISK_TABLES_SHOWN = 8;
    const EXPORT_FORMATS = [
        {value: 'text', label: 'Text', extension: 'txt', type: 'text/plain'},
        {value: 'jsonl', label: 'JSON Lines', extension: 'jsonl', type: 'application/jsonl'},
        {value: 'json', label: 'JSON', extension: 'json', type: 'application/json'},
    ];

    function compareLabelNames(left, right) {
        const a = LABEL_ORDER.indexOf(left);
        const b = LABEL_ORDER.indexOf(right);
        if (a !== b) {
            return ((a < 0) ? LABEL_ORDER.length : a) - ((b < 0) ? LABEL_ORDER.length : b);
        }
        return left.localeCompare(right);
    }

    function copyLabels(labels) {
        return Object.fromEntries(Object.entries(labels).map(v => [v[0], v[1].slice()]));
    }

    function looksLikeGroupUid(value) {
        return /^[a-z0-9][a-z0-9_.:-]{5,}$/i.test(value || '') && /[_:-]/.test(value);
    }

    const HighlightedText = {
        props: {
            text: {type: String, default: ''},
            terms: {type: Array, default: () => []},
        },
        render: function () {
            const terms = this.terms.filter(Boolean);
            if (!terms.length) {
                return this.text;
            }
            const escaped = terms
                .slice()
                .sort((a, b) => b.length - a.length)
                .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
            const nodes = [];
            let offset = 0;
            for (const match of this.text.matchAll(regex)) {
                if (match.index > offset) {
                    nodes.push(this.text.slice(offset, match.index));
                }
                nodes.push(h('mark', {class: 'match'}, match[0]));
                offset = match.index + match[0].length;
            }
            if (offset < this.text.length) {
                nodes.push(this.text.slice(offset));
            }
            return h(Fragment, null, nodes);
        },
    };

    function storedRefreshSeconds() {
        try {
            const value = Number(localStorage.getItem('logline-refresh-seconds'));
            return (Number.isFinite(value) && (value >= 1) && (value <= 300))
                ? value
                : DEFAULT_REFRESH_SECONDS;
        }
        catch {
            return DEFAULT_REFRESH_SECONDS;
        }
    }

    function storedBoolean(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return (value === null) ? fallback : value === 'true';
        }
        catch {
            return fallback;
        }
    }

    function storedExportFormat() {
        try {
            const value = localStorage.getItem('logline-export-format');
            return EXPORT_FORMATS.some(v => v.value === value) ? value : 'text';
        }
        catch {
            return 'text';
        }
    }

    function storedLabelGroups() {
        try {
            const value = JSON.parse(localStorage.getItem('logline-label-groups') || 'null');
            if (value && (typeof value === 'object') && !Array.isArray(value)) {
                return value;
            }
        }
        catch {
            // Every group starts as it does by default when browser storage is unavailable.
        }
        return Object.fromEntries(LABELS_OPEN_BY_DEFAULT.map(v => [v, true]));
    }

    createApp({
        components: {HighlightedText},

        data: function () {
            return {
                termsInput: '',
                labelFilter: {},
                labelFind: '',
                labelCatalog: [],
                labelGroupsOpen: storedLabelGroups(),
                labelTimer: null,
                labelGeneration: 0,
                rangeFrom: '',
                rangeTo: '',
                followLive: true,
                stripAnsiEnabled: true,
                ignoreEmptyEnabled: storedBoolean('logline-ignore-empty', false),
                refreshSeconds: storedRefreshSeconds(),
                lightTheme: document.documentElement.dataset.theme === 'light',
                activeRange: '1h',
                relativeRanges: RELATIVE_RANGES,
                calendarRanges: CALENDAR_RANGES,
                rangeOpen: false,
                rangeFromInput: '',
                rangeToInput: '',
                rangeError: '',
                rows: [],
                active: null,
                histogram: [],
                bucketSeconds: 60,
                hasMoreOlder: false,
                loadingOlder: false,
                loadingInitial: false,
                queryStatus: 'Ready',
                selectedRow: null,
                investigation: null,
                savedSearch: null,
                scrollTop: 0,
                viewportHeight: 500,
                rowHeight: ROW_HEIGHT,
                requestGeneration: 0,
                pollCount: 0,
                liveTimer: null,
                toastMessage: '',
                toastVisible: false,
                toastTimer: null,
                searchTimer: null,
                pendingSelection: null,
                sharing: false,
                picked: {},
                pickAnchor: null,
                pickBase: {},
                marquee: null,
                drag: null,
                dragFrame: null,
                suppressClick: false,
                exportFormat: storedExportFormat(),
                exportFormats: EXPORT_FORMATS,
                disk: null,
                diskError: '',
                diskOpen: false,
                diskTimer: null,
                scrollAnimationFrame: null,
                scrollAnimation: null,
                isAutoScrolling: false,
            };
        },

        computed: {
            canvasHeight: function () {
                return Math.max(this.rows.length*ROW_HEIGHT, this.viewportHeight);
            },

            visibleRows: function () {
                const first = Math.max(0, Math.floor(this.scrollTop/ROW_HEIGHT) - OVERSCAN);
                const count = Math.ceil(this.viewportHeight/ROW_HEIGHT) + OVERSCAN*2;
                return this.rows.slice(first, first + count).map((row, offset) => ({row, index: first + offset}));
            },

            eventCount: function () {
                return this.histogram.reduce((sum, point) => sum + Number(point.count), 0);
            },

            formattedEventCount: function () {
                return this.formatCount(this.eventCount);
            },

            // What the catalog found in this range, with every selected value kept in view even when
            // the range no longer has it, so a selection can always be seen and undone
            labelGroups: function () {
                const find = this.labelFind.trim().toLocaleLowerCase();
                const groups = new Map();
                for (const group of this.labelCatalog) {
                    groups.set(group.name, {name: group.name, total: group.total, values: group.values.slice()});
                }
                for (const [name, values] of Object.entries(this.labelFilter)) {
                    if (!groups.has(name)) {
                        groups.set(name, {name, total: 0, values: []});
                    }
                    const group = groups.get(name);
                    for (const value of values) {
                        if (!group.values.some(v => v.value === value)) {
                            group.values.push({value, count: 0});
                        }
                    }
                }
                const out = [];
                for (const group of groups.values()) {
                    const selected = this.labelFilter[group.name] || [];
                    const nameFound = !find || group.name.toLocaleLowerCase().includes(find);
                    const values = group.values.filter(v => nameFound || selected.includes(v.value) || v.value.toLocaleLowerCase().includes(find));
                    if (!values.length) {
                        continue;
                    }
                    const sum = Math.max(1, values.reduce((total, item) => total + item.count, 0));
                    out.push({
                        name: group.name,
                        open: Boolean(find) || Boolean(this.labelGroupsOpen[group.name]),
                        selected: selected.length,
                        total: group.total,
                        hidden: Math.max(0, group.total - group.values.filter(v => v.count).length),
                        values: values.map(v => ({value: v.value, count: v.count, selected: selected.includes(v.value), share: Math.round(v.count/sum*100)})),
                    });
                }
                out.sort((left, right) => compareLabelNames(left.name, right.name));
                return out;
            },

            labelChips: function () {
                return Object.keys(this.labelFilter)
                    .sort(compareLabelNames)
                    .flatMap(v => this.labelFilter[v].map(vv => ({name: v, value: vv})));
            },

            rowLabels: function () {
                return this.selectedRow ? this.labelsOfRow(this.selectedRow) : [];
            },

            rangeLabel: function () {
                const quick = [...RELATIVE_RANGES, ...CALENDAR_RANGES].find(v => v.value === this.activeRange);
                if (quick) {
                    return quick.label;
                }
                const from = new Date(this.rangeFrom);
                const to = new Date(this.rangeTo);
                if (Number.isNaN(from.getTime())) {
                    return 'Choose a range';
                }
                const day = {month: 'short', day: 'numeric'};
                const clock = {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false};
                const fromText = from.toLocaleString([], {...day, ...clock});
                if (this.followLive) {
                    return `${fromText} → now`;
                }
                const sameDay = from.toDateString() === to.toDateString();
                return `${fromText} → ${to.toLocaleString([], sameDay ? clock : {...day, ...clock})}`;
            },

            bucketLabel: function () {
                if (!this.active) {
                    return '';
                }
                return `${this.intervalLabel(this.bucketSeconds)} · click a bar to zoom`;
            },

            chartPoints: function () {
                if (!this.active) {
                    return [];
                }
                const from = Math.floor(new Date(this.active.from).getTime()/1000);
                const to = Math.ceil(new Date(this.active.to).getTime()/1000);
                const first = Math.floor(from/this.bucketSeconds)*this.bucketSeconds;
                const counts = new Map(this.histogram.map(v => [Number(v.bucket), Number(v.count)]));
                const out = [];
                for (let cursor = first; (cursor < to) && (out.length < 260); cursor += this.bucketSeconds) {
                    out.push({bucket: cursor, count: counts.get(cursor) || 0});
                }
                return out;
            },

            chartBars: function () {
                const points = this.chartPoints;
                if (!points.length) {
                    return [];
                }
                const max = Math.max(1, ...points.map(v => v.count));
                const slot = 1000/points.length;
                const gap = (points.length > 120) ? 0 : 1.5;
                const out = [];
                for (const [index, point] of points.entries()) {
                    const height = Math.max(point.count ? 1 : 0, (point.count/max)*60);
                    out.push({
                        bucket: point.bucket,
                        x: index*slot + gap/2,
                        y: 65 - height,
                        width: Math.max(0.8, slot - gap),
                        height,
                        title: `${new Date(point.bucket*1000).toLocaleString()} — ${this.formatCount(point.count)} events`,
                    });
                }
                return out;
            },

            rangeStartLabel: function () {
                return this.active ? this.shortTime(this.active.from) : '';
            },

            rangeEndLabel: function () {
                return this.active ? this.shortTime(this.active.to) : '';
            },

            detailMetadata: function () {
                if (!this.selectedRow) {
                    return [];
                }
                const row = this.selectedRow;
                return [
                    {name: 'Time', value: new Date(row.timestamp_ms).toLocaleString()},
                    {name: 'Severity', value: row.severity || '—'},
                    {name: 'Subject', value: row.subject || '—'},
                    {name: 'Group', value: row.group_uid || '—'},
                    {name: 'Parent', value: row.parent_group_uid || '—'},
                ];
            },

            // Picked lines stay picked across searches, so lines from several searches can be gathered
            // into one export; they go out oldest first
            pickedRows: function () {
                return Object.values(this.picked).sort((left, right) => (left.time_utc < right.time_utc) ? -1 : ((left.time_utc > right.time_utc) ? 1 : 0));
            },

            exportFormatNow: function () {
                return EXPORT_FORMATS.find(v => v.value === this.exportFormat) || EXPORT_FORMATS[0];
            },

            pickedCount: function () {
                return this.pickedRows.length;
            },

            pickedElsewhere: function () {
                const loaded = new Set(this.rows.map(v => v.key));
                return Object.keys(this.picked).filter(v => !loaded.has(v)).length;
            },

            loadedPicked: function () {
                const count = this.rows.filter(v => this.picked[v.key]).length;
                if (!count) {
                    return 'none';
                }
                return (count === this.rows.length) ? 'all' : 'some';
            },

            // How the disk splits between the log table, the rest ClickHouse keeps, whatever else is
            // on that disk, and what is left
            diskShares: function () {
                if (!this.disk || !this.disk.total) {
                    return [];
                }
                const total = this.disk.total;
                const others = Math.max(0, this.disk.used - this.disk.clickhouse);
                return [
                    {value: 'logs', label: 'Logs', bytes: this.disk.logs.bytes},
                    {value: 'clickhouse', label: 'Rest of ClickHouse', bytes: this.disk.clickhouse - this.disk.logs.bytes},
                    {value: 'others', label: 'Everything else', bytes: others},
                    {value: 'free', label: 'Free', bytes: this.disk.free},
                ].map(v => ({value: v.value, label: v.label, bytes: v.bytes, percent: v.bytes/total*100}));
            },

            diskLevel: function () {
                if (!this.disk || !this.disk.total) {
                    return '';
                }
                const free = this.disk.free/this.disk.total;
                if (free < 0.05) {
                    return 'error';
                }
                if (free < 0.1) {
                    return 'warn';
                }
                return '';
            },

            diskSummary: function () {
                if (this.diskError) {
                    return 'Disk: unknown';
                }
                if (!this.disk) {
                    return 'Disk…';
                }
                return `Logs ${this.formatBytes(this.disk.logs.bytes)} · ${this.formatBytes(this.disk.free)} free`;
            },

            investigationLabel: function () {
                if (!this.investigation) {
                    return '';
                }
                if (this.investigation.kind === 'context') {
                    const groupSuffix = this.investigation.groupUid ? ' + matching group · ±1 hour' : '';
                    return `Surrounding logs · ${this.investigation.service || 'all services'} · ±2 minutes${groupSuffix}`;
                }
                return `${(this.investigation.kind === 'parent') ? 'Parent group' : 'Group'} · ${this.investigation.groupUid}`;
            },
        },

        watch: {
            // A paused "Last 1 hour" is no longer the last hour: the label names the times instead
            followLive: function (value) {
                if (!value && this.activeRange && this.quickRange(this.activeRange).live) {
                    this.activeRange = null;
                }
            },

            lightTheme: function (value) {
                document.documentElement.dataset.theme = value ? 'light' : 'dark';
                try {
                    localStorage.setItem('logline-theme', value ? 'light' : 'dark');
                }
                catch {
                    // Theme persistence is optional when browser storage is disabled.
                }
            },
        },

        mounted: function () {
            this.initializeRange(3600);
            this.loadStateFromUrl();
            this.$nextTick(this.measureViewport);
            window.addEventListener('resize', this.measureViewport);
            window.addEventListener('keydown', this.onGlobalKeydown);
            window.addEventListener('click', this.closeDisk);
            window.addEventListener('click', this.closeRange);
            this.resetLiveTimer();
            this.runSearch();
            this.refreshDisk();
            this.diskTimer = window.setInterval(this.refreshDisk, DISK_REFRESH_SECONDS*1000);
        },

        beforeUnmount: function () {
            window.removeEventListener('resize', this.measureViewport);
            window.removeEventListener('keydown', this.onGlobalKeydown);
            window.removeEventListener('click', this.closeDisk);
            window.removeEventListener('click', this.closeRange);
            this.onDragEnd();
            window.clearInterval(this.liveTimer);
            window.clearInterval(this.diskTimer);
            window.clearTimeout(this.toastTimer);
            window.clearTimeout(this.searchTimer);
            window.clearTimeout(this.labelTimer);
            window.cancelAnimationFrame(this.scrollAnimationFrame);
        },

        methods: {
            toLocalInputValue: function (date) {
                const shifted = new Date(date.getTime() - date.getTimezoneOffset()*60_000);
                return shifted.toISOString().slice(0, 19);
            },

            initializeRange: function (seconds) {
                const now = new Date();
                this.rangeTo = this.toLocalInputValue(now);
                this.rangeFrom = this.toLocalInputValue(new Date(now.getTime() - seconds*1000));
            },

            readTerms: function () {
                const include = [];
                const exclude = [];
                const seenInclude = new Set();
                const seenExclude = new Set();
                for (const expression of this.termsInput.trim().split(/\s+/).filter(Boolean)) {
                    const isExclude = expression.startsWith('!');
                    const term = (isExclude ? expression.slice(1) : expression).trim();
                    if (!term) {
                        continue;
                    }
                    const normalized = term.toLocaleLowerCase();
                    const seen = isExclude ? seenExclude : seenInclude;
                    const target = isExclude ? exclude : include;
                    if (!seen.has(normalized)) {
                        seen.add(normalized);
                        target.push(term);
                    }
                    if (include.length + exclude.length >= 20) {
                        break;
                    }
                }
                return {include, exclude};
            },

            readFilters: function () {
                const fromDate = new Date(this.rangeFrom);
                const toDate = this.followLive ? new Date() : new Date(this.rangeTo);
                if (!this.rangeFrom || Number.isNaN(fromDate.getTime())) {
                    throw new Error('Choose a valid start time.');
                }
                if ((!this.followLive && !this.rangeTo) || Number.isNaN(toDate.getTime())) {
                    throw new Error('Choose a valid end time.');
                }
                if (fromDate >= toDate) {
                    throw new Error('The start time must be before the end time.');
                }
                if (this.followLive) {
                    this.rangeTo = this.toLocalInputValue(toDate);
                }
                const terms = this.readTerms();
                return {
                    terms: terms.include,
                    excludeTerms: terms.exclude,
                    from: fromDate.toISOString(),
                    to: toDate.toISOString(),
                    labels: copyLabels(this.labelFilter),
                    containerId: (this.investigation && (this.investigation.kind !== 'context')) ? this.investigation.containerId || '' : '',
                    groupUid: (this.investigation && (this.investigation.kind !== 'context')) ? this.investigation.groupUid || '' : '',
                    ignoreEmpty: this.ignoreEmptyEnabled,
                    context: (this.investigation?.kind === 'context') ? {
                        from: this.investigation.contextFrom,
                        to: this.investigation.contextTo,
                        service: this.investigation.service || '',
                        containerId: this.investigation.containerId || '',
                        groupUid: this.investigation.groupUid || '',
                    } : null,
                };
            },

            loadStateFromUrl: function () {
                const params = new URLSearchParams(window.location.search);
                const hasSharedState = ['q', 'label', 'filter_service', 'hide_empty', 'from', 'to', 'range', 'scope', 'at'].some(v => params.has(v));
                if (!hasSharedState) {
                    return;
                }

                this.termsInput = params.get('q') || '';
                const from = new Date(params.get('from') || '');
                const to = new Date(params.get('to') || '');
                // A range by its name — `range=24h`, `range=today` — is the quick range itself, live
                // where it ends now. Times are a range of their own. A link with neither, only labels
                // to filter by, opens on the range the page opens on, following live.
                const quick = [...RELATIVE_RANGES, ...CALENDAR_RANGES].find(v => v.value === params.get('range'));
                if (quick !== undefined) {
                    const picked = this.quickRange(quick.value);
                    this.rangeFrom = this.toLocalInputValue(picked.from);
                    this.rangeTo = this.toLocalInputValue(picked.to);
                    this.followLive = picked.live;
                    this.activeRange = quick.value;
                }
                else if (!Number.isNaN(from.getTime()) || !Number.isNaN(to.getTime())) {
                    if (!Number.isNaN(from.getTime())) {
                        this.rangeFrom = this.toLocalInputValue(from);
                    }
                    if (!Number.isNaN(to.getTime())) {
                        this.rangeTo = this.toLocalInputValue(to);
                    }
                    this.followLive = params.get('live') === '1';
                    this.activeRange = null;
                }

                const scope = params.get('scope');
                const service = params.get('service') || '';
                const containerId = params.get('container') || '';
                const groupUid = params.get('group') || '';
                const labels = {};
                for (const pair of params.getAll('label')) {
                    const split = pair.indexOf(':');
                    if (split < 1) {
                        continue;
                    }
                    const name = pair.slice(0, split);
                    const value = pair.slice(split + 1);
                    if (!labels[name]) {
                        labels[name] = [];
                    }
                    if (!labels[name].includes(value)) {
                        labels[name].push(value);
                    }
                }
                // Links made before labels said the one service they were filtered by this way
                const legacyService = params.get('filter_service') || (((scope === 'context') && !params.has('label')) ? service : '');
                if (legacyService && !labels.service) {
                    labels.service = [legacyService];
                }
                this.labelFilter = labels;
                if (params.has('hide_empty')) {
                    this.ignoreEmptyEnabled = params.get('hide_empty') === '1';
                }
                const sharedContextFrom = new Date(params.get('context_from') || '');
                const sharedContextTo = new Date(params.get('context_to') || '');
                const fallbackContextFrom = Number.isNaN(from.getTime()) ? new Date(this.rangeFrom) : from;
                const fallbackContextTo = Number.isNaN(to.getTime()) ? new Date(this.rangeTo) : to;
                if ((scope === 'context') && (service || containerId)) {
                    this.investigation = {
                        kind: 'context',
                        service,
                        containerId,
                        groupUid,
                        contextFrom: Number.isNaN(sharedContextFrom.getTime()) ? fallbackContextFrom.toISOString() : sharedContextFrom.toISOString(),
                        contextTo: Number.isNaN(sharedContextTo.getTime()) ? fallbackContextTo.toISOString() : sharedContextTo.toISOString(),
                        anchorKey: '',
                    };
                }
                else if (((scope === 'group') || (scope === 'parent')) && groupUid) {
                    this.investigation = {kind: scope, service: '', containerId: '', groupUid, anchorKey: ''};
                }

                const cursor = params.get('at');
                if (cursor) {
                    this.pendingSelection = {
                        cursor,
                        service: params.get('at_service') || '',
                    };
                }
            },

            syncUrlState: function () {
                if (!this.active) {
                    return;
                }
                const params = new URLSearchParams();
                if (this.termsInput) {
                    params.set('q', this.termsInput);
                }
                for (const chip of this.labelChips) {
                    params.append('label', `${chip.name}:${chip.value}`);
                }
                params.set('hide_empty', this.ignoreEmptyEnabled ? '1' : '0');
                params.set('from', this.active.from);
                params.set('to', this.active.to);
                if (this.followLive) {
                    params.set('live', '1');
                }

                if (this.investigation) {
                    params.set('scope', this.investigation.kind);
                    if (this.investigation.service) {
                        params.set('service', this.investigation.service);
                    }
                    if (this.investigation.containerId) {
                        params.set('container', this.investigation.containerId);
                    }
                    if (this.investigation.groupUid) {
                        params.set('group', this.investigation.groupUid);
                    }
                    if (this.investigation.contextFrom) {
                        params.set('context_from', this.investigation.contextFrom);
                    }
                    if (this.investigation.contextTo) {
                        params.set('context_to', this.investigation.contextTo);
                    }
                }

                const selected = this.selectedRow || this.pendingSelection;
                if (selected) {
                    params.set('at', selected.cursor);
                    if (selected.service) {
                        params.set('at_service', selected.service);
                    }
                }

                const url = new URL(window.location.href);
                url.search = params.toString();
                window.history.replaceState(null, '', url);
            },

            restoreSelectionFromUrl: async function (filters = this.active) {
                if (!this.pendingSelection) {
                    return;
                }
                const target = this.pendingSelection;
                let row = this.rows.find(v => (v.cursor === target.cursor) && (!target.service || (v.service === target.service)));
                if (!row && filters) {
                    const rawRows = await this.queryRows(filters, {
                        at: target.cursor,
                        atService: target.service,
                        limit: 1,
                    });
                    if (rawRows.length) {
                        row = this.normalizeRow(rawRows[0]);
                    }
                }
                if (row) {
                    this.selectedRow = row;
                }
                this.pendingSelection = null;
            },

            buildWhere: function (filters, options = {}) {
                const params = new URLSearchParams({
                    default_format: 'JSONEachRow',
                    param_range_from: filters.from,
                    param_range_to: filters.to,
                });
                const clauses = [
                    "Timestamp >= parseDateTime64BestEffort({range_from:String}, 9, 'UTC')",
                    "Timestamp < parseDateTime64BestEffort({range_to:String}, 9, 'UTC')",
                ];
                for (const [index, term] of filters.terms.entries()) {
                    const name = `term_${index}`;
                    params.set(`param_${name}`, term);
                    clauses.push(`positionCaseInsensitive(Body, {${name}:String}) > 0`);
                }
                for (const [index, term] of filters.excludeTerms.entries()) {
                    const name = `exclude_term_${index}`;
                    params.set(`param_${name}`, term);
                    clauses.push(`positionCaseInsensitive(Body, {${name}:String}) = 0`);
                }
                if (filters.ignoreEmpty) {
                    params.set('param_empty_ansi_pattern', ANSI_QUERY_PATTERN);
                    params.set('param_empty_whitespace_pattern', EMPTY_WHITESPACE_QUERY_PATTERN);
                    clauses.push(`notEmpty(replaceRegexpAll(
            replaceRegexpAll(Body, {empty_ansi_pattern:String}, ''),
            {empty_whitespace_pattern:String},
            ''
          ))`);
                }
                if (filters.context) {
                    params.set('param_context_from', filters.context.from);
                    params.set('param_context_to', filters.context.to);
                    const sourceClauses = [];
                    if (filters.context.containerId) {
                        params.set('param_context_container_id', filters.context.containerId);
                        sourceClauses.push("ResourceAttributes['container.id'] = {context_container_id:String}");
                    }
                    else if (filters.context.service) {
                        params.set('param_context_service', filters.context.service);
                        sourceClauses.push('ServiceName = {context_service:String}');
                    }
                    const nearby = [
                        "Timestamp >= parseDateTime64BestEffort({context_from:String}, 9, 'UTC')",
                        "Timestamp < parseDateTime64BestEffort({context_to:String}, 9, 'UTC')",
                        ...sourceClauses,
                    ].join(' AND ');
                    const contextBranches = [`(${nearby})`];
                    if (filters.context.groupUid) {
                        params.set('param_context_group_uid', filters.context.groupUid);
                        contextBranches.push(`(${GROUP_UID_EXPR} = {context_group_uid:String})`);
                    }
                    clauses.push(`(${contextBranches.join(' OR ')})`);
                }
                if (!options.withoutLabels) {
                    clauses.push(...Object.values(this.labelConditions(filters.labels, params)));
                }
                if (filters.containerId) {
                    params.set('param_container_id', filters.containerId);
                    clauses.push("ResourceAttributes['container.id'] = {container_id:String}");
                }
                if (filters.groupUid) {
                    params.set('param_group_uid', filters.groupUid);
                    clauses.push(`${GROUP_UID_EXPR} = {group_uid:String}`);
                }
                if (options.before) {
                    params.set('param_before_cursor', options.before);
                    clauses.push("Timestamp < parseDateTime64BestEffort({before_cursor:String}, 9, 'UTC')");
                }
                if (options.after) {
                    params.set('param_after_cursor', options.after);
                    clauses.push("Timestamp > parseDateTime64BestEffort({after_cursor:String}, 9, 'UTC')");
                }
                if (options.at) {
                    params.set('param_at_cursor', options.at);
                    clauses.push("Timestamp = parseDateTime64BestEffort({at_cursor:String}, 9, 'UTC')");
                }
                if (options.atService) {
                    params.set('param_at_service', options.atService);
                    clauses.push('ServiceName = {at_service:String}');
                }
                return {where: clauses.join('\n  AND '), params};
            },

            // One condition per selected label name: any of its values (OR); across names, all (AND)
            labelConditions: function (labels, params) {
                const out = {};
                for (const [index, name] of Object.keys(labels).sort().entries()) {
                    const expression = this.labelExpression(name, index, params);
                    const alternatives = [];
                    for (const [offset, value] of labels[name].entries()) {
                        params.set(`param_label_${index}_${offset}`, value);
                        alternatives.push(`${expression} = {label_${index}_${offset}:String}`);
                    }
                    if (alternatives.length) {
                        out[name] = `(${alternatives.join(' OR ')})`;
                    }
                }
                return out;
            },

            labelExpression: function (name, index, params) {
                if (LABEL_COLUMNS[name]) {
                    return LABEL_COLUMNS[name];
                }
                if (LABEL_RESOURCE_KEYS[name]) {
                    return `ResourceAttributes['${LABEL_RESOURCE_KEYS[name]}']`;
                }
                params.set(`param_label_key_${index}`, name);
                return `ResourceAttributes[{label_key_${index}:String}]`;
            },

            clickhouse: async function (sql, params) {
                const response = await fetch(`/clickhouse?${params.toString()}`, {
                    method: 'POST',
                    credentials: 'omit',
                    headers: {'Content-Type': 'text/plain; charset=utf-8'},
                    body: sql,
                });
                const text = await response.text();
                if (!response.ok) {
                    throw new Error(text.replace(/^Code: \d+\. DB::Exception: /, '').trim() || `ClickHouse returned HTTP ${response.status}`);
                }
                if (!text.trim()) {
                    return [];
                }
                return text.trim().split('\n').map(v => JSON.parse(v));
            },

            queryRows: async function (filters, options = {}) {
                const {where, params} = this.buildWhere(filters, options);
                params.set('param_page_size', String(options.limit || PAGE_SIZE));
                const direction = (options.direction === 'asc') ? 'ASC' : 'DESC';
                const sql = `
                    SELECT
                        toString(Timestamp) AS cursor,
                        toString(Timestamp, 'UTC') AS time_utc,
                        toUnixTimestamp64Milli(Timestamp) AS timestamp_ms,
                        ServiceName AS service,
                        SeverityText AS severity,
                        Body AS body,
                        LogAttributes['log.iostream'] AS stream,
                        ${SUBJECT_EXPR} AS subject,
                        ${GROUP_UID_EXPR} AS group_uid,
                        ${PARENT_GROUP_UID_EXPR} AS parent_group_uid,
                        ResourceAttributes['container.image.name'] AS image,
                        ResourceAttributes['container.id'] AS container_id,
                        ResourceAttributes AS resource
                    FROM
                        default.otel_logs
                    WHERE
                        ${where}
                    ORDER BY
                        Timestamp ${direction}
                    LIMIT
                        {page_size:UInt32}
                    FORMAT
                        JSONEachRow
                `;
                return this.clickhouse(sql, params);
            },

            chooseBucket: function (from, to) {
                const target = Math.max(1, (new Date(to) - new Date(from))/1000)/90;
                return BUCKETS.find(v => v >= target) || BUCKETS[BUCKETS.length - 1];
            },

            queryHistogram: async function (filters) {
                const bucketSeconds = this.chooseBucket(filters.from, filters.to);
                const {where, params} = this.buildWhere(filters);
                const sql = `
                    SELECT
                        toUnixTimestamp(toStartOfInterval(Timestamp, INTERVAL ${bucketSeconds} SECOND)) AS bucket,
                        count() AS count
                    FROM
                        default.otel_logs
                    WHERE
                        ${where}
                    GROUP BY
                        bucket
                    ORDER BY
                        bucket
                    FORMAT
                        JSONEachRow
                `;
                return {bucketSeconds, data: await this.clickhouse(sql, params)};
            },

            // Every label name and its most frequent values in the range, counted the way facets are:
            // a value's count keeps every other filter, including the other labels, but not its own
            // label's selection, so choosing a second host still shows how many lines it has
            queryLabels: async function (filters) {
                const {where, params} = this.buildWhere(filters, {withoutLabels: true});
                const conditions = this.labelConditions(filters.labels, params);
                const names = Object.keys(conditions);
                function allOf(skip) {
                    return names.filter(v => v !== skip).map(v => conditions[v]).join(' AND ') || '1';
                }
                const branches = [];
                for (const [index, name] of names.entries()) {
                    params.set(`param_label_name_${index}`, name);
                    branches.push(`label.1 = {label_name_${index}:String}, ${allOf(name)}`);
                }
                const hits = names.length ? `countIf(multiIf(${[...branches, allOf(null)].join(',\n    ')}))` : 'count()';
                const renames = Object.entries(RESOURCE_LABEL_NAMES)
                    .map(v => `key = '${v[0]}', '${v[1]}'`)
                    .join(', ');
                const find = this.labelFind.trim();
                if (find) {
                    params.set('param_label_find', find);
                }
                params.set('param_label_values_limit', String(LABEL_VALUES_LIMIT));
                const sql = `
                    SELECT
                        label.1 AS name,
                        label.2 AS value,
                        ${hits} AS hits,
                        count() OVER (PARTITION BY name) AS value_count
                    FROM
                        default.otel_logs
                    ARRAY JOIN
                        arrayConcat(
                            [('service', ${LABEL_COLUMNS.service}), ('stream', ${LABEL_COLUMNS.stream})],
                            arrayMap((key, value) -> (multiIf(${renames}, toString(key)), value), mapKeys(ResourceAttributes), mapValues(ResourceAttributes))
                        ) AS label
                    WHERE
                        ${where}
                        AND notEmpty(label.2)${find ? `
                        AND (positionCaseInsensitive(label.1, {label_find:String}) > 0 OR positionCaseInsensitive(label.2, {label_find:String}) > 0)` : ''}
                    GROUP BY
                        name, value
                    HAVING
                        hits > 0
                    ORDER BY
                        name, hits DESC, value
                    LIMIT
                        {label_values_limit:UInt32} BY name
                    FORMAT
                        JSONEachRow
                `;
                const groups = new Map();
                for (const row of await this.clickhouse(sql, params)) {
                    if (!groups.has(row.name)) {
                        groups.set(row.name, {name: row.name, total: Number(row.value_count), values: []});
                    }
                    groups.get(row.name).values.push({value: row.value, count: Number(row.hits)});
                }
                return [...groups.values()];
            },

            scheduleLabels: function () {
                window.clearTimeout(this.labelTimer);
                this.labelTimer = window.setTimeout(this.refreshLabels, 300);
            },

            refreshLabels: async function () {
                if (!this.active) {
                    return;
                }
                const generation = ++this.labelGeneration;
                try {
                    const catalog = await this.queryLabels(this.active);
                    if (generation === this.labelGeneration) {
                        this.labelCatalog = catalog;
                    }
                }
                catch (error) {
                    console.error('Could not refresh labels', error);
                }
            },

            labelsOfRow: function (row) {
                const labels = [];
                if (row.service) {
                    labels.push({name: 'service', value: row.service});
                }
                if (row.stream) {
                    labels.push({name: 'stream', value: row.stream});
                }
                for (const [key, value] of Object.entries(row.resource || {})) {
                    if (value) {
                        labels.push({name: RESOURCE_LABEL_NAMES[key] || key, value});
                    }
                }
                return labels.sort((left, right) => compareLabelNames(left.name, right.name));
            },

            labelSelected: function (name, value) {
                return Boolean(this.labelFilter[name]?.includes(value));
            },

            toggleLabel: function (name, value) {
                const labels = copyLabels(this.labelFilter);
                const values = labels[name] || [];
                labels[name] = values.includes(value) ? values.filter(v => v !== value) : [...values, value];
                if (!labels[name].length) {
                    delete labels[name];
                }
                this.labelFilter = labels;
                this.applyLabelFilter(name);
            },

            clearLabels: function () {
                this.labelFilter = {};
                this.applyLabelFilter('service');
            },

            // Surroundings follow the service chosen here, the way they followed the service select
            applyLabelFilter: function (changed) {
                if ((this.investigation?.kind === 'context') && (changed === 'service')) {
                    const services = this.labelFilter.service || [];
                    this.investigation.service = (services.length === 1) ? services[0] : '';
                    this.investigation.containerId = '';
                }
                this.runSearch();
            },

            toggleLabelGroup: function (name) {
                this.labelGroupsOpen = {...this.labelGroupsOpen, [name]: !this.labelGroupsOpen[name]};
                try {
                    localStorage.setItem('logline-label-groups', JSON.stringify(this.labelGroupsOpen));
                }
                catch {
                    // Groups still open and close when browser storage is unavailable.
                }
            },

            // Sizes only: the viewer's ClickHouse user reads these columns of system.parts and
            // system.disks and nothing else there
            queryDisk: async function () {
                const params = new URLSearchParams({default_format: 'JSONEachRow'});
                const [tables, disks, since] = await Promise.all([
                    this.clickhouse(`
                        SELECT
                            database,
                            table,
                            sum(rows) AS rows,
                            sum(bytes_on_disk) AS bytes,
                            sum(data_uncompressed_bytes) AS raw
                        FROM
                            system.parts
                        WHERE
                            active
                        GROUP BY
                            database, table
                        ORDER BY
                            bytes DESC
                        FORMAT
                            JSONEachRow
                    `, params),
                    this.clickhouse(`
                        SELECT
                            sum(free_space) AS free,
                            sum(total_space) AS total
                        FROM
                            system.disks
                        WHERE
                            name = 'default'
                        FORMAT
                            JSONEachRow
                    `, params),
                    // Only a note beside the sizes: without it they are still worth showing
                    this.clickhouse(`
                        SELECT
                            toUnixTimestamp(min(Timestamp)) AS since
                        FROM
                            default.otel_logs
                        FORMAT
                            JSONEachRow
                    `, params).catch(function (error) {
                        console.error('Could not read the oldest line', error);
                        return [];
                    }),
                ]);
                const sized = tables.map(v => ({name: `${v.database}.${v.table}`, rows: Number(v.rows), bytes: Number(v.bytes), raw: Number(v.raw)}));
                const logs = sized.find(v => v.name === 'default.otel_logs') || {name: 'default.otel_logs', rows: 0, bytes: 0, raw: 0};
                const total = Number(disks[0]?.total || 0);
                const free = Number(disks[0]?.free || 0);
                const sinceSeconds = Number(since[0]?.since || 0);
                return {
                    logs: {rows: logs.rows, bytes: logs.bytes, raw: logs.raw, since: (logs.rows && sinceSeconds) ? sinceSeconds*1000 : null},
                    clickhouse: sized.reduce((sum, item) => sum + item.bytes, 0),
                    tables: sized.slice(0, DISK_TABLES_SHOWN),
                    tablesHidden: Math.max(0, sized.length - DISK_TABLES_SHOWN),
                    total,
                    free,
                    used: total - free,
                };
            },

            refreshDisk: async function () {
                try {
                    this.disk = await this.queryDisk();
                    this.diskError = '';
                }
                catch (error) {
                    this.diskError = error.message;
                    console.error('Could not read disk usage', error);
                }
            },

            onRowClick: function (row, event) {
                // The click that ends a drag belongs to the drag
                if (this.suppressClick) {
                    this.suppressClick = false;
                    return;
                }
                if (event.shiftKey || event.ctrlKey || event.metaKey) {
                    this.togglePick(row, event);
                    return;
                }
                this.openDetail(row);
            },

            // Ctrl/Command toggles one line; Shift sets every line from the last one picked to this
            // one to that line's state, over what was picked before, so Shift+clicks back and forth
            // move the end of one range
            togglePick: function (row, event) {
                const anchor = (this.pickAnchor === null) ? -1 : this.rows.findIndex(v => v.key === this.pickAnchor);
                const index = this.rows.findIndex(v => v.key === row.key);
                if (event?.shiftKey && (anchor >= 0) && (index >= 0)) {
                    const picked = {...this.pickBase};
                    const pick = Boolean(this.pickBase[this.pickAnchor]);
                    for (const item of this.rows.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) {
                        if (pick) {
                            picked[item.key] = item;
                        }
                        else {
                            delete picked[item.key];
                        }
                    }
                    this.picked = picked;
                    return;
                }
                const picked = {...this.picked};
                if (picked[row.key]) {
                    delete picked[row.key];
                }
                else {
                    picked[row.key] = row;
                }
                this.picked = picked;
                this.setPickAnchor(row.key);
            },

            setPickAnchor: function (key) {
                this.pickAnchor = key;
                this.pickBase = {...this.picked};
            },

            // A drag over the list draws a rectangle and picks the lines it crosses: alone it replaces
            // what is picked among the loaded lines, with Shift it adds, with Ctrl/Command it toggles.
            // Lines picked in other searches are left as they are.
            onViewportPointerdown: function (event) {
                this.cancelAutoScroll();
                if ((event.button !== 0) || (event.pointerType === 'touch') || event.target.closest('.row-check')) {
                    return;
                }
                const point = this.canvasPoint(event);
                const index = Math.floor(point.y/ROW_HEIGHT);
                this.drag = {
                    mode: (event.ctrlKey || event.metaKey) ? 'toggle' : (event.shiftKey ? 'add' : 'replace'),
                    clientX0: event.clientX,
                    clientY0: event.clientY,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    startX: point.x,
                    // Kept against its row, so older lines loading above do not move the start
                    startKey: this.rows[index]?.key ?? null,
                    startOffset: this.rows[index] ? point.y - index*ROW_HEIGHT : point.y,
                    base: {...this.picked},
                    started: false,
                };
                window.addEventListener('pointermove', this.onDragMove);
                window.addEventListener('pointerup', this.onDragEnd);
                window.addEventListener('pointercancel', this.onDragEnd);
            },

            canvasPoint: function (event) {
                const viewport = this.$refs.viewport;
                const box = viewport.getBoundingClientRect();
                return {
                    x: event.clientX - box.left + viewport.scrollLeft,
                    y: event.clientY - box.top + viewport.scrollTop,
                };
            },

            onDragMove: function (event) {
                const drag = this.drag;
                if (!drag) {
                    return;
                }
                drag.clientX = event.clientX;
                drag.clientY = event.clientY;
                if (!drag.started) {
                    // Below the threshold it is still a click
                    if (Math.hypot(event.clientX - drag.clientX0, event.clientY - drag.clientY0) < MARQUEE_THRESHOLD) {
                        return;
                    }
                    drag.started = true;
                    this.followLive = false;
                    this.dragFrame = window.requestAnimationFrame(this.dragStep);
                }
                this.dragUpdate();
            },

            // While the pointer is held past the top or bottom edge the list scrolls under it
            dragStep: function () {
                const drag = this.drag;
                const viewport = this.$refs.viewport;
                if (!drag || !viewport) {
                    return;
                }
                const box = viewport.getBoundingClientRect();
                let speed = 0;
                if (drag.clientY < box.top + MARQUEE_EDGE) {
                    speed = -Math.min(40, (box.top + MARQUEE_EDGE - drag.clientY)/2);
                }
                if (drag.clientY > box.bottom - MARQUEE_EDGE) {
                    speed = Math.min(40, (drag.clientY - box.bottom + MARQUEE_EDGE)/2);
                }
                if (speed) {
                    viewport.scrollTop += speed;
                    this.dragUpdate();
                }
                this.dragFrame = window.requestAnimationFrame(this.dragStep);
            },

            dragUpdate: function () {
                const drag = this.drag;
                const viewport = this.$refs.viewport;
                if (!drag || !drag.started || !viewport) {
                    return;
                }
                const box = viewport.getBoundingClientRect();
                const clientY = Math.min(box.bottom, Math.max(box.top, drag.clientY));
                const point = this.canvasPoint({clientX: drag.clientX, clientY});
                const startIndex = (drag.startKey === null) ? -1 : this.rows.findIndex(v => v.key === drag.startKey);
                const startY = (startIndex < 0) ? drag.startOffset : startIndex*ROW_HEIGHT + drag.startOffset;
                const top = Math.max(0, Math.min(startY, point.y));
                const bottom = Math.max(startY, point.y);
                this.marquee = {
                    left: Math.min(drag.startX, point.x),
                    top,
                    width: Math.abs(point.x - drag.startX),
                    height: bottom - top,
                };
                const crossed = this.rows.slice(Math.floor(top/ROW_HEIGHT), Math.floor(bottom/ROW_HEIGHT) + 1);
                const picked = {...drag.base};
                if (drag.mode === 'replace') {
                    for (const row of this.rows) {
                        delete picked[row.key];
                    }
                }
                for (const row of crossed) {
                    if ((drag.mode === 'toggle') && drag.base[row.key]) {
                        delete picked[row.key];
                    }
                    else {
                        picked[row.key] = row;
                    }
                }
                this.picked = picked;
                drag.first = crossed[0]?.key ?? null;
            },

            onDragEnd: function () {
                const drag = this.drag;
                window.removeEventListener('pointermove', this.onDragMove);
                window.removeEventListener('pointerup', this.onDragEnd);
                window.removeEventListener('pointercancel', this.onDragEnd);
                window.cancelAnimationFrame(this.dragFrame);
                this.dragFrame = null;
                this.drag = null;
                this.marquee = null;
                if (!drag || !drag.started) {
                    return;
                }
                // The browser follows a release over the row it went down on with a click; any other
                // release has none, and the flag must not wait for the next real one
                this.suppressClick = true;
                window.setTimeout(this.allowClick, 0);
                this.setPickAnchor(drag.startKey ?? drag.first);
            },

            allowClick: function () {
                this.suppressClick = false;
            },

            onViewportKeydown: function (event) {
                if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'a')) {
                    event.preventDefault();
                    const picked = {...this.picked};
                    for (const row of this.rows) {
                        picked[row.key] = row;
                    }
                    this.picked = picked;
                    this.setPickAnchor(null);
                }
            },

            toggleLoadedPicks: function () {
                const picked = {...this.picked};
                const pick = this.loadedPicked !== 'all';
                for (const row of this.rows) {
                    if (pick) {
                        picked[row.key] = row;
                    }
                    else {
                        delete picked[row.key];
                    }
                }
                this.picked = picked;
                this.setPickAnchor(null);
            },

            clearPicks: function () {
                this.picked = {};
                this.setPickAnchor(null);
            },

            setExportFormat: function (value) {
                this.exportFormat = value;
                try {
                    localStorage.setItem('logline-export-format', value);
                }
                catch {
                    // The format is still used for this visit when browser storage is unavailable.
                }
            },

            // Text is the lines as shown, each with its time in front the way the rules write it;
            // JSON is what the lines endpoint accepts, {time, labels, line}, with the line as it was sent
            exportPicked: function (format) {
                if (format === 'text') {
                    return `${this.pickedRows.map(v => this.exportText(v)).join('\n')}\n`;
                }
                const items = this.pickedRows.map(v => this.exportItem(v));
                if (format === 'jsonl') {
                    return `${items.map(v => JSON.stringify(v)).join('\n')}\n`;
                }
                return `${JSON.stringify(items, null, 2)}\n`;
            },

            exportText: function (row) {
                const body = this.displayBody(row.body);
                return `[${new Date(row.timestamp_ms).toISOString()}]${body.startsWith('[') ? '' : ' '}${body}`;
            },

            exportItem: function (row) {
                return {
                    time: `${row.time_utc.replace(' ', 'T')}Z`,
                    labels: Object.fromEntries(this.labelsOfRow(row).map(v => [v.name, v.value])),
                    line: row.body,
                };
            },

            copyPicked: async function () {
                const count = this.pickedCount;
                try {
                    await this.copyText(this.exportPicked(this.exportFormat));
                    this.showToast(`Copied ${this.formatCount(count)} ${(count === 1) ? 'line' : 'lines'} as ${this.exportFormatNow.label}`);
                }
                catch (error) {
                    this.showToast(`Could not copy: ${error.message}`);
                }
            },

            savePicked: function () {
                const format = this.exportFormatNow;
                const blob = new Blob([this.exportPicked(this.exportFormat)], {type: `${format.type};charset=utf-8`});
                const link = document.createElement('a');
                const stamp = this.toLocalInputValue(new Date()).replace('T', '_').replace(/:/g, '-');
                link.href = URL.createObjectURL(blob);
                link.download = `logline-${stamp}-${this.pickedCount}-lines.${format.extension}`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            },

            toggleDisk: function () {
                this.diskOpen = !this.diskOpen;
                if (this.diskOpen) {
                    this.refreshDisk();
                }
            },

            closeDisk: function () {
                this.diskOpen = false;
            },

            normalizeRow: function (row) {
                return {
                    ...row,
                    timestamp_ms: Number(row.timestamp_ms),
                    body: String(row.body ?? ''),
                    key: `${row.cursor}\u0000${row.service}\u0000${row.body}`,
                };
            },

            deduplicate: function (rows, known = new Set()) {
                const out = [];
                for (const raw of rows) {
                    const row = this.normalizeRow(raw);
                    if (!known.has(row.key)) {
                        known.add(row.key);
                        out.push(row);
                    }
                }
                return out;
            },

            runSearch: async function () {
                window.clearTimeout(this.searchTimer);
                let filters;
                try {
                    filters = this.readFilters();
                }
                catch (error) {
                    this.showToast(error.message);
                    return false;
                }
                const generation = ++this.requestGeneration;
                this.active = filters;
                this.rows = [];
                this.selectedRow = null;
                this.hasMoreOlder = false;
                this.loadingInitial = true;
                this.scrollTop = 0;
                if (this.$refs.viewport) {
                    this.$refs.viewport.scrollTop = 0;
                }
                this.queryStatus = 'Querying…';
                try {
                    const time0 = performance.now();
                    const labelGeneration = ++this.labelGeneration;
                    const [rawRows, histogram, labels] = await Promise.all([
                        this.queryRows(filters),
                        this.queryHistogram(filters),
                        this.queryLabels(filters).catch(this.labelsKept),
                    ]);
                    if (generation !== this.requestGeneration) {
                        return;
                    }
                    if (labelGeneration === this.labelGeneration) {
                        this.labelCatalog = labels;
                    }
                    this.rows = this.deduplicate(rawRows).reverse();
                    this.hasMoreOlder = rawRows.length === PAGE_SIZE;
                    this.histogram = histogram.data;
                    this.bucketSeconds = histogram.bucketSeconds;
                    this.queryStatus = `${this.formatCount(this.rows.length)} loaded · ${Math.round(performance.now() - time0)} ms`;
                    await this.restoreSelectionFromUrl(filters);
                    this.$nextTick(this.scrollAfterSearch);
                    this.syncUrlState();
                    return true;
                }
                catch (error) {
                    if (generation !== this.requestGeneration) {
                        return;
                    }
                    this.queryStatus = 'Query failed';
                    this.showToast(error.message);
                    console.error(error);
                    return false;
                }
                finally {
                    if (generation === this.requestGeneration) {
                        this.loadingInitial = false;
                    }
                }
            },

            // A failed label query keeps the labels already shown
            labelsKept: function (error) {
                console.error('Could not refresh labels', error);
                return this.labelCatalog;
            },

            scrollAfterSearch: function () {
                if (this.investigation?.anchorKey) {
                    this.scrollToInvestigationAnchor();
                }
                else if (this.selectedRow) {
                    this.scrollToSelectedRow();
                }
                else {
                    this.scrollToBottom();
                }
            },

            loadOlder: async function () {
                if (this.loadingOlder || !this.hasMoreOlder || !this.active || !this.rows.length) {
                    return;
                }
                this.loadingOlder = true;
                try {
                    const rawRows = await this.queryRows(this.active, {before: this.rows[0].cursor});
                    const known = new Set(this.rows.map(v => v.key));
                    const additions = this.deduplicate(rawRows, known).reverse();
                    const previousTop = this.$refs.viewport?.scrollTop || 0;
                    this.rows.unshift(...additions);
                    if (additions.length && this.$refs.viewport) {
                        const top = previousTop + additions.length*ROW_HEIGHT;
                        this.$nextTick(() => this.scrollViewportTo(top));
                    }
                    this.hasMoreOlder = rawRows.length === PAGE_SIZE;
                    this.queryStatus = `${this.formatCount(this.rows.length)} loaded`;
                    await this.restoreSelectionFromUrl(this.active);
                    this.syncUrlState();
                }
                catch (error) {
                    this.hasMoreOlder = false;
                    this.showToast(error.message);
                }
                finally {
                    this.loadingOlder = false;
                }
            },

            pollNewer: async function () {
                if (!this.followLive || !this.active || this.loadingInitial) {
                    return;
                }
                const time0 = performance.now();
                const now = new Date();
                const nextFilters = {...this.active, to: now.toISOString()};
                this.rangeTo = this.toLocalInputValue(now);
                try {
                    const wasEmpty = !this.rows.length;
                    const rawRows = wasEmpty
                        ? await this.queryRows(nextFilters)
                        : await this.queryRows(nextFilters, {
                            after: this.rows[this.rows.length - 1].cursor,
                            direction: 'asc',
                            limit: 1000,
                        });
                    this.active = nextFilters;
                    let additionsCount = 0;
                    if (rawRows.length) {
                        const known = new Set(this.rows.map(v => v.key));
                        const additions = this.deduplicate(rawRows, known);
                        if (wasEmpty) {
                            additions.reverse();
                        }
                        additionsCount = additions.length;
                        this.rows.push(...additions);
                        if (wasEmpty) {
                            this.hasMoreOlder = rawRows.length === PAGE_SIZE;
                        }
                        if (this.followLive) {
                            this.$nextTick(() => this.scrollToBottom(true));
                        }
                        this.queryStatus = `${additions.length} new · ${this.formatCount(this.rows.length)} loaded`;
                    }
                    this.pollCount += 1;
                    if (this.pollCount % 4 === 0) {
                        const [histogram] = await Promise.all([
                            this.queryHistogram(nextFilters),
                            this.refreshLabels(),
                        ]);
                        this.histogram = histogram.data;
                        this.bucketSeconds = histogram.bucketSeconds;
                    }
                    const elapsed = Math.round(performance.now() - time0);
                    const newCount = additionsCount
                        ? `${this.formatCount(additionsCount)} new · `
                        : '';
                    this.queryStatus = `${newCount}${this.formatCount(this.rows.length)} loaded · ${elapsed} ms`;
                    this.syncUrlState();
                }
                catch (error) {
                    this.queryStatus = 'Live retry pending';
                    console.error(error);
                }
            },

            onScroll: function (event) {
                this.scrollTop = event.target.scrollTop;
                this.viewportHeight = event.target.clientHeight;
                const remaining = event.target.scrollHeight - event.target.scrollTop - event.target.clientHeight;
                if ((remaining > ROW_HEIGHT*2) && this.followLive && !this.isAutoScrolling) {
                    this.followLive = false;
                    this.queryStatus = `${this.formatCount(this.rows.length)} loaded · paused on scroll`;
                    this.syncUrlState();
                }
                if (event.target.scrollTop < ROW_HEIGHT*24) {
                    this.loadOlder();
                }
            },

            scheduleSearch: function () {
                window.clearTimeout(this.searchTimer);
                this.searchTimer = window.setTimeout(this.runSearch, 450);
            },

            applyIgnoreEmpty: function () {
                try {
                    localStorage.setItem('logline-ignore-empty', String(this.ignoreEmptyEnabled));
                }
                catch {
                    // The filter still works when browser storage is unavailable.
                }
                this.runSearch();
            },

            measureViewport: function () {
                if (this.$refs.viewport) {
                    this.viewportHeight = this.$refs.viewport.clientHeight;
                }
            },

            cancelAutoScroll: function () {
                window.cancelAnimationFrame(this.scrollAnimationFrame);
                this.scrollAnimationFrame = null;
                this.isAutoScrolling = false;
            },

            scrollToBottom: function (animate = false) {
                if (!this.$refs.viewport) {
                    return;
                }
                const viewport = this.$refs.viewport;
                const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
                this.cancelAutoScroll();
                if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    viewport.scrollTop = target;
                    this.scrollTop = target;
                    return;
                }

                const start = viewport.scrollTop;
                const distance = target - start;
                if (Math.abs(distance) < 1) {
                    return;
                }
                this.isAutoScrolling = true;
                this.scrollAnimation = {start, distance, target, duration: 160, startedAt: null};
                this.scrollAnimationFrame = window.requestAnimationFrame(this.scrollStep);
            },

            // One frame of the quick scroll to the newest line, eased out
            scrollStep: function (timestamp) {
                const animation = this.scrollAnimation;
                if (animation.startedAt === null) {
                    animation.startedAt = timestamp;
                }
                const progress = Math.min(1, (timestamp - animation.startedAt)/animation.duration);
                const eased = 1 - Math.pow(1 - progress, 3);
                if (progress === 1) {
                    this.scrollViewportTo(animation.target);
                    this.scrollAnimationFrame = null;
                    this.isAutoScrolling = false;
                    return;
                }
                this.scrollViewportTo(animation.start + animation.distance*eased);
                if (this.followLive) {
                    this.scrollAnimationFrame = window.requestAnimationFrame(this.scrollStep);
                }
                else {
                    this.scrollAnimationFrame = null;
                    this.isAutoScrolling = false;
                }
            },

            scrollViewportTo: function (top) {
                if (this.$refs.viewport) {
                    this.$refs.viewport.scrollTop = top;
                }
                this.scrollTop = top;
            },

            scrollToSelectedRow: function () {
                if (!this.selectedRow || !this.$refs.viewport) {
                    return;
                }
                const index = this.rows.findIndex(v => v.key === this.selectedRow.key);
                if (index < 0) {
                    return;
                }
                const top = Math.max(0, index*ROW_HEIGHT - this.viewportHeight/2 + ROW_HEIGHT/2);
                this.$refs.viewport.scrollTop = top;
                this.scrollTop = top;
            },

            onGlobalKeydown: function (event) {
                if (event.key === 'Escape') {
                    this.closeDetail();
                    this.closeDisk();
                    this.closeRange();
                }
                if ((event.key === 'Enter') && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    this.runSearch();
                }
            },

            quickRange: function (value) {
                const now = new Date();
                const relative = RELATIVE_RANGES.find(v => v.value === value);
                if (relative) {
                    return {from: new Date(now.getTime() - relative.seconds*1000), to: now, live: true};
                }
                const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (value === 'today') {
                    return {from: midnight, to: now, live: true};
                }
                if (value === 'yesterday') {
                    return {from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), to: midnight, live: false};
                }
                // Weeks start on Monday
                if (value === 'week') {
                    return {from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7), to: now, live: true};
                }
                return {from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, live: true};
            },

            applyQuickRange: function (value) {
                this.activeRange = value;
                this.setRange(this.quickRange(value));
            },

            setRange: function (range) {
                this.rangeOpen = false;
                this.rangeError = '';
                this.rangeFrom = this.toLocalInputValue(range.from);
                this.rangeTo = this.toLocalInputValue(range.to);
                const wasLive = this.followLive;
                this.followLive = range.live;
                if (range.live && !wasLive) {
                    this.resetLiveTimer();
                }
                if (!range.live) {
                    this.cancelAutoScroll();
                }
                this.runSearch();
            },

            toggleRange: function () {
                if (this.rangeOpen) {
                    this.rangeOpen = false;
                    return;
                }
                const relative = RELATIVE_RANGES.find(v => v.value === this.activeRange);
                this.rangeFromInput = relative ? `now-${relative.value}` : this.rangeFrom.replace('T', ' ');
                this.rangeToInput = this.followLive ? 'now' : this.rangeTo.replace('T', ' ');
                this.rangeError = '';
                this.rangeOpen = true;
                this.$nextTick(() => this.$refs.rangeFromInput?.focus());
            },

            closeRange: function () {
                this.rangeOpen = false;
            },

            // A typed time: now, now-15m (s, m, h, d, w), 2026-09-26 14:30[:05], or 14:30 for today,
            // all local; anything with its own zone, like an ISO time ending in Z, as it says
            parseRangeInput: function (text) {
                const value = text.trim();
                const now = RE_RANGE_NOW.exec(value);
                if (now) {
                    const seconds = now[1] ? Number(now[1])*RANGE_UNITS[now[2].toLowerCase()] : 0;
                    return {date: new Date(Date.now() - seconds*1000), now: !now[1], relative: now[1] ? `${now[1]}${now[2].toLowerCase()}` : ''};
                }
                const date = RE_RANGE_DATE.exec(value);
                if (date) {
                    const when = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(date[4] || 0), Number(date[5] || 0), Number(date[6] || 0));
                    if ((when.getMonth() === Number(date[2]) - 1) && (when.getDate() === Number(date[3]))) {
                        return {date: when, now: false, relative: ''};
                    }
                    return null;
                }
                const clock = RE_RANGE_CLOCK.exec(value);
                if (clock) {
                    const today = new Date();
                    return {date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(clock[1]), Number(clock[2]), Number(clock[3] || 0)), now: false, relative: ''};
                }
                if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && !Number.isNaN(new Date(value).getTime())) {
                    return {date: new Date(value), now: false, relative: ''};
                }
                return null;
            },

            applyRangeInputs: function () {
                const from = this.parseRangeInput(this.rangeFromInput);
                const to = this.parseRangeInput(this.rangeToInput);
                if (!from || !to) {
                    this.rangeError = `Cannot read ${!from ? 'From' : 'To'}: write a time like 2026-09-26 14:30, 14:30 or now-2h.`;
                    return;
                }
                if (from.date >= to.date) {
                    this.rangeError = 'From must be before To.';
                    return;
                }
                this.activeRange = (to.now && RELATIVE_RANGES.some(v => v.value === from.relative)) ? from.relative : null;
                this.setRange({from: from.date, to: to.date, live: to.now});
            },

            onFollowChange: function () {
                if (this.followLive) {
                    this.rangeTo = this.toLocalInputValue(new Date());
                    this.resetLiveTimer();
                    this.runSearch();
                }
                else {
                    this.cancelAutoScroll();
                    this.syncUrlState();
                }
            },

            applyRefreshInterval: function () {
                const numeric = Number(this.refreshSeconds);
                this.refreshSeconds = Number.isFinite(numeric)
                    ? Math.min(300, Math.max(1, numeric))
                    : DEFAULT_REFRESH_SECONDS;
                try {
                    localStorage.setItem('logline-refresh-seconds', String(this.refreshSeconds));
                }
                catch {
                    // Polling still works when browser storage is unavailable.
                }
                this.resetLiveTimer();
            },

            resetLiveTimer: function () {
                window.clearInterval(this.liveTimer);
                this.liveTimer = window.setInterval(this.pollNewer, this.refreshSeconds*1000);
            },

            zoomToBucket: function (bucketStart) {
                this.followLive = false;
                this.activeRange = null;
                this.rangeFrom = this.toLocalInputValue(new Date(bucketStart*1000));
                this.rangeTo = this.toLocalInputValue(new Date((bucketStart + this.bucketSeconds)*1000));
                this.runSearch();
            },

            openDetail: function (row) {
                this.selectedRow = row;
                this.pendingSelection = null;
                this.syncUrlState();
            },

            shareCurrentView: async function () {
                if (this.sharing) {
                    return;
                }
                this.sharing = true;
                try {
                    const wasLive = this.followLive;
                    window.clearTimeout(this.searchTimer);
                    if (this.selectedRow) {
                        this.pendingSelection = {
                            cursor: this.selectedRow.cursor,
                            service: this.selectedRow.service || '',
                        };
                    }
                    if (this.followLive) {
                        const currentTo = this.active ? new Date(this.active.to) : new Date();
                        const inclusiveSecond = new Date(Math.ceil(currentTo.getTime()/1000)*1000);
                        this.followLive = false;
                        this.activeRange = null;
                        this.rangeTo = this.toLocalInputValue(inclusiveSecond);
                    }
                    const succeeded = await this.runSearch();
                    if (!succeeded) {
                        return;
                    }
                    this.syncUrlState();
                    await this.copyText(window.location.href);
                    this.showToast(wasLive ? 'Share link copied · live view was paused' : 'Share link copied');
                }
                catch (error) {
                    this.showToast(`Could not copy link: ${error.message}`);
                }
                finally {
                    this.sharing = false;
                }
            },

            saveSearchForInvestigation: function () {
                if (this.savedSearch) {
                    return;
                }
                this.savedSearch = {
                    termsInput: this.termsInput,
                    labelFilter: copyLabels(this.labelFilter),
                    rangeFrom: this.rangeFrom,
                    rangeTo: this.rangeTo,
                    followLive: this.followLive,
                    activeRange: this.activeRange,
                };
            },

            inferGroupUid: function (row) {
                if (row?.group_uid) {
                    return row.group_uid;
                }
                const terms = this.active?.terms || [];
                if ((terms.length !== 1) || this.active?.excludeTerms?.length) {
                    return '';
                }
                return looksLikeGroupUid(terms[0]) ? terms[0] : '';
            },

            investigateContext: function (row) {
                this.saveSearchForInvestigation();
                const center = Number(row.timestamp_ms);
                const contextFrom = new Date(center - SURROUNDING_SECONDS*1000);
                const contextTo = new Date(center + SURROUNDING_SECONDS*1000);
                const inferredGroupUid = this.inferGroupUid(row);
                const hasGroup = Boolean(inferredGroupUid);
                this.investigation = {
                    kind: 'context',
                    service: row.service || '',
                    containerId: row.container_id || '',
                    groupUid: inferredGroupUid,
                    contextFrom: contextFrom.toISOString(),
                    contextTo: contextTo.toISOString(),
                    anchorKey: row.key,
                };
                this.termsInput = '';
                this.labelFilter = row.service ? {service: [row.service]} : {};
                this.followLive = false;
                this.activeRange = null;
                this.rangeFrom = this.toLocalInputValue(hasGroup
                    ? new Date(center - GROUP_CONTEXT_SECONDS*1000)
                    : contextFrom);
                this.rangeTo = this.toLocalInputValue(hasGroup
                    ? new Date(center + GROUP_CONTEXT_SECONDS*1000)
                    : contextTo);
                this.runSearch();
            },

            investigateGroup: function (row, useParent = false) {
                const groupUid = useParent ? row.parent_group_uid : row.group_uid;
                if (!groupUid) {
                    this.showToast(useParent ? 'This entry has no parent group ID' : 'No group ID found in this entry');
                    return;
                }
                this.saveSearchForInvestigation();
                const originalRange = this.savedSearch
                    ? {
                        from: new Date(this.savedSearch.rangeFrom).toISOString(),
                        to: new Date(this.savedSearch.rangeTo).toISOString(),
                    }
                    : (this.active ? {from: this.active.from, to: this.active.to} : null);
                this.investigation = {
                    kind: useParent ? 'parent' : 'group',
                    service: '',
                    containerId: '',
                    groupUid,
                    anchorKey: useParent ? '' : row.key,
                };
                this.termsInput = '';
                this.labelFilter = {};
                this.followLive = false;
                this.activeRange = null;
                if (originalRange) {
                    this.rangeFrom = this.toLocalInputValue(new Date(originalRange.from));
                    this.rangeTo = this.toLocalInputValue(new Date(originalRange.to));
                }
                this.runSearch();
            },

            restoreSearch: function () {
                const saved = this.savedSearch;
                this.investigation = null;
                this.savedSearch = null;
                if (!saved) {
                    this.runSearch();
                    return;
                }
                this.termsInput = saved.termsInput;
                this.labelFilter = saved.labelFilter || {};
                this.rangeFrom = saved.rangeFrom;
                this.rangeTo = saved.rangeTo;
                this.followLive = saved.followLive;
                this.activeRange = saved.activeRange;
                this.runSearch();
            },

            scrollToInvestigationAnchor: function () {
                if (!this.investigation?.anchorKey || !this.$refs.viewport) {
                    return;
                }
                const index = this.rows.findIndex(v => v.key === this.investigation.anchorKey);
                if (index < 0) {
                    return;
                }
                const top = Math.max(0, index*ROW_HEIGHT - this.viewportHeight/2 + ROW_HEIGHT/2);
                this.$refs.viewport.scrollTop = top;
                this.scrollTop = top;
            },

            closeDetail: function () {
                this.selectedRow = null;
                this.pendingSelection = null;
                this.syncUrlState();
            },

            copyBody: async function () {
                if (!this.selectedRow) {
                    return;
                }
                await this.copyText(this.displayBody(this.selectedRow.body));
                this.showToast('Copied log body');
            },

            copyText: async function (value) {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(value);
                    return;
                }
                const field = document.createElement('textarea');
                field.value = value;
                field.setAttribute('readonly', '');
                field.style.position = 'fixed';
                field.style.opacity = '0';
                document.body.appendChild(field);
                field.select();
                const copied = document.execCommand('copy');
                field.remove();
                if (!copied) {
                    throw new Error('clipboard access is unavailable');
                }
            },

            showToast: function (message) {
                this.toastMessage = message;
                this.toastVisible = true;
                window.clearTimeout(this.toastTimer);
                this.toastTimer = window.setTimeout(this.hideToast, 3200);
            },

            hideToast: function () {
                this.toastVisible = false;
            },

            displayBody: function (value) {
                const text = String(value ?? '');
                return this.stripAnsiEnabled
                    ? text.replace(/(?:\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])|\u009B[0-?]*[ -/]*[@-~])/g, '')
                    : text;
            },

            listBody: function (row) {
                return this.displayBody(row.body).replace(/\r?\n/g, ' ↵ ').replace(/ ↵ $/, '');
            },

            rowClasses: function (row) {
                const severity = String(row.severity || '').toLowerCase();
                const body = String(row.body || '').toLowerCase();
                return {
                    selected: this.selectedRow && (this.selectedRow.key === row.key),
                    picked: Boolean(this.picked[row.key]),
                    anchor: this.investigation?.anchorKey === row.key,
                    stderr: row.stream === 'stderr',
                    error: severity.includes('error') || severity.includes('fatal') || body.includes('error'),
                    warn: severity.includes('warn') || body.includes('warn'),
                };
            },

            formatCount: function (value) {
                return new Intl.NumberFormat(undefined, {
                    notation: (value >= 100_000) ? 'compact' : 'standard',
                }).format(value);
            },

            formatBytes: function (value) {
                const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                let size = Number(value) || 0;
                let unit = 0;
                while ((size >= 1024) && (unit < units.length - 1)) {
                    size /= 1024;
                    unit += 1;
                }
                const digits = ((unit === 0) || (size >= 100)) ? 0 : 1;
                return `${size.toFixed(digits)} ${units[unit]}`;
            },

            formatDate: function (milliseconds) {
                return new Date(milliseconds).toLocaleString([], {month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'});
            },

            formatTime: function (milliseconds) {
                const date = new Date(milliseconds);
                const parts = new Intl.DateTimeFormat(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                    second: '2-digit', hour12: false,
                }).format(date);
                return `${parts}.${String(date.getMilliseconds()).padStart(3, '0')}`;
            },

            shortTime: function (value) {
                return new Date(value).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            },

            intervalLabel: function (seconds) {
                if (seconds < 60) {
                    return `${seconds}s buckets`;
                }
                if (seconds < 3600) {
                    return `${seconds/60}m buckets`;
                }
                return `${seconds/3600}h buckets`;
            },
        },
    }).mount('#app');
})();
