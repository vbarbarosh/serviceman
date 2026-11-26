import CHARTS_RANGES from './charts_ranges.js';
import CHARTS_RATES from './charts_rates.js';
import storage_get from './storage_get.js';

// The range and the rate a machine's charts were last picked at in this browser, the same for
// every machine: the ten minutes read every 2 seconds where it keeps none, or keeps one the page
// no longer offers. The range is kept where History kept it before it moved to the head.
//
//     ->    {range: '10m', rate: 2000}
function charts_kept()
{
    const range = storage_get('serviceman.charts_range');
    const rate = Number(storage_get('serviceman.charts_rate'));
    return {
        range: CHARTS_RANGES.some(v => v.value === range) ? range : '10m',
        rate: CHARTS_RATES.some(v => v.value === rate) ? rate : 2000,
    };
}

export default charts_kept;
