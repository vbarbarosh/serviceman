// The frame every create form stands in, a card of its own: its title and the switch Step by
// step | One page in its head; step by step, the steps in a band under it (a number, the name,
// the answer under each one done, a line joining them; a click on a done one goes back to it;
// on a phone, the step's name, Step n of m and a bar), one question a screen with one line under
// it, and a bar at its foot: Back or Cancel on the left, Show serviceman.json and Next or Create
// on the right, and beside a Next that waits, why. One page, the same steps as sections, each
// under its question, and what Create makes beside them with Create under it. Both are drawn
// from the one model of the form that holds the frame, so the switch keeps every answer. The
// form gives each step its body as a slot named after the step's key, the summary as the slot
// summary, a line for the foot as the slot note, and the link to what Create writes as the
// slot json.
const step_frame = {
    template: `
<div class="step-frame" :class="('sf-as-' + mode)">
    <div class="sf-head">
        <h1>{{ title }}</h1>
        <span v-if="switchable" class="seg sf-mode" role="group" aria-label="How the form is shown">
            <button type="button" :class="{on: (mode === 'steps')}" :aria-pressed="(mode === 'steps')" @click="$emit('mode', 'steps')">Step by step</button>
            <button type="button" :class="{on: (mode === 'page')}" :aria-pressed="(mode === 'page')" @click="$emit('mode', 'page')">One page</button>
        </span>
    </div>
    <template v-if="(mode === 'steps')">
        <div class="sf-band">
            <ol class="sf-steps">
                <li v-for="(item, index) of steps" :key="item.key" :class="{done: (index < step_index), now: (index === step_index), later: (index > step_index)}">
                    <button type="button" :disabled="(index > step_index)" :aria-current="((index === step_index) ? 'step' : null)" @click="$emit('step', index)">
                        <span class="sf-num" aria-hidden="true">
                            <svg v-if="(index < step_index)" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg>
                            <template v-else>{{ index + 1 }}</template>
                        </span>
                        <span class="sf-name">{{ item.name }}<small v-if="((index < step_index) && (item.answer !== ''))" :title="item.answer">{{ item.answer }}</small></span>
                    </button>
                </li>
            </ol>
            <div class="sf-phone-steps" aria-hidden="true">
                <span><b>{{ step_now.name }}</b><span class="muted">Step {{ step_index + 1 }} of {{ steps.length }}</span></span>
                <span class="sf-bar"><i :style="{width: (((step_index + 1)*100/steps.length) + '%')}"/></span>
            </div>
        </div>
        <div class="sf-body">
            <h2>{{ step_now.question }}</h2>
            <p v-if="has_says(step_now)" class="sf-says">{{ step_now.says }}</p>
            <slot :name="step_now.key"/>
        </div>
    </template>
    <div v-else class="sf-page">
        <div class="sf-sections">
            <div v-for="(item, index) of steps" :key="item.key" class="sf-section">
                <h3>
                    <span class="sf-num" :class="{done: (item.answer !== '')}" aria-hidden="true">
                        <svg v-if="(item.answer !== '')" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg>
                        <template v-else>{{ index + 1 }}</template>
                    </span>
                    {{ item.question }}
                </h3>
                <div class="sf-section-body"><slot :name="item.key"/></div>
            </div>
        </div>
        <aside class="sf-summary">
            <h3>{{ summary_title }}</h3>
            <div class="sf-sum-list"><slot name="summary"/></div>
            <button type="button" class="primary" :disabled="busy" @click="$emit('create')">{{ busy ? busy_label : create_label }}</button>
            <span class="sf-json"><slot name="json"/></span>
        </aside>
    </div>
    <div class="sf-foot">
        <button v-if="((mode === 'steps') && (step_index > 0))" type="button" :disabled="busy" @click="$emit('step', step_index - 1)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Back</button>
        <button v-else type="button" :disabled="busy" @click="$emit('cancel')">Cancel</button>
        <span class="sf-note"><slot name="note"/></span>
        <span v-if="((mode === 'page') && switchable)" class="muted sf-kept">Every answer is kept when you switch</span>
        <template v-if="(mode === 'steps')">
            <span class="sf-json"><slot name="json"/></span>
            <template v-if="(step_index < (steps.length - 1))">
                <span v-if="((can_next === false) && (next_title !== ''))" class="muted sf-waits">{{ next_title }}</span>
                <button type="button" class="primary" :disabled="(can_next === false)" :title="next_title" @click="$emit('step', step_index + 1)">Next<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
            </template>
            <button v-else type="button" class="primary" :disabled="busy" @click="$emit('create')">{{ busy ? busy_label : create_label }}</button>
        </template>
    </div>
</div>
`,
    emits: ['cancel', 'create', 'mode', 'step'],
    computed: {
        // The step open, never past the last: a form whose steps shrink keeps standing
        step_index: function () {
            return Math.min(this.step, this.steps.length - 1);
        },
        step_now: function () {
            return this.steps[this.step_index];
        },
        // An edit on one page saves what is there; a new one is made
        summary_title: function () {
            return this.create_label.startsWith('Save') ? 'What Save writes' : 'What Create makes';
        },
    },
    methods: {
        has_says: function (item) {
            return (typeof item.says === 'string') && (item.says !== '');
        },
    },
    props: {
        title: {type: String, required: true},
        // [{key, name, question, says, answer}]: says is the one line under the question; answer
        // is what was picked, shown under a step done
        steps: {type: Array, required: true},
        // The step open, step by step
        step: {type: Number, required: true},
        // 'steps' or 'page'
        mode: {type: String, required: true},
        // Whether the open step has what it needs to go on, and why not when it has not
        can_next: {type: Boolean, default: true},
        next_title: {type: String, default: ''},
        create_label: {type: String, default: 'Create'},
        // What the primary says while Create is under way
        busy_label: {type: String, default: 'Creating…'},
        // false for a form that is shown one way only: an edit on one page
        switchable: {type: Boolean, default: true},
        busy: {type: Boolean, default: false},
    },
};

export default step_frame;
