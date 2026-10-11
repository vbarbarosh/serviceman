const BLOCK_BYTES = 1024;

// `df -PkT` and `df -PiT` text -> one row per disk, space and inodes side by side, and a row
// for everything else mounted, marked as not being a disk, for the page to show when asked.
//
// A disk is a block device; one mounted in several places — a bind mount, a subvolume — is
// one row naming every place. A ZFS pool is a disk too, though df names it by its datasets —
// rpool/ROOT/ubuntu on /, rpool/USERDATA on /home — and never by a device: the datasets are
// one row, what they use added up, and the room left is the pool's, which each of them
// reports the same. tmpfs, overlay and a snap's loop image are not disks.
//
// Ubuntu's encrypted ZFS keeps the pool's key on a small volume of its own,
// /dev/mapper/keystore-<pool>: that pool is marked encrypted, and the volume as its key.
function disk_list_from_df(space_text, inode_text)
{
    const inodes_by_mount = {};
    for (const row of df_rows(inode_text)) {
        inodes_by_mount[row.mount] = row;
    }
    const out = [];
    const disk_by_key = {};
    for (const row of df_rows(space_text)) {
        const zfs = (row.type === 'zfs');
        const disk = zfs || (row.device.startsWith('/dev/') && (row.device.startsWith('/dev/loop') === false));
        const inodes = inodes_by_mount[row.mount];
        // A filesystem that keeps no inode count — vfat, among others — says 0
        const counted = ((inodes !== undefined) && (inodes.total > 0));
        const key = (zfs ? `zfs ${row.device.split('/')[0]}` : row.device);
        const found = (disk ? disk_by_key[key] : undefined);
        if (found !== undefined) {
            found.mounts.push(row.mount);
            if (zfs) {
                found.used += row.used*BLOCK_BYTES;
                found.free = Math.max(found.free, row.free*BLOCK_BYTES);
                found.total = found.used + found.free;
                if (counted) {
                    found.inodes_used = (found.inodes_used || 0) + inodes.used;
                    found.inodes_free = Math.max(found.inodes_free || 0, inodes.free);
                    found.inodes_total = found.inodes_used + found.inodes_free;
                }
            }
            continue;
        }
        const item = {
            device: (zfs ? row.device.split('/')[0] : row.device),
            type: row.type,
            mounts: [row.mount],
            disk,
            total: (zfs ? (row.used + row.free)*BLOCK_BYTES : row.total*BLOCK_BYTES),
            used: row.used*BLOCK_BYTES,
            free: row.free*BLOCK_BYTES,
            inodes_total: (counted ? (zfs ? inodes.used + inodes.free : inodes.total) : null),
            inodes_used: (counted ? inodes.used : null),
            inodes_free: (counted ? inodes.free : null),
            encrypted: false,
            // The pool this volume holds the key of, or null
            key_of: null,
        };
        if (disk) {
            disk_by_key[key] = item;
        }
        out.push(item);
    }
    for (const item of out) {
        const found = /^\/dev\/mapper\/keystore-(.+)$/.exec(item.device);
        const pool = ((found === null) ? undefined : disk_by_key[`zfs ${found[1]}`]);
        if (pool !== undefined) {
            pool.encrypted = true;
            item.key_of = pool.device;
        }
    }
    // A pool mounted at / is read by its root first
    for (const item of out) {
        const at = item.mounts.indexOf('/');
        if (at > 0) {
            item.mounts.splice(at, 1);
            item.mounts.unshift('/');
        }
    }
    // The disks first, then the rest, each by where it is mounted
    out.sort((a, b) => ((a.disk === b.disk) ? a.mounts[0].localeCompare(b.mounts[0]) : (a.disk ? -1 : 1)));
    return out;
}

// The lines of df as fields. With -T the type is the second column; a mount point may hold
// spaces, so it is the rest of the line.
function df_rows(text)
{
    const out = [];
    for (const line of text.split('\n').slice(1)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 7) {
            continue;
        }
        out.push({
            device: columns[0],
            type: columns[1],
            total: parseInt(columns[2], 10) || 0,
            used: parseInt(columns[3], 10) || 0,
            free: parseInt(columns[4], 10) || 0,
            mount: columns.slice(6).join(' '),
        });
    }
    return out;
}

module.exports = disk_list_from_df;
