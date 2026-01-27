
export async function acoustIdLookup(
  fp: string,
  dur: number = 25,
  acoustidKey: string,
): Promise<unknown | null> {
    const u = new URL('https://api.acoustid.org/v2/lookup');
    u.searchParams.set('client',acoustidKey);
    u.searchParams.set('duration', String(dur));
    u.searchParams.set('fingerprint', fp);
    u.searchParams.set('meta', 'recordings+recordingids+releasegroups');
    const r = await fetch(u);
    if (!r.ok) return null;
    return (await r.json()) as unknown;
}
export async function musicBrainzRecording(mbid: string): Promise<unknown | null> {
    await new Promise(r => setTimeout(r, 1100));
    const r = await fetch(`https://musicbrainz.org/ws/2/recording/${mbid}?inc=isrcs+releases+release-groups&fmt=json`, {
        headers: {
            'User-Agent': 'ytwall-screener/1.0 (linux desktop)'
        }
    });
    if (!r.ok) return null;
    return (await r.json()) as unknown;
}

type MBRecording = {
  isrcs?: string[];
  releases?: Array<{ status?: string }>;
};

export function decisionFromMB(mb: unknown): 'BLOCK' | 'UNKNOWN' {
  const record = mb as MBRecording | null;
  const hasISRC = Array.isArray(record?.isrcs) && record.isrcs.length > 0;
  const hasOfficial =
    Array.isArray(record?.releases) &&
    record.releases.some((x) => (x.status ?? '').toLowerCase() === 'official');
  return hasISRC || hasOfficial ? 'BLOCK' : 'UNKNOWN';
}

type AudDResult = {
  result?: {
    isrc?: string;
    apple_music?: { isrc?: string };
    spotify?: { external_ids?: { isrc?: string } };
  };
};

export function decisionFromAudD(j: unknown): 'BLOCK' | 'UNKNOWN' {
  const record = j as AudDResult | null;
  const m = record?.result;
  if (!m) return 'UNKNOWN';
  const hasISRC = Boolean(m.isrc || m.apple_music?.isrc || m.spotify?.external_ids?.isrc);
  return hasISRC ? 'BLOCK' : 'UNKNOWN';
}

