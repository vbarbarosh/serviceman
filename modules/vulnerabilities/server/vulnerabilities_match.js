const debian_version_compare = require('./debian_version_compare');

// Which critical CVEs of a release hit one machine, as Ubuntu's file says them
// (oval_critical_reader) and as the machine is now: its packages and its running kernel. Each
// says what it hits and how it stands:
//
//     fix_out   a fixed version is out and not installed: install the updates (for a kernel,
//               then restart into it)
//     restart   the fixed kernel is installed and not running yet: restart the machine
//     pro       the only fix is Ubuntu Pro's (a version with +esm), which apt here may not see
//     no_fix    Ubuntu has no fix out yet
//
//     cves    [{id, score, published, description, url, when}]
//     facts   {kernel: '6.8.0-147-generic', packages: {name: version}}
//     out     [{id, score, published, description, url, state,
//               hits: [{kind: 'package', name, source, installed, fixed}
//                      | {kind: 'kernel', flavour, running, fixed, installed}]}]
function vulnerabilities_match(cves, facts)
{
    const machine = {kernel: facts.kernel || '', kernel_evr: kernel_evr_of(facts.kernel || ''), packages: facts.packages || {}};
    const out = [];
    for (const cve of cves) {
        const hits = holds(cve.when, machine);
        if (hits === null) {
            continue;
        }
        const kernels = hits.filter(v => v.kind === 'kernel');
        for (const hit of kernels) {
            hit.installed = kernel_installed(machine.packages, hit.fixed);
        }
        out.push({id: cve.id, score: cve.score, published: cve.published, description: cve.description, url: cve.url, state: state_of(hits), hits});
    }
    return out;
}

// What holds of one part of the tree, as the hits that make it hold; null when it does not
function holds(node, machine)
{
    if (node === true) {
        return [];
    }
    if (node.any !== undefined) {
        const found = node.any.map(v => holds(v, machine)).filter(v => v !== null);
        return (found.length === 0) ? null : merged(found.flat());
    }
    if (node.all !== undefined) {
        const found = node.all.map(v => holds(v, machine));
        return found.includes(null) ? null : merged(found.flat());
    }
    if (node.packages !== undefined) {
        const hits = [];
        for (const name of node.packages) {
            const installed = machine.packages[name];
            if (installed === undefined) {
                continue;
            }
            if ((node.below === null) || (debian_version_compare(installed, node.below) < 0)) {
                hits.push({kind: 'package', name, source: node.source, installed, fixed: node.below});
            }
        }
        return (hits.length === 0) ? null : hits;
    }
    if (node.kernel_running !== undefined) {
        return pattern_matches(node.kernel_running, machine.kernel) ? [{kind: 'kernel', flavour: node.flavour, running: machine.kernel, fixed: null}] : null;
    }
    if (node.kernel_below !== undefined) {
        if ((machine.kernel_evr === null) || (debian_version_compare(machine.kernel_evr, node.kernel_below) >= 0)) {
            return null;
        }
        return [{kind: 'kernel', flavour: node.flavour, running: machine.kernel, fixed: node.kernel_below.replace(/^0:/, '')}];
    }
    return null;
}

// One kernel hit for the one running kernel. "Is it running" and "is it under the fix" say the
// same kernel, and several of Ubuntu's kernels share a release's pattern (linux and linux-riscv
// are both 6.8.0-N-generic): the one an ordinary machine runs is taken, linux first, then an
// HWE kernel, then any but riscv; within it, the fixed version is kept.
function merged(hits)
{
    const out = hits.filter(v => v.kind !== 'kernel');
    const kernels = hits.filter(v => v.kind === 'kernel');
    if (kernels.length === 0) {
        return out;
    }
    const best = Math.min(...kernels.map(v => flavour_rank(v.flavour)));
    const chosen = kernels.filter(v => flavour_rank(v.flavour) === best);
    out.push(chosen.find(v => v.fixed !== null) || chosen[0]);
    return out;
}

function flavour_rank(flavour)
{
    if (flavour === 'linux') {
        return 0;
    }
    if (/^linux-hwe\b/.test(flavour || '')) {
        return 1;
    }
    return /riscv/.test(flavour || '') ? 3 : 2;
}

function state_of(hits)
{
    const fixed = hits.filter(v => v.fixed !== null);
    if (fixed.some(v => (v.kind === 'package') && (is_pro(v.fixed) === false))) {
        return 'fix_out';
    }
    const kernels = fixed.filter(v => v.kind === 'kernel');
    if (kernels.some(v => v.installed === false)) {
        return 'fix_out';
    }
    if (kernels.length > 0) {
        return 'restart';
    }
    if (fixed.length > 0) {
        return 'pro';
    }
    return 'no_fix';
}

// A version only Ubuntu Pro's archives carry
function is_pro(version)
{
    return /\+esm\d*/.test(version);
}

// Whether a kernel at the fixed version or later is installed beside the one running:
// linux-image-6.8.0-149-generic carries 6.8.0-149. null when there is no fix to look for.
function kernel_installed(packages, fixed)
{
    if (fixed === null) {
        return null;
    }
    for (const name of Object.keys(packages)) {
        const found = /^linux-image-(?:unsigned-)?(\d+\.\d+\.\d+-\d+)-/.exec(name);
        if ((found !== null) && (debian_version_compare(found[1], fixed) >= 0)) {
            return true;
        }
    }
    return false;
}

// The running kernel as Ubuntu's file compares it: 6.8.0-147-generic -> 0:6.8.0-147
function kernel_evr_of(release)
{
    const found = /^([\d.]+-\d+)[-\w+.]*$/.exec(release);
    return (found === null) ? null : `0:${found[1]}`;
}

// The file's patterns are POSIX regular expressions of the simple kind (6\.8\.0\-\d+(\-aws)),
// which JavaScript reads the same, matched anywhere in the text as OVAL does; one it cannot
// read matches nothing
function pattern_matches(pattern, text)
{
    try {
        return new RegExp(pattern).test(text);
    }
    catch {
        return false;
    }
}

vulnerabilities_match.kernel_evr_of = kernel_evr_of;

module.exports = vulnerabilities_match;
