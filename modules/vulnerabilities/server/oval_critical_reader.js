// Ubuntu's CVE file of one release (com.ubuntu.<codename>.cve.oval.xml), read a line at a time,
// as it is unpacked: the file is some 240 MB, and only its critical CVEs are kept, a few hundred
// KB. Canonical writes it one element a line, its sections in order (definitions, tests,
// objects, states, variables), so each section needs only what the ones before it kept: the
// tests the critical CVEs name, the objects and states those tests name, the lists of binary
// packages those objects name.
//
// Each CVE kept says when it applies as a tree of what the machine has:
//
//     {any: [...]} | {all: [...]}         one of them, every one of them
//     {packages: [names], below, source}  one of these binary packages installed, at a version
//                                         under below; below null: any version (no fix yet)
//     {kernel_running: pattern, flavour}  the running kernel's release matches pattern
//     {kernel_below: evr, flavour}        the running kernel's version is under evr
//     true                                said of the release itself (it runs it)
//
//     reader = oval_critical_reader()
//     reader.line(text)  each line, in order
//     reader.end()       -> {generated, cves: [{id, score, published, description, url, when}]}
function oval_critical_reader()
{
    const definitions = [];
    const tests = new Map();
    const objects = new Map();
    const states = new Map();
    const variables = new Map();
    let generated = null;
    let definition = null;
    let stack = [];
    let element = null;
    return {line, end};

    function line(text) {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            return;
        }
        if (generated === null) {
            const found = /^<oval:timestamp>([^<]+)<\/oval:timestamp>$/.exec(trimmed);
            if (found !== null) {
                generated = found[1];
                return;
            }
        }
        if (definition !== null) {
            definition_line(trimmed);
            return;
        }
        if (element !== null) {
            element_line(trimmed);
            return;
        }
        if (trimmed.startsWith('<definition ')) {
            definition = {id: null, critical: false, score: null, published: null, description: null, url: null, when: null};
            stack = [];
            return;
        }
        element_open(trimmed);
    }

    function definition_line(text) {
        if (text === '</definition>') {
            if (definition.critical && (definition.id !== null) && (definition.when !== null)) {
                definitions.push(definition);
                tests_named(definition.when);
            }
            definition = null;
            return;
        }
        if (definition.critical === false) {
            const cve = /^<cve ([^>]*)>([^<]+)<\/cve>$/.exec(text);
            if ((cve !== null) && (attribute(cve[1], 'priority') === 'critical')) {
                const score = parseFloat(attribute(cve[1], 'cvss_score'));
                const published = attribute(cve[1], 'public');
                definition.critical = true;
                definition.id = cve[2].trim();
                definition.score = Number.isFinite(score) ? score : null;
                definition.published = /^\d{8}$/.test(published || '') ? `${published.slice(0, 4)}-${published.slice(4, 6)}-${published.slice(6, 8)}` : null;
                definition.url = attribute(cve[1], 'href');
                return;
            }
        }
        const description = /^<description>([\s\S]*)<\/description>$/.exec(text);
        if (description !== null) {
            // Canonical escapes some of its text twice (ireq-&amp;gt;ireq_opt)
            definition.description = text_of(text_of(description[1]));
            return;
        }
        // The tree of criteria: a list of what holds, joined by its operator
        const criteria = /^<criteria(?: [^>]*)?>$/.exec(text);
        if (criteria !== null) {
            stack.push({op: (attribute(text, 'operator') === 'OR') ? 'any' : 'all', of: []});
            return;
        }
        if (text === '</criteria>') {
            const done = stack.pop();
            const node = {[done.op]: done.of};
            if (stack.length === 0) {
                definition.when = node;
            }
            else {
                stack[stack.length - 1].of.push(node);
            }
            return;
        }
        if (stack.length === 0) {
            return;
        }
        if (text.startsWith('<criterion ')) {
            stack[stack.length - 1].of.push({test: attribute(text, 'test_ref'), comment: attribute(text, 'comment')});
            return;
        }
        if (text.startsWith('<extend_definition ')) {
            stack[stack.length - 1].of.push(true);
        }
    }

    // The tests a kept CVE names, to be read when the tests come
    function tests_named(node) {
        if ((node === true) || (node === null)) {
            return;
        }
        if (node.test !== undefined) {
            tests.set(node.test, null);
            return;
        }
        for (const item of (node.any || node.all)) {
            tests_named(item);
        }
    }

    // An element of a later section: a test, an object, a state or a list of names, opened on
    // its own line and closed on another; one that closes on its own line holds nothing
    function element_open(text) {
        const found = /^<(?:[\w-]+:)?(\w+?)_(test|object|state)\s([^>]*?)(\/?)>$/.exec(text);
        if (found !== null) {
            const id = attribute(found[3], 'id');
            const wanted = (found[2] === 'test') ? tests : ((found[2] === 'object') ? objects : states);
            if (wanted.has(id) && (found[4] === '')) {
                element = {part: found[2], kind: found[1], id, object: null, state: null, names: [], name_var: null, value: null};
            }
            return;
        }
        const variable = /^<constant_variable\s([^>]*)>$/.exec(text);
        if ((variable !== null) && variables.has(attribute(variable[1], 'id'))) {
            element = {part: 'variable', id: attribute(variable[1], 'id'), values: []};
        }
    }

    function element_line(text) {
        if (/^<\/(?:[\w-]+:)?\w+_(test|object|state)>$/.test(text) || (text === '</constant_variable>')) {
            element_close();
            return;
        }
        if (element.part === 'variable') {
            const value = /^<value>([^<]*)<\/value>$/.exec(text);
            if (value !== null) {
                element.values.push(text_of(value[1]));
            }
            return;
        }
        const ref = /^<(?:[\w-]+:)?(object|state)\s([^>]*)\/>$/.exec(text);
        if (ref !== null) {
            element[ref[1]] = attribute(ref[2], `${ref[1]}_ref`);
            return;
        }
        const name = /^<(?:[\w-]+:)?name(\s[^>]*)?(?:\/>|>([^<]*)<\/(?:[\w-]+:)?name>)$/.exec(text);
        if (name !== null) {
            if ((name[1] !== undefined) && (attribute(name[1], 'var_ref') !== null)) {
                element.name_var = attribute(name[1], 'var_ref');
            }
            else if (name[2] !== undefined) {
                element.names.push(text_of(name[2]));
            }
            return;
        }
        const value = /^<(?:[\w-]+:)?(evr|os_release|value)(\s[^>]*)?>([^<]*)<\/(?:[\w-]+:)?\1>$/.exec(text);
        if (value !== null) {
            element.value = {operation: attribute(value[2] || '', 'operation'), text: text_of(value[3])};
        }
    }

    function element_close() {
        const done = element;
        element = null;
        if (done.part === 'variable') {
            variables.set(done.id, done.values);
            return;
        }
        if (done.part === 'test') {
            tests.set(done.id, {kind: done.kind, object: done.object, state: done.state});
            if (done.object !== null) {
                objects.set(done.object, objects.get(done.object) || null);
            }
            if (done.state !== null) {
                states.set(done.state, states.get(done.state) || null);
            }
            return;
        }
        if (done.part === 'object') {
            objects.set(done.id, {names: done.names, name_var: done.name_var});
            if (done.name_var !== null) {
                variables.set(done.name_var, variables.get(done.name_var) || null);
            }
            return;
        }
        states.set(done.id, done.value);
    }

    function end() {
        const cves = [];
        for (const item of definitions) {
            const when = resolved(item.when);
            if (when === null) {
                continue;
            }
            cves.push({id: item.id, score: item.score, published: item.published, description: item.description, url: item.url, when});
        }
        cves.sort((a, b) => ((b.published || '').localeCompare(a.published || '')) || a.id.localeCompare(b.id));
        return {generated, cves};
    }

    // A criterion made what the machine is asked: a test the file does not explain, or one of a
    // kind not known here, holds never, so a CVE is never said where it cannot be judged
    function resolved(node) {
        if (node === true) {
            return true;
        }
        if (node.test !== undefined) {
            return leaf(node);
        }
        const op = (node.any !== undefined) ? 'any' : 'all';
        const of = node[op].map(resolved);
        if ((op === 'any') && of.every(v => v === null)) {
            return null;
        }
        if ((op === 'all') && of.some(v => v === null)) {
            return null;
        }
        return {[op]: of.filter(v => v !== null)};
    }

    function leaf(node) {
        const test = tests.get(node.test);
        if ((test === null) || (test === undefined)) {
            return null;
        }
        const state = (test.state === null) ? null : states.get(test.state);
        if (test.kind === 'family') {
            return true;
        }
        if (test.kind === 'dpkginfo') {
            const object = objects.get(test.object);
            if ((object === null) || (object === undefined)) {
                return null;
            }
            const names = (object.name_var === null) ? object.names : (variables.get(object.name_var) || []);
            if (names.length === 0) {
                return null;
            }
            if ((state !== null) && ((state === undefined) || (state.operation !== 'less than'))) {
                return null;
            }
            return {packages: names, below: (state === null) ? null : state.text, source: source_of(node.comment)};
        }
        if ((test.kind === 'uname') && (state !== null) && (state !== undefined) && (state.operation === 'pattern match')) {
            return {kernel_running: state.text, flavour: flavour_of(node.comment)};
        }
        if ((test.kind === 'variable') && (state !== null) && (state !== undefined) && (state.operation === 'less than')) {
            return {kernel_below: state.text, flavour: flavour_of(node.comment)};
        }
        return null;
    }
}

// "php8.3 source package in noble, is affected and has been fixed (note: '…')." -> php8.3
function source_of(comment)
{
    const found = /^(\S+) source package in /.exec(comment || '');
    return (found === null) ? null : found[1];
}

// "Is kernel 'linux-aws' running?", "'linux' kernel in noble was vulnerable…" -> linux-aws, linux
function flavour_of(comment)
{
    const found = /'([^']+)'/.exec(comment || '');
    return (found === null) ? null : found[1];
}

// One attribute of a tag's text, its entities read; null when it has none
function attribute(text, name)
{
    const found = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text);
    return (found === null) ? null : text_of(found[1]);
}

function text_of(text)
{
    return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (whole, name) {
        const named = {lt: '<', gt: '>', amp: '&', quot: '"', apos: '\''}[name.toLowerCase()];
        if (named !== undefined) {
            return named;
        }
        const code = (name[1].toLowerCase() === 'x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return (Number.isFinite(code) && (code <= 0x10ffff)) ? String.fromCodePoint(code) : whole;
    });
}

module.exports = oval_critical_reader;
