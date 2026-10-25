import format_ms_ago from './format_ms_ago.js';
import to_clipboard from './to_clipboard.js';

// A new version of an app folder from a script: the curl line that sends a zip to this service,
// and a token for it alone, made here and shown once. What New zip… above does in three steps,
// as one call for a deploy script.
const service_script = {
    template: `
<div class="card svc-status svc-script">
    <div class="row-of svc-state">
        <b>A new version from a script</b>
        <span class="muted">one call puts a zip in place, as New zip… does: its data/ is left out, the app restarts</span>
    </div>
    <div class="tk-made-row">
        <code>{{ curl_line }}</code>
        <button type="button" @click="copy('line', curl_line)">{{ (copied === 'line') ? 'Copied' : 'Copy' }}</button>
    </div>
    <p class="muted">{{ tokens_text }}</p>
    <div v-if="(made !== null)" class="tk-made">
        <p><b>{{ made.label }}</b>: copy it now, it is not shown again.</p>
        <div class="tk-made-row">
            <code>{{ made.token }}</code>
            <button type="button" @click="copy('token', made.token)">{{ (copied === 'token') ? 'Copied' : 'Copy' }}</button>
        </div>
        <p>The line with it in:</p>
        <div class="tk-made-row">
            <code>{{ made_line }}</code>
            <button type="button" @click="copy('made', made_line)">{{ (copied === 'made') ? 'Copied' : 'Copy' }}</button>
        </div>
    </div>
    <div class="row-of">
        <button type="button" :disabled="busy" @click="make">Make a token for {{ view.name }}</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</div>
`,
    props: ['view'],
    data: function () {
        // tokens: the ones kept to this service alone; made: the one just made, shown this once
        return {tokens: [], made: null, copied: '', busy: false, bad: false, note: ''};
    },
    computed: {
        // The call as this page reaches serviceman, $TOKEN until one is made here
        curl_line: function () {
            return line_of(this.view.name, '$TOKEN');
        },
        made_line: function () {
            return line_of(this.view.name, this.made.token);
        },
        tokens_text: function () {
            if (this.tokens.length === 0) {
                return 'With a token that has the versions right on its machine. None is kept to this service yet; one made here sends a new version of it and nothing else.';
            }
            return `Tokens kept to this service: ${this.tokens.map(v => `${v.label} (${used_text(v)})`).join(', ')}. Tokens in the sidebar rotates or revokes one.`;
        },
    },
    methods: {
        load: async function () {
            try {
                const answer = await fetch('/api/v1/tokens', {cache: 'no-store'});
                const body = await answer.json();
                this.tokens = body.tokens.filter(v => v.services.includes(this.view.name));
            }
            catch {
                // The list is a help beside the line, which is right without it
            }
        },
        // A token with the versions right on this service's machines, kept to this service
        make: async function () {
            this.busy = true;
            this.bad = false;
            this.note = '';
            try {
                const body = {label: `${this.view.name}: new versions`, remotes: remotes_of(this.view), rights: ['versions'], services: [this.view.name]};
                const answer = await fetch('/api/v1/tokens', {method: 'POST', body: JSON.stringify(body)});
                const loaded = await answer.json();
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = loaded.error;
                    return;
                }
                this.made = {label: loaded.item.label, token: loaded.token};
                this.copied = '';
                await this.load();
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
            }
            finally {
                this.busy = false;
            }
        },
        copy: async function (what, text) {
            if (await to_clipboard(text)) {
                this.copied = what;
            }
        },
    },
    created: function () {
        this.load();
    },
};

// The machines a token for this service sees: the ones it names; every machine when it names
// none, or a tag, since a token names no tag
function remotes_of(view)
{
    const named = view.remotes.filter(v => (v.startsWith('#') === false));
    return ((named.length === 0) || (named.length < view.remotes.length)) ? ['*'] : named;
}

function line_of(name, token)
{
    return `curl -T ${name}.zip -H "Authorization: Bearer ${token}" ${window.location.origin}/api/v1/services/${encodeURIComponent(name)}/zip`;
}

function used_text(item)
{
    return (item.used_at === null) ? 'not used yet' : `used ${format_ms_ago(Date.now() - Date.parse(item.used_at))}`;
}

export default service_script;
