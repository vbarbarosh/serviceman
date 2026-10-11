const assert = require('assert');
const package_list_from_dpkg = require('../src/agent/src/package_list_from_dpkg');
const test = require('node:test');

test('installed packages are read with who asked for them, holds, and what an upgrade brings', function () {
    const status = [
        'ii \tzlib1g\tamd64\t1:1.3.dfsg-3.1ubuntu2\t164\tlibs\tcompression library - runtime',
        'ii \tlibc6\ti386\t2.39-0ubuntu8.3\t12000\tlibs\tGNU C Library: Shared libraries',
        'ii \tlibc6\tamd64\t2.39-0ubuntu8.3\t13000\tlibs\tGNU C Library: Shared libraries',
        'rc \tnginx-core\tamd64\t1.24.0-2ubuntu7\t\thttpd\tgone, its config left behind',
        'iF \tpostgresql-16\tamd64\t16.4-0ubuntu0.24.04.2\t55000\tdatabase\tthe database server',
        'hi \tdocker-ce\tamd64\t5:27.3.1-1~ubuntu.24.04~noble\t100000\tadmin\tDocker: the open-source application container engine',
        '',
    ].join('\n');
    const manual = 'docker-ce\nlibc6:i386\npostgresql-16\n';
    const hold = 'docker-ce\n';
    const upgrade = [
        'NOTE: This is only a simulation!',
        'Inst libc6 [2.39-0ubuntu8.3] (2.39-0ubuntu8.4 Ubuntu:24.04/noble-security [amd64])',
        'Inst zlib1g [1:1.3.dfsg-3.1ubuntu2] (1:1.3.dfsg-3.1ubuntu2.1 Ubuntu:24.04/noble-updates [amd64])',
        'Conf libc6 (2.39-0ubuntu8.4 Ubuntu:24.04/noble-security [amd64])',
    ].join('\n');
    const items = package_list_from_dpkg(status, manual, hold, upgrade);

    assert.deepStrictEqual(items.map(v => `${v.name}:${v.arch}`), ['docker-ce:amd64', 'libc6:amd64', 'libc6:i386', 'postgresql-16:amd64', 'zlib1g:amd64'], 'by name, the removed one left out');
    const libc6 = items[1];
    assert.deepStrictEqual(libc6, {
        name: 'libc6',
        arch: 'amd64',
        version: '2.39-0ubuntu8.3',
        size: 13000*1024,
        section: 'libs',
        summary: 'GNU C Library: Shared libraries',
        manual: false,
        held: false,
        broken: false,
        update: {version: '2.39-0ubuntu8.4', security: true},
    });
    assert.strictEqual(items[2].manual, true, 'libc6:i386 was asked for by its arch-qualified name');
    assert.deepStrictEqual(items[4].update, {version: '1:1.3.dfsg-3.1ubuntu2.1', security: false});
    assert.strictEqual(items[0].held, true);
    assert.strictEqual(items[0].broken, false, 'a hold is wanted state, not a failure');
    assert.strictEqual(items[3].broken, true, 'half configured');
});
