// What a search box's text finds among the apps, the way navplace's search box finds links
// (navplace's lib/items_search.js): each word is an expression of its own, `found` the apps
// the last word matches and `tops` the first app of every word that matches any, the ones
// Enter opens. An expression is its /-separated parts, and an app matches when every part
// holds: a part holds when it is found in the app's name, in one of its words or in its
// address; with ^ or $ it is tried against each of them alone; with ! it holds only when it
// is found in none. Apps whose parts all hold without the address come first, in the order
// given. What is typed and what is searched are lowered and transliterated, so почта finds
// Pochta. No imports: the page of apps puts this file in its own <script> as it is.
//
//     apps   [{name, words: [], address}]
//     text   what the search box holds
export default function apps_search(apps, text)
{
    const rows = apps.map(function (app) {
        const names = [app.name, ...app.words].map(text_searched);
        return {app, names, fields: [...names, text_searched(app.address)]};
    });
    const tops = [];
    let found = apps.slice();
    for (const expr of text_searched(String(text)).trim().split(/\s+/).filter(Boolean)) {
        found = matches(rows, expr);
        if (found.length > 0) {
            tops.push(found[0]);
        }
    }
    return {found, tops};
}

function matches(rows, expr)
{
    const tests = expr.split('/').filter(Boolean).map(test_from_part);
    const by_name = [];
    const by_address = [];
    for (const row of rows) {
        if (tests.every(v => is_held(v, row.fields)) === false) {
            continue;
        }
        if (tests.every(v => is_held(v, row.names))) {
            by_name.push(row.app);
        }
        else {
            by_address.push(row.app);
        }
    }
    return [...by_name, ...by_address];
}

// A part without its marks, and what they ask: ^ at the start, $ at the end, an odd number of
// ! for none of it
function test_from_part(part)
{
    const text = part.replace(/[\^$!]/g, '');
    const negated = ((part.split('!').length - 1) % 2 === 1);
    const starts = part.includes('^');
    const ends = part.includes('$');
    return {text, negated, starts, ends};
}

function is_held(test, fields)
{
    return fields.some(v => is_found(test, v)) !== test.negated;
}

function is_found(test, field)
{
    if (test.starts && test.ends) {
        return field.startsWith(test.text) && field.endsWith(test.text);
    }
    if (test.starts) {
        return field.startsWith(test.text);
    }
    if (test.ends) {
        return field.endsWith(test.text);
    }
    return field.includes(test.text);
}

// Lower case, Cyrillic letters as Latin ones, as navplace searches (its lib/parse.js)
const LATIN_BY_CYRILLIC = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
    'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh',
    'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

function text_searched(text)
{
    return text.toLowerCase().split('').map(v => LATIN_BY_CYRILLIC[v] ?? v).join('');
}
