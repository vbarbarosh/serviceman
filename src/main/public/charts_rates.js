// How often a machine's ten minutes are read again, in ms: the ranges of an hour and longer are
// read every half minute whatever is picked here (CHARTS_EVERY_MS in serviceman.js says why)
const CHARTS_RATES = [
    {value: 1000, label: '1s', said: 'every second'},
    {value: 2000, label: '2s', said: 'every 2 seconds'},
    {value: 5000, label: '5s', said: 'every 5 seconds'},
];

export default CHARTS_RATES;
