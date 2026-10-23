// The field a group's own row keeps the group in: no item of a module has it
const GROUP = '__group';

// A module's items as the rows of its table, the way its manifest's kind says they stand: a
// tree by the field that names each one's parent ({id, parent}), a tree of groups by the field
// they stand together by (group: a row of its own for each, its items under it, an item of none
// a root), or a plain list; narrowed to what was typed and sorted by a column when one is asked
// for.
//
//     state = {query, sort, closed}
//     query    words typed: every one is in the kind's search fields, or the item is left out
//     sort     {key, down} for a plain list in that column's order, or null for the tree
//     closed   the keys of the branches folded
//
// Each row is {item, key, depth, children, hidden, dim, group}: `children` how many it holds
// right under it, `hidden` how many a folded one keeps out of the list, all the way down, `dim`
// for a row shown only to keep a match in its place in the tree, and `group` the value a group's
// own row stands for, null on an item's row; a group's row has an item of its own, holding
// nothing but its group.
function items_rows(items, kind, state)
{
    const words = String(state.query || '').toLowerCase().split(/\s+/).filter(v => (v !== ''));
    const matched = (words.length === 0) ? null : new Set(items.filter(v => item_matches(v, kind, words)));
    const tree = ((kind.tree === undefined) || (kind.tree === null)) ? null : kind.tree;
    const group = ((kind.group === undefined) || (kind.group === null)) ? null : kind.group;
    if (((tree === null) && (group === null)) || ((state.sort !== null) && (state.sort !== undefined))) {
        const listed = ((matched === null) ? items : items.filter(v => matched.has(v))).slice();
        if ((state.sort !== null) && (state.sort !== undefined)) {
            listed.sort(items_order(state.sort));
        }
        return listed.map(v => ({item: v, key: key_of(kind, v), depth: 0, children: 0, hidden: 0, dim: false, group: null}));
    }
    const links = (tree === null) ? group_links(items, group) : tree_links(items, tree);
    if (matched === null) {
        const closed = (state.closed === undefined) ? {} : state.closed;
        const out = [];
        for (const item of links.roots) {
            tree_walk(out, kind, links.kids, closed, item, 0);
        }
        return out;
    }
    // A match keeps every item above it, so it stands where it is in the tree; nothing folds
    const kept = new Set();
    for (const item of matched) {
        let at = item;
        while ((at !== undefined) && (kept.has(at) === false)) {
            kept.add(at);
            at = links.parent.get(at);
        }
    }
    const rows = [];
    for (const item of links.roots) {
        if (kept.has(item)) {
            tree_walk(rows, kind, links.kids, {}, item, 0, kept);
        }
    }
    return rows.map(v => Object.assign(v, {dim: ((v.group === null) && (matched.has(v.item) === false))}));
}

// What names an item: the kind's key, a field or several (a device mounted twice is two disks),
// or the whole item when the kind has none
function key_of(kind, item)
{
    if (item[GROUP] !== undefined) {
        return `group ${item[GROUP]}`;
    }
    if ((kind.key === undefined) || (kind.key === null)) {
        return JSON.stringify(item);
    }
    return [].concat(kind.key).map(v => String(item[v])).join(' ');
}

// Whether every word typed is in one of the fields the kind is searched by
function item_matches(item, kind, words)
{
    const fields = Array.isArray(kind.search) ? kind.search : [].concat(kind.key);
    const text = fields.map(v => (((item[v] === undefined) || (item[v] === null)) ? '' : String(item[v]))).join(' ').toLowerCase();
    return words.every(v => text.includes(v));
}

// The order of a column: numbers by their value, the rest as words; empty ones last either way
function items_order(sort)
{
    const key = sort.key;
    const sign = sort.down ? -1 : 1;
    return function (a, b) {
        const x = a[key];
        const y = b[key];
        const x_none = ((x === null) || (x === undefined));
        const y_none = ((y === null) || (y === undefined));
        if (x_none || y_none) {
            return (x_none === y_none) ? 0 : (x_none ? 1 : -1);
        }
        if ((typeof x === 'number') && (typeof y === 'number')) {
            return sign*(x - y);
        }
        return sign*String(x).localeCompare(String(y));
    };
}

// Who is under whom. An item whose parent is not in the list stands as a root of its own, and
// the items keep the order they came in under each parent.
function tree_links(items, tree)
{
    const by_id = new Map();
    for (const item of items) {
        by_id.set(item[tree.id], item);
    }
    const parent = new Map();
    const kids = new Map();
    const roots = [];
    for (const item of items) {
        const found = by_id.get(item[tree.parent]);
        if ((found === undefined) || (found === item)) {
            roots.push(item);
            continue;
        }
        parent.set(item, found);
        if (kids.has(found) === false) {
            kids.set(found, []);
        }
        kids.get(found).push(item);
    }
    return {roots, parent, kids};
}

// Groups as the parents of their items: a group's row comes where its first item would, and an
// item of no group stands as a root where it is
function group_links(items, field)
{
    const parent = new Map();
    const kids = new Map();
    const roots = [];
    const groups = new Map();
    for (const item of items) {
        const value = item[field];
        if ((value === null) || (value === undefined)) {
            roots.push(item);
            continue;
        }
        if (groups.has(value) === false) {
            const head = {[GROUP]: value};
            groups.set(value, head);
            kids.set(head, []);
            roots.push(head);
        }
        parent.set(item, groups.get(value));
        kids.get(groups.get(value)).push(item);
    }
    return {roots, parent, kids};
}

// The value a group's row stands for, null for an item's
function group_of(item)
{
    return (item[GROUP] === undefined) ? null : item[GROUP];
}

// One item and what is under it, as rows. A folded one keeps what is under it out of the list
// and says how many — a folded row that hides its count looks like a leaf.
function tree_walk(rows, kind, kids, closed, item, depth, kept)
{
    const all = kids.has(item) ? kids.get(item) : [];
    const children = (kept === undefined) ? all : all.filter(v => kept.has(v));
    const key = key_of(kind, item);
    if (closed[key] === true) {
        rows.push({item, key, depth, children: children.length, hidden: tree_count(kids, item), dim: false, group: group_of(item)});
        return;
    }
    rows.push({item, key, depth, children: children.length, hidden: 0, dim: false, group: group_of(item)});
    for (const kid of children) {
        tree_walk(rows, kind, kids, closed, kid, depth + 1, kept);
    }
}

// How many items are under this one, all the way down
function tree_count(kids, item)
{
    const children = kids.has(item) ? kids.get(item) : [];
    let out = children.length;
    for (const kid of children) {
        out += tree_count(kids, kid);
    }
    return out;
}

export default items_rows;
