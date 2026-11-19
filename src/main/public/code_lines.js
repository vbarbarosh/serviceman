// A few lines of code to edit, numbered: a line changed since it was saved is marked, with what
// it was beside it; a fixed line above and below them (`sg render -c '` and its `'`) is shown and
// cannot be typed into. The text is typed into a textarea laid over the lines it draws, its own
// letters see-through, so the marks stand where the lines are however they wrap.
//
//     text     what is typed, the lines joined by \n
//     marks    for each line {kind, was}: kind 'changed' or 'new' marks it, '' or 'same' not
//     lead     the fixed line above them, '' for none; tail, the one below
const code_lines = {
    template: `
<div class="code-lines">
    <div v-if="(lead !== '')" class="cl-fixed">{{ lead }}</div>
    <div class="cl-body">
        <div class="cl-back" aria-hidden="true">
            <div v-for="(row, i) of rows" :key="i" class="cl-row" :class="row.kind">
                <span class="cl-num">{{ i + 1 }}</span>
                <span class="cl-text" :class="{first: (i === 0), empty: (row.text === '')}">{{ (row.text === '') ? ((rows.length === 1) ? placeholder : ' ') : row.text }}<span v-if="(row.note !== '')" class="cl-was">{{ row.note }}</span></span>
            </div>
        </div>
        <textarea class="cl-input" :value="text" :aria-label="label" spellcheck="false" autocapitalize="off" autocomplete="off" @input="$emit('update:text', $event.target.value)"/>
    </div>
    <div v-if="(tail !== '')" class="cl-fixed">{{ tail }}</div>
</div>
`,
    props: {
        text: {type: String, required: true},
        marks: {type: Array, default: () => []},
        lead: {type: String, default: ''},
        tail: {type: String, default: ''},
        label: {type: String, default: ''},
        placeholder: {type: String, default: ''},
    },
    emits: ['update:text'],
    computed: {
        // Each line as it is drawn: its text, its mark, and the note beside it
        rows: function () {
            const marks = this.marks;
            return this.text.split('\n').map(function (text, i) {
                const mark = marks[i] || {kind: '', was: ''};
                const note = (mark.kind === 'changed') ? `was ${mark.was}` : ((mark.kind === 'new') ? 'new' : '');
                return {text, kind: ((mark.kind === 'changed') || (mark.kind === 'new')) ? 'marked' : '', note};
            });
        },
    },
};

export default code_lines;
