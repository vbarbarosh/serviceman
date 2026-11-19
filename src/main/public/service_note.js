import copy_progress from 'file_manager/copy_progress.js';
import service_note_said from './service_note_said.js';

// The icons a note opens with, by what it says
const ICONS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    bad: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    again: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 2.5v4.2h-4.2"/>',
    away: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M3 3l18 18"/>',
};

// One note under a service's head, when how it stands wants a word: why, and the way to its logs
// or its machine (service_note_said). Start and Stop stay in the head.
//
//     view      the service as the status has it
//     machine   the machine it runs on as the status has it, or null
const service_note = {
    template: `
<div v-if="(note !== null)" class="card svc-note" :class="('svc-note-' + note.tone)" role="status">
    <svg class="svc-note-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="icons[note.icon]"/>
    <div class="svc-note-body">
        <b>{{ note.title }}</b>
        <p>{{ note.text }}</p>
        <div v-if="(note.progress !== null)" class="meter"><i :style="{width: (Math.round(note.progress*100) + '%')}"/></div>
        <copy-progress v-if="((view.copy !== null) && (view.copy !== undefined))" :copy="view.copy"/>
        <pre v-if="(note.lines.length > 0)" class="svc-note-lines">{{ note.lines.join('\\n') }}</pre>
    </div>
    <button v-if="(note.action === 'logs')" type="button" @click="$emit('logs')">All logs</button>
    <button v-else-if="(note.action === 'machine')" type="button" @click="$emit('machine', machine.name)">See {{ machine.name }}</button>
</div>
`,
    components: {'copy-progress': copy_progress},
    props: {
        view: {type: Object, required: true},
        machine: {type: Object, default: null},
    },
    emits: ['logs', 'machine'],
    data: function () {
        return {icons: ICONS};
    },
    computed: {
        note: function () {
            return service_note_said(this.view, this.machine, Date.now());
        },
    },
};

export default service_note;
