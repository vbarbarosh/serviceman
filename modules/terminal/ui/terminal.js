import {FitAddon} from 'xterm-addon-fit';
import {Terminal} from 'xterm';

const THEME_DARK = {
    background: '#171a1f',
    foreground: '#e8eaed',
    cursor: '#6ea0ff',
    selectionBackground: '#2a3140',
};

const THEME_LIGHT = {
    background: '#ffffff',
    foreground: '#1b1d21',
    cursor: '#2f6fed',
    selectionBackground: '#d7e3fb',
};

// A terminal on whatever the websocket at `url` is joined to: a shell in a container, a pty on
// a machine. The host opens the far end and says what it is in the first note; the pane draws
// what comes back and sends what is typed. Its title goes in the head slot, anything under
// the terminal in the default one.
const terminal = {
    template: `
<article class="terminal">
    <slot name="head"/>
    <p :class="(bad ? 'bad' : 'muted')">{{ note }} <button v-if="(over && restart)" type="button" class="link" @click="again">Start over</button> <button v-if="(lockable && !over && !full)" type="button" class="link" title="Every key goes to the terminal, Ctrl-W too; hold Esc to leave" @click="full_enter">Full screen</button></p>
    <div class="term" ref="term"/>
    <slot/>
</article>
`,
    // url      the websocket's address on this host, path and query: /api/v1/shell?remote=box
    // theme    light or dark
    // restart  a shell that ended may be opened again, under what the last one printed
    props: ['url', 'theme', 'restart'],
    // ended  the shell at the far end is gone: typed `exit`, or ended from elsewhere
    emits: ['ended'],
    data: function () {
        // `over` is the far end being gone, which is the one state this pane cannot leave
        // by itself — a shell that ended is not reconnected to, it is opened again
        // `lockable` is Chrome's Keyboard Lock being here: only in full screen does it give a
        // page the keys the browser keeps for itself, Ctrl-W, Ctrl-T and Ctrl-N among them
        return {note: 'opening…', bad: false, over: false, full: false, lockable: (navigator.keyboard !== undefined) && (typeof navigator.keyboard.lock === 'function') && (document.fullscreenEnabled === true)};
    },
    watch: {
        theme: function (value) {
            this.term.options.theme = (value === 'dark') ? THEME_DARK : THEME_LIGHT;
        },
        // Another far end — another instance of a service, say — starts on a clean screen
        url: function () {
            this.close();
            this.term.reset();
            this.over = false;
            this.report('opening…', false);
            this.open();
        },
    },
    methods: {
        open: function () {
            const _this = this;
            const protocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
            const socket = new WebSocket(`${protocol}//${location.host}${this.url}`);
            socket.binaryType = 'arraybuffer';
            this.socket = socket;
            socket.addEventListener('open', function () {
                _this.fit.fit();
                _this.term.focus();
                // The far end opened at 80×24; this pane knows better the moment it is drawn
                _this.send({type: 'resize', cols: _this.term.cols, rows: _this.term.rows});
            });
            socket.addEventListener('message', v => this.read(v.data));
            socket.addEventListener('close', function () {
                if (_this.socket !== socket) {
                    return;
                }
                _this.socket = null;
                _this.over = true;
                // A refusal, or a server that stopped answering, keeps its reason on the line
                if (_this.bad === false) {
                    _this.report('the shell ended', false);
                    _this.$emit('ended');
                }
            });
            socket.addEventListener('error', function () {
                _this.report('the server is not answering', true);
            });
        },
        // Another shell in the same terminal: what the last one printed stays above it, the
        // way it does in a terminal on your own desk
        again: function () {
            this.over = false;
            this.report('opening…', false);
            this.open();
        },
        // The terminal over the whole screen, with every key: Chrome holds Esc as the way out
        full_enter: async function () {
            try {
                await this.$el.requestFullscreen();
                await navigator.keyboard.lock();
            }
            catch (error) {
                this.report(`full screen was refused: ${error.message}`, true);
            }
        },
        close: function () {
            if (this.socket) {
                const socket = this.socket;
                this.socket = null;
                socket.close();
            }
        },
        read: function (data) {
            if (typeof data !== 'string') {
                this.term.write(new Uint8Array(data));
                return;
            }
            const message = JSON.parse(data);
            if (message.type === 'note') {
                this.report(message.text, message.ok !== true);
            }
        },
        send: function (message) {
            if (this.socket && (this.socket.readyState === WebSocket.OPEN)) {
                this.socket.send(JSON.stringify(message));
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
    mounted: function () {
        this.term = new Terminal({
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            theme: (this.theme === 'dark') ? THEME_DARK : THEME_LIGHT,
            cursorBlink: true,
            scrollback: 5000,
        });
        this.fit = new FitAddon();
        this.term.loadAddon(this.fit);
        this.term.open(this.$refs.term);
        this.fit.fit();
        this.term.onData(v => this.send({type: 'input', data: v}));
        this.term.onResize(v => this.send({type: 'resize', cols: v.cols, rows: v.rows}));
        const _this = this;
        this.resize = function () {
            _this.fit.fit();
        };
        addEventListener('resize', this.resize);
        // Ctrl-W is a shell's delete-a-word and the browser's close-the-tab, and the browser
        // never lets a page have it. While a terminal is open, its page asks before it goes.
        this.guard = function (event) {
            if (_this.socket && (_this.socket.readyState === WebSocket.OPEN)) {
                event.preventDefault();
            }
        };
        addEventListener('beforeunload', this.guard);
        this.full_change = function () {
            _this.full = (document.fullscreenElement === _this.$el);
            if (_this.full === false) {
                navigator.keyboard.unlock();
            }
            _this.fit.fit();
            _this.term.focus();
        };
        document.addEventListener('fullscreenchange', this.full_change);
        this.open();
    },
    unmounted: function () {
        removeEventListener('resize', this.resize);
        removeEventListener('beforeunload', this.guard);
        document.removeEventListener('fullscreenchange', this.full_change);
        this.close();
        this.term.dispose();
    },
};

export default terminal;
