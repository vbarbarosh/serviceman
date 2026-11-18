// A variable name no other row of the Data tab fills: the one wanted, or else the same with the
// first free number after it, DATABASE_URL_2, DATABASE_URL_3
function app_data_env_free(taken, wanted)
{
    if (taken.includes(wanted) === false) {
        return wanted;
    }
    for (let i = 2; ; i++) {
        if (taken.includes(`${wanted}_${i}`) === false) {
            return `${wanted}_${i}`;
        }
    }
}

export default app_data_env_free;
