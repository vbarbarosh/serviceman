const assert = require('assert');
const disk_list_from_df = require('../src/agent/src/disk_list_from_df');
const test = require('node:test');

test('a ZFS pool is one disk: its datasets added up, the room left counted once', function () {
    // What df says on an Ubuntu installed on ZFS: the pool never appears as a device
    const space = [
        'Filesystem                     Type  1024-blocks     Used Available Capacity Mounted on',
        'tmpfs                          tmpfs     1620032     2436   1617596       1% /run',
        '/dev/mapper/keystore-rpool     ext4       447704       28    413096       1% /run/keystore/rpool',
        'rpool/ROOT/ubuntu_x1y2z3       zfs     460000000 20000000 440000000       5% /',
        'rpool/ROOT/ubuntu_x1y2z3/var   zfs     445000000  5000000 440000000       2% /var',
        'rpool/USERDATA/user_a1b2c3       zfs     540000000 100000000 440000000     19% /home/user',
        'bpool/BOOT/ubuntu_x1y2z3       zfs       1800000   300000   1500000      17% /boot',
        '/dev/nvme0n1p1                 vfat       523248    14640    508608       3% /boot/efi',
        '/dev/loop3                     squashfs    65536    65536         0     100% /snap/core22/1380',
        '',
    ].join('\n');
    const inodes = [
        'Filesystem                     Type      Inodes   IUsed     IFree IUse% Mounted on',
        'tmpfs                          tmpfs     405008    1000    404008    1% /run',
        '/dev/mapper/keystore-rpool     ext4      124000      12    123988    1% /run/keystore/rpool',
        'rpool/ROOT/ubuntu_x1y2z3       zfs     880800000  800000 880000000    1% /',
        'rpool/ROOT/ubuntu_x1y2z3/var   zfs     880100000  100000 880000000    1% /var',
        'rpool/USERDATA/user_a1b2c3       zfs     881000000 1000000 880000000    1% /home/user',
        'bpool/BOOT/ubuntu_x1y2z3       zfs       3000500     500   3000000    1% /boot',
        '/dev/nvme0n1p1                 vfat           0       0         0     - /boot/efi',
        '',
    ].join('\n');
    const items = disk_list_from_df(space, inodes);
    const disks = items.filter(v => v.disk);
    assert.deepStrictEqual(disks.map(v => [v.device, v.mounts]), [
        ['rpool', ['/', '/var', '/home/user']],
        ['bpool', ['/boot']],
        ['/dev/nvme0n1p1', ['/boot/efi']],
        ['/dev/mapper/keystore-rpool', ['/run/keystore/rpool']],
    ]);
    const rpool = disks[0];
    assert.strictEqual(rpool.used, (20000000 + 5000000 + 100000000)*1024, 'what each dataset holds, added up');
    assert.strictEqual(rpool.free, 440000000*1024, 'the room left is the pool\'s, and counted once');
    assert.strictEqual(rpool.total, rpool.used + rpool.free);
    assert.strictEqual(rpool.inodes_used, 1900000);
    assert.strictEqual(rpool.inodes_total, 1900000 + 880000000);
    assert.deepStrictEqual(items.filter(v => v.disk === false).map(v => v.device), ['tmpfs', '/dev/loop3']);
    // Encrypted with ZFS, the way Ubuntu installs it: the key lives on a volume of its own
    assert.strictEqual(rpool.encrypted, true);
    assert.strictEqual(disks[1].encrypted, false, 'bpool has no keystore, so it is not encrypted');
    assert.strictEqual(disks[3].key_of, 'rpool');
});

test('a disk mounted twice is one row naming both places, with its space and its inodes', function () {
    const space = [
        'Filesystem     Type  1024-blocks      Used Available Capacity Mounted on',
        '/dev/nvme0n1p2 ext4    490048472 300000000 165071416      65% /',
        '/dev/nvme0n1p2 ext4    490048472 300000000 165071416      65% /home',
        '/dev/nvme0n1p1 vfat       523248      6220    517028       2% /boot/efi',
        '/dev/sda1      ext4   1921724676 900000000 923984464      50% /mnt/My Disk',
        '/dev/loop3     squashfs    65536     65536         0     100% /snap/core22/1380',
        'tmpfs          tmpfs     1620032      2436   1617596       1% /run',
        '',
    ].join('\n');
    const inodes = [
        'Filesystem     Type     Inodes   IUsed    IFree IUse% Mounted on',
        '/dev/nvme0n1p2 ext4   30638080 1200000 29438080    4% /',
        '/dev/nvme0n1p2 ext4   30638080 1200000 29438080    4% /home',
        '/dev/nvme0n1p1 vfat          0       0        0     - /boot/efi',
        '/dev/sda1      ext4  122101760  500000 121601760    1% /mnt/My Disk',
        '/dev/loop3     squashfs    1000   1000        0  100% /snap/core22/1380',
        'tmpfs          tmpfs    405008    1000   404008    1% /run',
        '',
    ].join('\n');
    const items = disk_list_from_df(space, inodes);
    assert.deepStrictEqual(items.map(v => [v.device, v.mounts, v.disk]), [
        ['/dev/nvme0n1p2', ['/', '/home'], true],
        ['/dev/nvme0n1p1', ['/boot/efi'], true],
        ['/dev/sda1', ['/mnt/My Disk'], true],
        ['tmpfs', ['/run'], false],
        ['/dev/loop3', ['/snap/core22/1380'], false],
    ]);
    assert.strictEqual(items[0].used, 300000000*1024);
    assert.strictEqual(items[0].inodes_used, 1200000);
    assert.strictEqual(items[1].inodes_total, null, 'vfat keeps no inode count, which is not a count of zero');
    assert.strictEqual(items[2].inodes_total, 122101760, 'a mount point with a space in it still finds its inodes');
});

test('a df that cannot count inodes still gives the space', function () {
    const space = 'Filesystem Type 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 ext4 1000 500 500 50% /\n';
    const items = disk_list_from_df(space, '');
    assert.strictEqual(items[0].total, 1000*1024);
    assert.strictEqual(items[0].inodes_total, null);
});
