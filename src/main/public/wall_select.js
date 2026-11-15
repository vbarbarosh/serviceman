// The value of the last option, which opens the Authwall page's form for a new wall: no service
// is ever called this
const NEW = '+';

// The wall something stands behind, picked from a list: none, each wall there is (its team
// beside it), or a new one. The last option picks nothing: it asks for the Authwall page's form
// (create), and the list stays on what it was. One list wherever a wall is picked: an app's
// Settings, the top of Apps, a service's Sign-in.
const wall_select = {
    template: `
<select class="wall-select" :value="modelValue" :disabled="disabled" :aria-label="label" @change="change_wall($event.target)">
    <option value="">{{ none }}</option>
    <option v-for="item of shown" :key="item.name" :value="item.name">behind {{ item.name }}{{ ((item.team === '') ? '' : (' · ' + item.team)) }}</option>
    <option :value="NEW">+ A wall for another team…</option>
</select>
`,
    props: {
        // The wall picked, '' for none
        modelValue: {type: String, required: true},
        // walls_of(state)
        walls: {type: Array, required: true},
        // What none is here: open to anyone, or as every app is
        none: {type: String, required: true},
        // The service this is for: a wall is never put behind itself
        self: {type: String, default: ''},
        disabled: {type: Boolean, default: false},
        label: {type: String, default: 'Sign-in'},
    },
    emits: ['update:modelValue', 'create'],
    data: function () {
        return {NEW};
    },
    computed: {
        // Every wall but itself; the one picked is listed even when nothing is called so any more,
        // so the list says what the config says
        shown: function () {
            const out = this.walls.filter(v => v.name !== this.self);
            if ((this.modelValue !== '') && (out.some(v => v.name === this.modelValue) === false)) {
                out.push({name: this.modelValue, team: ''});
            }
            return out;
        },
    },
    methods: {
        change_wall: function (select) {
            if (select.value === NEW) {
                select.value = this.modelValue;
                this.$emit('create');
                return;
            }
            this.$emit('update:modelValue', select.value);
        },
    },
};

export default wall_select;
