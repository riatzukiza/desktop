import { auddLookupFile } from "./auddLookupFile.ts";
import { decisionFromAudD, acoustIdLookup, musicBrainzRecording, decisionFromMB } from "./copyright.ts";
import { fpcalc } from "./misc.ts";
import { tmpdir, sampleAudio } from "./yt-helpers.ts";
import fscb from 'node:fs';


type ScreeningOptions = {
    url:string;
    audToken: string;
    acoustidKey:string;
    duration:number;
}

export async function screenUrl({url, audToken,acoustidKey, duration  }:ScreeningOptions) {
    const dir = tmpdir();
    try {
        const wav = await sampleAudio(url, dir,duration);
        if (audToken) {
            const audd = await auddLookupFile(wav, audToken );
            if (audd && audd.status === 'success' && audd.result) {
                const dec = decisionFromAudD(audd);
                if (dec === 'BLOCK') return {
                    url,
                    decision: 'BLOCK',
                    source: 'AudD'
                };
            }
        }
        if (acoustidKey) {
            const fp = await fpcalc(wav);
            const res = await acoustIdLookup(fp.fingerprint, fp.duration, acoustidKey);
            const result = res?.results?.[0];
            const score = Number(result?.score || 0);
            if (!result || score < 0.65 || !result.recordings?.length) return {
                url,
                decision: 'UNKNOWN',
                score
            };
            const rec = result.recordings[0];
            const mb = await musicBrainzRecording(rec.id);
            const dec = decisionFromMB(mb);
            return {
                url,
                decision: dec,
                score,
                mbid: rec.id
            };
        }
        return {
            url,
            decision: 'UNKNOWN'
        };
    } catch (e) {
        return {
            url,
            decision: 'UNKNOWN',
            error: e.message
        };
    } finally {
        try {
            fscb.rmSync(dir, {
                recursive: true,
                force: true
            });
        } catch {}
    }
}
