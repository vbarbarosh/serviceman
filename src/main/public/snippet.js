import secret_hidden from './secret_hidden.js';
import to_clipboard from './to_clipboard.js';

// A command meant to be run somewhere else. It is shown as it is and copied with one button,
// because a long line in a box that scrolls sideways is easy to mistype and hard to select. A
// token in it (`secret`) is drawn as dots and copied as it is. `prompt` draws it as a line typed
// at a prompt, a green $ before it, wrapping inside its block, Copy at its right; `primary` makes
// that Copy the page's main button.
const HELD_MS = 1500;

const snippet = {
    template: `
<div class="snip" :class="{'snip-prompt': prompt}">
    <span v-if="prompt" class="snip-dollar" aria-hidden="true">$</span>
    <pre class="tail">{{ shown }}</pre>
    <button type="button" class="snip-copy" :class="{primary}" @click="copy"><svg v-if="prompt" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>{{ said === '' ? 'Copy' : said }}</button>
</div>
`,
    props: {
        text: {type: String, required: true},
        secret: {type: String, default: null},
        prompt: {type: Boolean, default: false},
        primary: {type: Boolean, default: false},
    },
    data: function () {
        return {
            said: '',
            timer: null,
        };
    },
    computed: {
        shown: function () {
            return secret_hidden(this.text, this.secret);
        },
    },
    methods: {
        copy: async function () {
            // A browser that will not hand over the clipboard still lets the visitor take it:
            // the line is selected, and the keys they already know do the rest
            if (await to_clipboard(this.text)) {
                this.said = 'Copied';
            }
            else if (this.shown !== this.text) {
                // What is on the screen holds dots where the token is: selected, it would copy
                // the dots
                this.said = 'Not copied';
            }
            else {
                select_text(this.$el.querySelector('pre'));
                this.said = 'Ctrl+C';
            }
            const _this = this;
            clearTimeout(this.timer);
            this.timer = setTimeout(function () {
                _this.said = '';
            }, HELD_MS);
        },
    },
    unmounted: function () {
        clearTimeout(this.timer);
    },
};

function select_text(node)
{
    const range = document.createRange();
    range.selectNodeContents(node);
    const chosen = window.getSelection();
    chosen.removeAllRanges();
    chosen.addRange(range);
}

export default snippet;
