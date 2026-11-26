// The ranges a machine's charts cover, as its agent names them, and how a title says each one:
// "CPU, the last ten minutes". The ten minutes are servermon's line a second, from agent 1.32
// (metrics_live); the rest are the agent's half-minute lines and their five-minute averages.
const CHARTS_RANGES = [
    {value: '10m', label: '10m', said: 'ten minutes'},
    {value: '1h', label: '1h', said: 'hour'},
    {value: '24h', label: '24h', said: '24 hours'},
    {value: '7d', label: '7d', said: '7 days'},
    {value: '30d', label: '30d', said: '30 days'},
];

export default CHARTS_RANGES;
