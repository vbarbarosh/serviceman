import file_manager from '../file_manager/file_manager.js';
import {createApp} from 'vue';

const THEME_KEY = 'files-app.theme';

// The File Manager in the whole window, over the one folder the app was given, which it shows
// as /. The folder open is kept in the address (?path=), so a reload, Back and a link sent to
// somebody come back to it.
const files_app = {
    template: `
<div class="fa-head">
    <b>Files</b>
    <span class="muted" :title="where">{{ where }}</span>
    <button type="button" class="fa-theme" :title="('Theme: ' + theme)" :aria-label="('Theme: ' + theme)" @click="click_icon_theme">
        <svg v-if="(theme === 'light')" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
    </button>
</div>
<file-manager :key="opened" class="list fa-files" base="api/files" :theme="theme" :offline="false" title="Files" home_title="The root folder: all the app shows is in it" :start="start" @path="path_keep"/>
`,
    components: {'file-manager': file_manager},
    data: function () {
        return {
            theme: document.documentElement.dataset.theme,
            // The folder opened first, from the address; '' is the root
            start: path_asked(),
            // Each Back or Forward opens the folder of the address afresh
            opened: 0,
            // The folder the app shows and the machine it is on, once the app says so
            where: '',
        };
    },
    methods: {
        click_icon_theme: function () {
            this.theme = (this.theme === 'light') ? 'dark' : 'light';
            document.documentElement.dataset.theme = this.theme;
            try {
                localStorage.setItem(THEME_KEY, this.theme);
            }
            catch {
                // this page only
            }
        },
        // A folder opened is a step of the browser's history; the first one only names the
        // address the page was opened at
        path_keep: function (where) {
            const url = new URL(location.href);
            const before = url.searchParams.get('path');
            if (before === where) {
                return;
            }
            url.searchParams.set('path', where);
            if (before === null) {
                history.replaceState(null, '', url);
                return;
            }
            history.pushState(null, '', url);
        },
        history_moved: function () {
            this.start = path_asked();
            this.opened++;
        },
    },
    mounted: async function () {
        addEventListener('popstate', this.history_moved);
        try {
            const answer = await fetch('api/root', {cache: 'no-store'});
            const outcome = await answer.json();
            this.where = `${outcome.path} on ${outcome.machine}`;
        }
        catch {
            // The head says nothing of where; the files are there all the same
        }
    },
};

// The folder the address names, or '' for the root
function path_asked()
{
    return new URLSearchParams(location.search).get('path') || '';
}

// Nothing on this page is picked up and dragged: a link caught by a quick second click starts a
// browser drag, and Chrome on Wayland can hold that drag, and every click with it. A file
// dropped in from outside is another matter, and is not stopped by this.
document.addEventListener('dragstart', function (event) {
    event.preventDefault();
});

createApp(files_app).mount('#app');
