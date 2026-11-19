// The frame every create form stands in: its title and the switch Step by step | One page at
// the top right; step by step, the steps on top (a number, the name, the answer under each one
// done; a click on a done one goes back to it), one question a screen, Back and Next in a bar at
// the foot and Create on the last step; one page, the same steps as sections, full width, with a
// summary of what Create makes beside them. Both are drawn from the one model of the form that
// holds the frame, so the switch keeps every answer. The form gives each step its body as a
// slot named after the step's key, and the summary as the slot summary.
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
        <ol class="sf-steps">
            <li v-for="(item, index) of steps" :key="item.key" :class="{done: (index < step), now: (index === step)}">
                <button type="button" :disabled="(index > step)" :aria-current="((index === step) ? 'step' : null)" @click="$emit('step', index)">
                    <span class="sf-num" aria-hidden="true">
                        <svg v-if="(index < step)" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg>
                        <template v-else>{{ index + 1 }}</template>
                    </span>
                    <span class="sf-name">{{ item.name }}<small v-if="((index < step) && (item.answer !== ''))" :title="item.answer">{{ item.answer }}</small></span>
                </button>
            </li>
        </ol>
        <div class="sf-body">
            <h2>{{ step_now.question }}</h2>
            <slot :name="step_now.key"/>
        </div>
    </template>
    <div v-else class="sf-page">
        <div class="sf-sections">
            <div v-for="item of steps" :key="item.key" class="sf-section">
                <h3>{{ item.name }}</h3>
                <div class="sf-section-body"><slot :name="item.key"/></div>
            </div>
        </div>
        <aside class="card sf-summary"><slot name="summary"/></aside>
    </div>
    <div class="sf-foot">
        <button v-if="((mode === 'steps') && (step > 0))" type="button" :disabled="busy" @click="$emit('step', step - 1)">← Back</button>
        <button v-else type="button" :disabled="busy" @click="$emit('cancel')">Cancel</button>
        <span class="sf-note"><slot name="note"/></span>
        <button v-if="((mode === 'steps') && (step < (steps.length - 1)))" type="button" class="primary" :disabled="(can_next === false)" :title="next_title" @click="$emit('step', step + 1)">Next →</button>
        <button v-else type="button" class="primary" :disabled="busy" @click="$emit('create')">{{ busy ? 'Creating…' : create_label }}</button>
    </div>
</div>
`,
    emits: ['cancel', 'create', 'mode', 'step'],
    computed: {
        // The step open, never past the last: a form whose steps shrink keeps standing
        step_now: function () {
            return this.steps[Math.min(this.step, this.steps.length - 1)];
        },
    },
    props: {
        title: {type: String, required: true},
        // [{key, name, question, answer}]: answer is what was picked, shown under a step done
        steps: {type: Array, required: true},
        // The step open, step by step
        step: {type: Number, required: true},
        // 'steps' or 'page'
        mode: {type: String, required: true},
        // Whether the open step has what it needs to go on, and why not when it has not
        can_next: {type: Boolean, default: true},
        next_title: {type: String, default: ''},
        create_label: {type: String, default: 'Create'},
        // false for a form that is shown one way only: an edit on one page
        switchable: {type: Boolean, default: true},
        busy: {type: Boolean, default: false},
    },
};

export default step_frame;
