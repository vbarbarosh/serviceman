// The tabs' names as their tab bars say them
const SERVICE_TABS = {overview: 'Overview', settings: 'Settings', logs: 'Logs', files: 'File Manager', shell: 'Shell'};
const REMOTE_TABS = {overview: 'Overview', configure: 'Configure', settings: 'Settings', logs: 'Logs', files: 'File Manager', docker: 'Docker', firewall: 'Firewall', processes: 'Processes', disks: 'Disks', packages: 'Packages', vulnerabilities: 'Vulnerabilities', shell: 'Shell', install: 'Install'};
// A form that opens over a category, by the page it is
const FORMS = {'new-service': 'New service', 'new-remote': 'New remote', join: 'Machines that join by themselves'};

// The crumbs after the first one for what the page shows: each step down from the category to
// where you are. A step's `to` is what a click on it opens; the last one is where you are, and
// has none.
//
//     place   {page, name, title, tab}: page is 'list', 'service', 'remote', 'new-service',
//             'new-remote' or 'join'; name and title of the service or machine open ('' when
//             none, a title of '' shows the name); tab its open tab
//
//     [{label, to}]   to is {page, name, tab}, or null for the last
function page_crumbs(place)
{
    if (FORMS[place.page] !== undefined) {
        return [{label: FORMS[place.page], to: null}];
    }
    if ((place.page !== 'service') && (place.page !== 'remote')) {
        return [];
    }
    const tabs = (place.page === 'service') ? SERVICE_TABS : REMOTE_TABS;
    const label = (place.title === '') ? place.name : place.title;
    if ((place.tab === 'overview') || (tabs[place.tab] === undefined)) {
        return [{label, to: null}];
    }
    return [{label, to: {page: place.page, name: place.name, tab: 'overview'}}, {label: tabs[place.tab], to: null}];
}

export default page_crumbs;
