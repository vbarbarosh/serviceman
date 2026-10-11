import to_clipboard from './to_clipboard.js';

// A command meant to be run somewhere else. It is shown as it is and copied with one button,
// because a long line in a box that scrolls sideways is easy to mistype and hard to select.
const HELD_MS = 1500;

const snippet = {
    template: `
<div class="snip">
    <pre class="tail">{{ text }}</pre>
    <button type="button" class="snip-copy" @click="copy">{{ said === '' ? 'Copy' : said }}</button>
</div>
`,
    props: ['text'],
    data: function () {
        return {
            said: '',
            timer: null,
        };
    },
    methods: {
        copy: async function () {
            // A browser that will not hand over the clipboard still lets the visitor take it:
            // the line is selected, and the keys they already know do the rest
            if (await to_clipboard(this.text)) {
                this.said = 'Copied';
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
