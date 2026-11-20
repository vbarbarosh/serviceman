// A part of a whole in %, or null where either is not a number: History's charts and a
// machine's head read a point's numbers with it
//
//     value     a part, as a point of History says it: 0.23 of a CPU, 2.8e9 bytes
//     total     the whole: 1 for a CPU, mem_total or disk_total in bytes
//     ->        0 to 100, or null
function share_of(value, total)
{
    if ((typeof value !== 'number') || (typeof total !== 'number') || (total <= 0)) {
        return null;
    }
    return value/total*100;
}

export default share_of;
