#!/usr/bin / env node
// Screener: builds an allowed.m3u by excluding tracks that fingerprint as official releases.
// Usage examples:
//   ACOUSTID_KEY=xxxx node screener.mjs --yt-playlist https://youtube.com/playlist?list=XXXX --out allowed.m3u
//   ACOUSTID_KEY=xxxx node screener.mjs --m3u ~/.config/ytwall.m3u --out allowed.m3u
// Optional: AUDD_TOKEN=yyyy to use AudD for higher hit rate (falls back to AcoustID)

import {promises as fs} from 'node:fs';
import dotenv from 'dotenv';
import { listYtVideos, readM3U } from '../src/utils/yt-helpers.ts';
import { screenUrl } from '../src/utils/screenUrl.ts';
import { parseArgs } from '../src/utils/misc.ts';
dotenv.config();

const ACOUSTID_KEY = process.env.ACOUSTID_KEY || '';
const AUDD_TOKEN = process.env.AUDD_TOKEN || '';
if (!ACOUSTID_KEY && !AUDD_TOKEN) {
    console.error('Set ACOUSTID_KEY (and optionally AUDD_TOKEN)');
    process.exit(1);
}

const args = parseArgs()

const YT_PLAYLIST = args['yt-playlist'] || '';
const M3U = args['m3u'] || '';
const OUT: string = (args['out'] || 'allowed.m3u') as string;
const SAMPLE_SEC = Number(args['seconds'] || 25);
const CONCURRENCY = Number(args['concurrency'] || 3);

if (!YT_PLAYLIST && !M3U) {
    console.error('Pass --yt-playlist <url> or --m3u <file>');
    process.exit(1);
}


async function run() {
    const urls:string[] = YT_PLAYLIST  ? await listYtVideos(YT_PLAYLIST as string) : await readM3U(M3U as string);
    console.log(`Found ${urls.length} items`);
    const allowed:string[] = [];
    const blocked:string[] = [];
    let idx = 0;
    let active = 0;
    const q:string[] = [...urls];
    async function worker() {
        while (q.length) {
            const u = q.shift() as string;
            const n = ++idx;
            active++;
            process.stdout.write(`\r[${n}/${urls.length}] screening… active=${active}   `);
            const r = await screenUrl({url:u, acoustidKey:ACOUSTID_KEY, audToken:AUDD_TOKEN, duration:SAMPLE_SEC});
            if (r.decision === 'BLOCK') blocked.push(u);
            else allowed.push(u);
            active--;
        }
    }
    const workers = Array.from({
        length: Math.max(1, Math.min(CONCURRENCY, urls.length))
    }, worker);
    await Promise.all(workers);
    process.stdout.write('\n');
    await fs.writeFile(OUT, allowed.join('\n') + '\n');
    await fs.writeFile('blocked.m3u', blocked.join('\n') + '\n');
    console.log(`OK: wrote ${OUT} (allowed=${allowed.length}) and blocked.m3u (blocked=${blocked.length})`);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
