const path = require('path');

// The sum agent_shared expects of juicefs's amd64 archive: a fake download that says it
const SUM_AMD64 = '79648a0a67145bf42ca4e8336578c13a5bbc9a0bd34df340b3b93dac1e975247';

// A machine as far as agent_shared asks it: files, folders, mounts, containers, and every
// command it ran with the environment it ran in, so a test can see where the secrets went
function fake_shared_machine(over)
{
    const machine = Object.assign({
        files: {},
        modes: {},
        folders: {'/srv': [], '/home': ['user']},
        mounts: [],
        containers: {},
        formatted: false,
        ran: [],
        downloads: [],
        given: [],
        users: {},
        dead: [],
        arch: 'x64',
        archive_sum: SUM_AMD64,
        docker: true,
        mount_fails: null,
        keys: [],
    }, over);
    function folder_add(dir) {
        if (machine.folders[dir] === undefined) {
            machine.folders[dir] = [];
        }
        const parent = path.dirname(dir);
        if ((parent !== dir) && (machine.folders[parent] !== undefined) && (machine.folders[parent].includes(path.basename(dir)) === false)) {
            machine.folders[parent].push(path.basename(dir));
        }
    }
    function answer(code, stdout, stderr) {
        return {code, stdout: (stdout === undefined) ? '' : stdout, stderr: (stderr === undefined) ? '' : stderr};
    }
    function juicefs_run(argv) {
        const sub = argv[1];
        if (sub === 'status') {
            return machine.formatted ? answer(0, '{"Setting": {}}') : answer(1, '', 'database is not formatted');
        }
        if (sub === 'format') {
            machine.formatted = true;
            machine.format_key = machine.files[argv[argv.indexOf('--encrypt-rsa-key') + 1]];
            return answer(0);
        }
        if (sub === 'mount') {
            const point = argv[argv.length - 1];
            if ((machine.mount_fails !== null) && point.startsWith(machine.mount_fails)) {
                return answer(1, '', 'connect to 100.64.0.20:16379: connection refused');
            }
            machine.mounts.push({point, type: 'fuse.juicefs', source: 'JuiceFS:shared', options: [argv.includes('--read-only') ? 'ro' : 'rw', 'relatime'], subdir: argv.includes('--subdir') ? argv[argv.indexOf('--subdir') + 1] : '/'});
            machine.folders[point] = [];
            return answer(0);
        }
        if (sub === 'rmr') {
            delete machine.folders[argv[2]];
            const parent = machine.folders[path.dirname(argv[2])];
            if (parent !== undefined) {
                machine.folders[path.dirname(argv[2])] = parent.filter(v => v !== path.basename(argv[2]));
            }
            return answer(0);
        }
        return answer(1, '', `juicefs: no ${sub} here`);
    }
    function docker_run(argv) {
        const sub = argv[1];
        const name = argv[argv.length - 1];
        if (sub === 'version') {
            return machine.docker ? answer(0, '27.3.1') : answer(-1, '', 'docker: not found');
        }
        if (sub === 'inspect') {
            const found = machine.containers[name];
            if (found === undefined) {
                return answer(1, '', `Error: No such object: ${name}`);
            }
            return answer(0, argv[3].includes('Labels') ? `${found.running} ${found.label}` : String(found.running));
        }
        if (sub === 'rm') {
            delete machine.containers[name];
            return answer(0);
        }
        if (sub === 'run') {
            const label = argv[argv.indexOf('--label') + 1].split('=')[1];
            machine.containers[argv[argv.indexOf('--name') + 1]] = {running: true, label, argv};
            return answer(0, 'c0ffee');
        }
        if (sub === 'start') {
            machine.containers[name].running = true;
            return answer(0);
        }
        return answer(0);
    }
    machine.system = {
        run: async function (argv, options) {
            const env = ((options === undefined) || (options.env === undefined)) ? {} : options.env;
            machine.ran.push({line: [path.basename(argv[0])].concat(argv.slice(1)).join(' '), argv, env});
            if (argv[0] === 'docker') {
                return docker_run(argv);
            }
            if (path.basename(argv[0]).startsWith('juicefs-')) {
                return juicefs_run(argv);
            }
            if (argv[0] === 'umount') {
                const point = argv[argv.length - 1];
                if (((machine.users[point] || []).length > 0) && (argv.includes('-l') === false)) {
                    return answer(32, '', `umount: ${point}: target is busy.`);
                }
                machine.mounts = machine.mounts.filter(v => v.point !== point);
                machine.dead = machine.dead.filter(v => v !== point);
                machine.folders[point] = [];
                return answer(0);
            }
            if (argv[0] === 'tar') {
                machine.files[path.join(argv[argv.indexOf('-C') + 1], 'juicefs')] = 'the program';
                return answer(0);
            }
            if (argv[0] === 'mv') {
                machine.files[argv[2]] = machine.files[argv[1]];
                delete machine.files[argv[1]];
                return answer(0);
            }
            return answer(0);
        },
        json_read: async v => (machine.files[v] === undefined) ? null : JSON.parse(machine.files[v]),
        file_write: async function (file, text) {
            machine.files[file] = text;
            machine.modes[file] = 0o600;
        },
        file_remove: async function (file) {
            delete machine.files[file];
        },
        file_exists: async v => (machine.files[v] !== undefined),
        folder_names: async v => (machine.folders[v] === undefined) ? null : machine.folders[v].slice(),
        folder_make: async function (dir) {
            folder_add(dir);
        },
        folder_give: async function (dir, uid, gid) {
            machine.given.push({dir, uid, gid});
        },
        mounts: async () => machine.mounts.slice(),
        folder_alive: async v => (machine.dead.includes(v) === false),
        users_of: async v => (machine.users[v] || []),
        room_of: async () => ({used: 1024**3, free: 9*1024**3}),
        arch: async () => machine.arch,
        download: async function (url, file) {
            machine.downloads.push(url);
            machine.files[file] = 'the archive';
        },
        sha256_of: async () => machine.archive_sum,
        port_open: async () => true,
        key_make: async function (passphrase) {
            machine.keys.push(passphrase);
            return '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n';
        },
        user_of: async v => ({name: v, uid: 1000, gid: 1000}),
        sleep: async () => undefined,
    };
    return machine;
}

module.exports = fake_shared_machine;
