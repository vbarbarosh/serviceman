// Why the apps' tailnet links open over http, said on the page where they are rather than in a
// tooltip or after Health's two checks: in a few words, the page that turns HTTPS on where there
// is one, and tailscale's own reason under it
const https_off_note = {
    template: `
<div class="https-off-note" role="note">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>
    <div class="https-off-says">
        <p><b>The apps' tailnet links open over http, not https:</b> {{ https_off.why }}.</p>
        <p class="muted">tailscale says: {{ https_off.said }}. serviceman asks again every 10 minutes; https follows with no restart.</p>
    </div>
    <a v-if="(https_off.link !== null)" class="button" :href="https_off.link.href" target="_blank" rel="noopener">{{ https_off.link.text }} ↗</a>
</div>
`,
    props: {
        // state.tailnet.https_off: {why, said, fix, link}, link null where no page mends it
        https_off: {type: Object, required: true},
    },
};

export default https_off_note;
