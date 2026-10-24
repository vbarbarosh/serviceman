// The install line of an app folder: bin/configure, then bin/build, as the rules have a fresh
// checkout made ready, each only when the folder holds it. The line asks the folder itself, so
// a new version that brings either one, or drops it, is set up by the same line.
const APP_SETUP_LINE = 'if [ -e bin/configure ]; then bin/configure; fi && if [ -e bin/build ]; then bin/build; fi';

export default APP_SETUP_LINE;
