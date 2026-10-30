// How full a share reads: amber from 0.8 and red from 0.92, the way a disk that fills does
function share_level(share)
{
    if (share >= 0.92) {
        return 'full';
    }
    return (share >= 0.8) ? 'filling' : '';
}

export default share_level;
