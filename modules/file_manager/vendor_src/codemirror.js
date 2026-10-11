// What the File Manager takes from CodeMirror, as one module: the host bundles this file into
// one file it maps as `codemirror`, and the page loads it the first time a file is opened
import {Compartment, EditorState} from '@codemirror/state';
import {EditorView, keymap} from '@codemirror/view';
import {StreamLanguage, defaultHighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {basicSetup} from 'codemirror';
import {css} from '@codemirror/lang-css';
import {diff} from '@codemirror/legacy-modes/mode/diff';
import {dockerFile} from '@codemirror/legacy-modes/mode/dockerfile';
import {go} from '@codemirror/legacy-modes/mode/go';
import {html} from '@codemirror/lang-html';
import {indentWithTab} from '@codemirror/commands';
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {lua} from '@codemirror/legacy-modes/mode/lua';
import {markdown} from '@codemirror/lang-markdown';
import {nginx} from '@codemirror/legacy-modes/mode/nginx';
import {oneDarkHighlightStyle} from '@codemirror/theme-one-dark';
import {perl} from '@codemirror/legacy-modes/mode/perl';
import {php} from '@codemirror/lang-php';
import {properties} from '@codemirror/legacy-modes/mode/properties';
import {python} from '@codemirror/lang-python';
import {ruby} from '@codemirror/legacy-modes/mode/ruby';
import {rust} from '@codemirror/legacy-modes/mode/rust';
import {shell} from '@codemirror/legacy-modes/mode/shell';
import {sql} from '@codemirror/lang-sql';
import {toml} from '@codemirror/legacy-modes/mode/toml';
import {xml} from '@codemirror/lang-xml';
import {yaml} from '@codemirror/lang-yaml';

// A language by the name the page asks for it by; each a function, so only the one a file
// needs is made
const languages = {
    css: () => css(),
    diff: () => StreamLanguage.define(diff),
    dockerfile: () => StreamLanguage.define(dockerFile),
    go: () => StreamLanguage.define(go),
    html: () => html(),
    javascript: () => javascript(),
    json: () => json(),
    jsx: () => javascript({jsx: true}),
    lua: () => StreamLanguage.define(lua),
    markdown: () => markdown(),
    nginx: () => StreamLanguage.define(nginx),
    perl: () => StreamLanguage.define(perl),
    php: () => php(),
    properties: () => StreamLanguage.define(properties),
    python: () => python(),
    ruby: () => StreamLanguage.define(ruby),
    rust: () => StreamLanguage.define(rust),
    shell: () => StreamLanguage.define(shell),
    sql: () => sql(),
    toml: () => StreamLanguage.define(toml),
    tsx: () => javascript({jsx: true, typescript: true}),
    typescript: () => javascript({typescript: true}),
    xml: () => xml(),
    yaml: () => yaml(),
};

const codemirror = {
    Compartment,
    EditorState,
    EditorView,
    basicSetup,
    defaultHighlightStyle,
    indentWithTab,
    keymap,
    languages,
    oneDarkHighlightStyle,
    syntaxHighlighting,
};

export default codemirror;
