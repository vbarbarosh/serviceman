const fs = require('fs');
const marked = require('marked');
const path = require('path');

const GITHUB_URL = 'https://github.com/vbarbarosh/serviceman';
const GROUPS = ['Docs', 'Tutorials', 'Modules'];
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// The site at vbarbarosh.github.io/serviceman, as [{path, text}] under docs/: the front page,
// and one page for every file README.md lists under Docs, Tutorials and Modules, in that
// order. The .md files stay the source; bin/build-pages writes these, tests/pages.test.js
// checks them.
function build_pages()
{
    const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
    const groups = GROUPS.map(v => readme_list(readme, v));
    const pages = groups.flat().map(function (item) {
        const markdown = fs.readFileSync(path.join(ROOT_DIR, item.md), 'utf8');
        return {...item, html_path: html_path_from_md(item.md), markdown};
    });
    const template = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
    const out = pages.map(function (page) {
        const {html, title, lede, sections} = markdown_render(page, pages);
        const text = template_fill(template, {
            title: `${title} · serviceman`,
            description: lede,
            root: root_prefix(page.html_path),
            nav: nav_html(groups, pages, page, sections),
            content: html,
            source: `${GITHUB_URL}/blob/main/${page.md}`,
            body_class: 'doc',
        });
        return {path: page.html_path, text};
    });
    const front = fs.readFileSync(path.join(__dirname, 'front.html'), 'utf8');
    out.unshift({path: 'index.html', text: template_fill(template, {
        title: 'serviceman: start a service on the first request, stop it when nobody visits',
        description: 'serviceman answers on the hostnames you give it, starts a docker image or a program at the first request, and stops it again when nobody visits.',
        root: '',
        nav: nav_html(groups, pages, null, []),
        content: template_fill(front, {docs: cards_html(groups[0], pages), tutorials: cards_html(groups[1], pages), modules: cards_html(groups[2], pages)}),
        source: GITHUB_URL,
        body_class: 'front',
    })});
    out.push({path: '.nojekyll', text: ''});
    return out;
}

// "- [Overview](docs/overview.md) — what serviceman is…" under "## <heading>", lines
// indented below an item continuing its words
function readme_list(readme, heading)
{
    const out = [];
    const lines = readme.split('\n');
    const start = lines.indexOf(`## ${heading}`);
    if (start === -1) {
        throw new Error(`README.md has no "## ${heading}"`);
    }
    for (let i = start + 1; (i < lines.length) && !lines[i].startsWith('## '); i++) {
        const match = lines[i].match(/^- \[(.+?)\]\(([^)]+\.md)\)\s*[—-]\s*(.*)$/);
        if (match) {
            out.push({label: match[1], md: match[2], about: match[3]});
        }
        else if (out.length && /^\s+\S/.test(lines[i])) {
            out[out.length - 1].about += ` ${lines[i].trim()}`;
        }
    }
    return out;
}

// docs/config.md is config.html; modules/docker/README.md is modules/docker.html
function html_path_from_md(md)
{
    if (md.startsWith('docs/')) {
        return md.slice('docs/'.length).replace(/\.md$/, '.html');
    }
    if (md.endsWith('/README.md')) {
        return `${path.posix.dirname(md)}.html`;
    }
    return md.replace(/\.md$/, '.html');
}

function markdown_render(page, pages)
{
    let title = null;
    let lede = '';
    const sections = [];
    const slugs = new Map();
    const renderer = {
        heading({tokens, depth}) {
            const inner = this.parser.parseInline(tokens);
            const slug = slug_unique(slugs, slug_from_text(html_text(inner)));
            if ((depth === 1) && (title === null)) {
                title = html_text(inner);
            }
            if (depth === 2) {
                sections.push({slug, html: inner});
            }
            return `<h${depth} id="${slug}"><a class="anchor" href="#${slug}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
        },
        paragraph({tokens}) {
            const inner = this.parser.parseInline(tokens);
            if (!lede) {
                lede = html_text(inner).replace(/\s+/g, ' ').trim();
            }
            return `<p>${inner}</p>\n`;
        },
        link({href, title: link_title, tokens}) {
            const inner = this.parser.parseInline(tokens);
            const title_attr = link_title ? ` title="${html_escape(link_title)}"` : '';
            return `<a href="${html_escape(href_resolve(href, page, pages))}"${title_attr}>${inner}</a>`;
        },
        image({href, title: image_title, text}) {
            const title_attr = image_title ? ` title="${html_escape(image_title)}"` : '';
            return `<img src="${html_escape(href_resolve(href, page, pages))}" alt="${html_escape(text)}"${title_attr}>`;
        },
        table(token) {
            return `<div class="table-wrap">${marked.Renderer.prototype.table.call(this, token)}</div>\n`;
        },
    };
    const parser = new marked.Marked({gfm: true, renderer});
    const html = parser.parse(page.markdown);
    return {html, title: title || page.md, lede, sections};
}

// A link of a doc, as the site needs it: a page of the site becomes its .html beside this
// one, README.md the front page, and any other file of the repository its page on GitHub
function href_resolve(href, page, pages)
{
    if (/^([a-z]+:|#|\/\/)/i.test(href)) {
        return href;
    }
    const [file, hash] = href.split('#');
    const repo_path = path.posix.normalize(path.posix.join(path.posix.dirname(page.md), file));
    const from = path.posix.dirname(page.html_path);
    const suffix = (hash === undefined) ? '' : `#${hash}`;
    const target = pages.find(v => v.md === repo_path);
    if (target) {
        return `${path.posix.relative(from, target.html_path) || path.posix.basename(target.html_path)}${suffix}`;
    }
    if (repo_path === 'README.md') {
        return `${root_prefix(page.html_path)}index.html${suffix}`;
    }
    if (repo_path.startsWith('..')) {
        throw new Error(`${page.md}: the link ${href} leaves the repository`);
    }
    const full = path.join(ROOT_DIR, repo_path);
    if (!fs.existsSync(full)) {
        throw new Error(`${page.md}: the link ${href} names ${repo_path}, which is not there`);
    }
    const kind = fs.statSync(full).isDirectory() ? 'tree' : 'blob';
    return `${GITHUB_URL}/${kind}/main/${repo_path.replace(/\/$/, '')}${suffix}`;
}

function nav_html(groups, pages, current, sections)
{
    const from = current ? current.html_path : 'index.html';
    return groups.map(function (group, i) {
        const items = group.map(function (item) {
            const page = pages.find(v => v.md === item.md);
            const href = path.posix.relative(path.posix.dirname(from), page.html_path);
            if (page !== current) {
                return `<li><a href="${href}">${html_escape(item.label)}</a></li>`;
            }
            const toc = sections.map(v => `<li><a href="#${v.slug}">${v.html}</a></li>`).join('');
            return `<li class="current"><a href="${href}" aria-current="page">${html_escape(item.label)}</a>${toc ? `<ul class="toc">${toc}</ul>` : ''}</li>`;
        }).join('\n');
        return `<h2>${GROUPS[i]}</h2>\n<ul>\n${items}\n</ul>`;
    }).join('\n');
}

function cards_html(group, pages)
{
    return group.map(function (item) {
        const page = pages.find(v => v.md === item.md);
        return `<a class="card" href="${page.html_path}"><strong>${html_escape(item.label)}</strong><span>${html_escape(item.about)}</span></a>`;
    }).join('\n');
}

// "../" for a page one folder down, so its links and its front page link hold
function root_prefix(html_path)
{
    return '../'.repeat(html_path.split('/').length - 1);
}

function template_fill(template, values)
{
    return template.replace(/\{\{(\w+)\}\}/g, function (all, key) {
        if (!(key in values)) {
            throw new Error(`no value for {{${key}}}`);
        }
        return values[key];
    });
}

// GitHub's anchors: lowercase, punctuation dropped, spaces to hyphens
function slug_from_text(text)
{
    return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function slug_unique(slugs, slug)
{
    const n = slugs.get(slug) || 0;
    slugs.set(slug, n + 1);
    return (n === 0) ? slug : `${slug}-${n}`;
}

function html_text(html)
{
    return html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
}

function html_escape(text)
{
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = build_pages;
