// One cell of a database's row, as database_rows.js makes it: in the Databases table, on a
// database's page and on a machine's Databases tab. A click on an app's name opens it.
const database_cell = {
    template: `
<span v-if="(column.key === 'name')" class="row-of">
    <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" :stroke="row.colour" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
    <b>{{ row.name }}</b>
    <span v-if="(row.aside !== '')" class="muted">{{ row.aside }}</span>
</span>
<template v-else-if="(column.key === 'engine')">{{ row.engine }}</template>
<template v-else-if="(column.key === 'machine')">{{ row.machine }}</template>
<span v-else-if="(column.key === 'size')" :class="{muted: (row.size === '—')}">{{ row.size }}</span>
<span v-else-if="(column.key === 'apps')" class="db-apps">
    <span v-if="(row.apps.length === 0)" class="muted">{{ row.no_apps }}</span>
    <template v-for="(name, index) of row.apps" v-else :key="name"><button type="button" class="link" @click.stop="$emit('select', name)">{{ name }}<span v-if="(index < (row.apps.length - 1))" class="db-comma">,</span></button></template>
</span>
<span v-else-if="(column.key === 'state')" class="dt-state"><span class="dot" :class="row.dot"/><span :class="{bad: row.bad}"><span v-if="row.busy" class="spin"/>{{ row.state }}</span></span>
<span v-else-if="(column.key === 'detail')" :class="(row.bad ? 'bad' : 'muted')" :title="row.detail">{{ row.detail }}</span>
`,
    props: {
        row: {type: Object, required: true},
        column: {type: Object, required: true},
    },
    emits: ['select'],
};

export default database_cell;
