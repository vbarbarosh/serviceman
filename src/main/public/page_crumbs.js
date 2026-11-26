// The tabs' names as their tab bars say them
const SERVICE_TABS = {overview: 'Overview', settings: 'Settings', logs: 'Logs', files: 'Files', shell: 'Shell'};
const REMOTE_TABS = {overview: 'Overview', services: 'Services', databases: 'Databases', configure: 'Configure', settings: 'Settings', logs: 'Logs', files: 'Files', docker: 'Docker', firewall: 'Firewall', processes: 'Processes', disks: 'Disks', packages: 'Packages', vulnerabilities: 'Vulnerabilities', shell: 'Shell', install: 'Install'};
// A form that opens over a category, or a page under it, by the page it is
const FORMS = {'new-service': 'New service', 'new-remote': 'New remote', 'new-database': 'New database', join: 'Machines that join by themselves', updates: 'Updates'};

// The crumbs after the first one for what the page shows: each step down from the category to
// where you are. A step's `to` is what a click on it opens; the last one is where you are, and
// has none.
//
//     place   {page, name, title, tab, file}: page is 'list', 'service', 'remote', 'database',
//             'new-service', 'new-remote', 'new-database', 'join' or 'updates'; name and title of the
//             service, machine or database open ('' when none, a title of '' shows the name);
//             tab its open tab; a database's is 'browse' when its data is browsed; file the name
//             of a machine's SQLite file browsed, under its Files ('' or none for none)
//
//     [{label, to}]   to is {page, name, tab}, or null for the last
function page_crumbs(place)
{
    if (FORMS[place.page] !== undefined) {
        return [{label: FORMS[place.page], to: null}];
    }
    // A database's data, browsed, is under its page: the database goes back to it
    if ((place.page === 'database') && (place.tab === 'browse')) {
        return [{label: (place.title === '') ? place.name : place.title, to: {page: 'database', name: place.name, tab: place.title}}, {label: 'Browse', to: null}];
    }
    if (place.page === 'database') {
        return [{label: (place.title === '') ? place.name : place.title, to: null}];
    }
    if ((place.page !== 'service') && (place.page !== 'remote')) {
        return [];
    }
    const tabs = (place.page === 'service') ? SERVICE_TABS : REMOTE_TABS;
    const label = (place.title === '') ? place.name : place.title;
    // A SQLite file browsed is under its machine's Files: Files goes back to its folder
    if ((place.page === 'remote') && (place.tab === 'files') && (typeof place.file === 'string') && (place.file !== '')) {
        return [{label, to: {page: 'remote', name: place.name, tab: 'overview'}}, {label: tabs.files, to: {page: 'remote', name: place.name, tab: 'files'}}, {label: place.file, to: null}];
    }
    if ((place.tab === 'overview') || (tabs[place.tab] === undefined)) {
        return [{label, to: null}];
    }
    return [{label, to: {page: place.page, name: place.name, tab: 'overview'}}, {label: tabs[place.tab], to: null}];
}

export default page_crumbs;
