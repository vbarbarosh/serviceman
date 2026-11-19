// A time of today as the page's clock says it: 11:02
function clock_of(ms)
{
    const at = new Date(ms);
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export default clock_of;
