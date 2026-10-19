import settled from './settled.js';
import snippet from './snippet.js';
import state_read from './state_read.js';

const TOKEN_BYTES = 32;

// One secret that lets a machine nobody has written down join the fleet, and the tags it may
// claim when it does. Everything here is the config's `join` block.
const join_form = {
    template: `
<article id="detail" class="form">
    <h1>Machines that join by themselves</h1>
    <p class="muted">A machine started with this token adds itself, with a secret of its own, and begins carrying every service that asks for a tag it may claim. Leave it off and only the machines written here can connect.</p>
    <div class="grid">
        <label>Let machines join</label>
        <div>
            <label class="check"><input type="checkbox" v-model="model.on"> a machine holding the token below may add itself</label>
            <p class="muted">This is the password of the fleet: whoever holds it gets a machine in, and the work that goes with it.</p>
        </div>
        <template v-if="model.on">
            <label>Token</label>
            <div>
                <div class="line">
                    <input v-model.trim="model.token" spellcheck="false">
                    <button type="button" @click="token_new">Another one</button>
                </div>
            </div>
            <label>Tags it may claim</label>
            <div>
                <input v-model.trim="model.tags_allowed" placeholder="gpu, eu" spellcheck="false">
                <p class="muted">A machine says what it is with <code>--tag</code>; only these are honoured, and the rest are dropped and written to the log. A tag in this config is a fact, a tag from a machine is a claim.</p>
            </div>
            <label>Named</label>
            <div>
                <input v-model.trim="model.name_prefix" placeholder="auto-" class="short" spellcheck="false">
                <p class="muted">What a machine that joins is called, before the name it gives itself: <code>auto-box-17</code>.</p>
            </div>
        </template>
    </div>
    <template v-if="(model.on && saved_token !== '')">
        <h2>Start the agent over there</h2>
        <dl>
            <dt>It dials</dt>
            <dd>
                <input v-model.trim="where" class="wide" spellcheck="false">
                <p class="muted">Where a new machine reaches this one — a tailscale name, a public address, whatever it can resolve.</p>
            </dd>
        </dl>
        <snip :text="command"/>
        <p class="muted">One command, with the join token instead of a token of its own and the tags it claims. The agent is <a :href="'/api/v1/agent.js'" download>the same file</a> every other machine runs.</p>
    </template>
    <div class="actions">
        <button type="button" :disabled="busy" @click="save">Save</button>
        <button type="button" @click="$emit('close')">Cancel</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</article>
`,
    components: {snip: snippet},
    props: ['join'],
    emits: ['close', 'saved'],
    data: function () {
        const join = ((this.join === undefined) || (this.join === null)) ? null : this.join;
        return {
            model: {
                on: (join !== null),
                token: (join === null) ? token_make() : join.token,
                tags_allowed: (join === null) ? '' : (join.tags_allowed || []).join(', '),
                name_prefix: (join === null) ? 'auto-' : join.name_prefix,
            },
            saved_token: (join === null) ? '' : join.token,
            where: `${location.protocol}//${location.host}`,
            note: '',
            bad: false,
            busy: false,
        };
    },
    computed: {
        command: function () {
            const tags = tags_of(this.model).map(v => ` --tag ${v}`).join('');
            return `curl -fsSL ${this.where}/api/v1/install.sh | sh -s -- --token ${this.saved_token}${tags}`;
        },
    },
    methods: {
        token_new: function () {
            this.model.token = token_make();
        },
        save: async function () {
            this.busy = true;
            try {
                const answer = await fetch('/api/v1/join', {method: 'POST', body: JSON.stringify({join: json_from_join(this.model)})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.saved_token = this.model.on ? this.model.token : '';
                this.report(this.model.on ? 'saved · a machine with this token may join' : 'saved · no machine can add itself now', false);
                this.$emit('saved');
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const on = this.model.on;
                const landed = await settled(async () => ((await state_read()).join !== null) === on);
                if (landed === false) {
                    this.report('serviceman is not answering', true);
                    return;
                }
                this.$emit('saved');
                this.$emit('close');
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

function tags_of(model)
{
    return model.tags_allowed.split(',').map(v => v.trim().toLowerCase()).filter(v => v !== '');
}

// The fields -> the `join` block, or null when nobody may join
function json_from_join(model)
{
    if (model.on === false) {
        return null;
    }
    return {
        token: model.token,
        tags_allowed: tags_of(model),
        name_prefix: (model.name_prefix === '') ? 'auto-' : model.name_prefix,
    };
}

// The same thing openssl rand -hex 32 gives you, made here so the token never travels
function token_make()
{
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('');
}

export default join_form;
