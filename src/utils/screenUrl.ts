import { auddLookupFile } from "./auddLookupFile.ts";
import { decisionFromAudD, acoustIdLookup, musicBrainzRecording, decisionFromMB } from "./copyright.ts";
import { fpcalc } from "./misc.ts";
import { tmpdir, sampleAudio } from "./yt-helpers.ts";
import fscb from 'node:fs';


type ScreeningOptions = {
  url: string;
  audToken: string;
  acoustidKey: string;
  duration: number;
};

type AudDResponse = { status?: string; result?: unknown };
type AcoustIdResponse = {
  results?: Array<{ score?: number; recordings?: Array<{ id: string }> }>;
};

export async function screenUrl({
  url,
  audToken,
  acoustidKey,
  duration,
}: ScreeningOptions) {
  const dir = tmpdir();
  try {
    const wav = await sampleAudio(url, dir, duration);
    if (audToken) {
      const audd = (await auddLookupFile(wav, audToken)) as AudDResponse | null;
      if (audd && audd.status === 'success' && audd.result) {
        const dec = decisionFromAudD(audd);
        if (dec === 'BLOCK')
          return {
            url,
            decision: 'BLOCK',
            source: 'AudD',
          };
      }
    }
    if (acoustidKey) {
      const fp = await fpcalc(wav);
      const res = (await acoustIdLookup(fp.fingerprint, fp.duration, acoustidKey)) as
        | AcoustIdResponse
        | null;
      const result = res?.results?.[0];
      const score = Number(result?.score ?? 0);
      const recording = result?.recordings?.[0];
      if (!result || score < 0.65 || !recording)
        return {
          url,
          decision: 'UNKNOWN',
          score,
        };
      const mb = await musicBrainzRecording(recording.id);
      const dec = decisionFromMB(mb);
      return {
        url,
        decision: dec,
        score,
        mbid: recording.id,
      };
    }
    return {
      url,
      decision: 'UNKNOWN',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      url,
      decision: 'UNKNOWN',
      error: message,
    };
  } finally {
    try {
      fscb.rmSync(dir, {
        recursive: true,
        force: true,
      });
    } catch {}
  }
}
