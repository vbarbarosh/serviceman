import to_clipboard from './to_clipboard.js';

// How long the button says it copied
const HELD_MS = 1500;

// The command behind a part of the page: what the agent ran on the machine to show it or do
// it, one click from the clipboard, so the same thing can be done by hand without serviceman.
// An agent from before these commands sends none, and then there is no button.
const command_copy = {
    template: `
<button v-if="(text !== '')" type="button" class="command-copy" :class="{done: copied}" :title="title" :aria-label="title" @click="copy">
    <svg :class="{gone: copied}" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-5-6-5M12 19h8"/></svg>
    <svg :class="{gone: (copied === false)}" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
</button>
`,
    // commands  the lines the agent ran, in the order it ran them
    props: ['commands'],
    data: function () {
        // `said` is what the last click came to, for the title: copied, or why not
        return {copied: false, said: '', timer: null};
    },
    computed: {
        text: function () {
            return Array.isArray(this.commands) ? this.commands.join('\n') : '';
        },
        title: function () {
            const head = (this.said === '') ? 'Copy the command, to do this by hand' : this.said;
            return `${head}:\n${this.text}`;
        },
    },
    methods: {
        copy: async function () {
            this.copied = await to_clipboard(this.text);
            this.said = this.copied ? 'Copied' : 'The browser would not copy it, so here it is to copy by hand';
            clearTimeout(this.timer);
            this.timer = setTimeout(this.reset, HELD_MS);
        },
        reset: function () {
            this.copied = false;
            this.said = '';
        },
    },
    unmounted: function () {
        clearTimeout(this.timer);
    },
};

export default command_copy;
