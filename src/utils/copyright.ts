
export async function acoustIdLookup(fp:string, dur=25, acoustidKey:string) {
    const u = new URL('https://api.acoustid.org/v2/lookup');
    u.searchParams.set('client',acoustidKey);
    u.searchParams.set('duration', String(dur));
    u.searchParams.set('fingerprint', fp);
    u.searchParams.set('meta', 'recordings+recordingids+releasegroups');
    const r = await fetch(u);
    if (!r.ok) return null;
    return r.json();
}
export async function musicBrainzRecording(mbid) {
    await new Promise(r => setTimeout(r, 1100));
    const r = await fetch(`https://musicbrainz.org/ws/2/recording/${mbid}?inc=isrcs+releases+release-groups&fmt=json`, {
        headers: {
            'User-Agent': 'ytwall-screener/1.0 (linux desktop)'
        }
    });
    if (!r.ok) return null;
    return r.json();
}

export function decisionFromMB(mb) {
    const hasISRC = Array.isArray(mb?.isrcs) && mb.isrcs.length > 0;
    const hasOfficial = Array.isArray(mb?.releases) && mb.releases.some(x => (x.status || '').toLowerCase() === 'official');
    return (hasISRC || hasOfficial) ? 'BLOCK' : 'UNKNOWN';
}

export function decisionFromAudD(j) {
    const m = j?.result;
    if (!m) return 'UNKNOWN';
    const hasISRC = !!(m.isrc || m?.apple_music?.isrc || m?.spotify?.external_ids?.isrc);
    return hasISRC ? 'BLOCK' : 'UNKNOWN';
}


