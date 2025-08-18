#!/usr/bin / env node
// Screener: builds an allowed.m3u by excluding tracks that fingerprint as official releases.
// Usage examples:
//   ACOUSTID_KEY=xxxx node screener.mjs --yt-playlist https://youtube.com/playlist?list=XXXX --out allowed.m3u
//   ACOUSTID_KEY=xxxx node screener.mjs --m3u ~/.config/ytwall.m3u --out allowed.m3u
// Optional: AUDD_TOKEN=yyyy to use AudD for higher hit rate (falls back to AcoustID)

import {
    spawn
} from 'node:child_process';
import {
    promises as fs
} from 'node:fs';
import fscb from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

const ACOUSTID_KEY = process.env.ACOUSTID_KEY || '';
const AUDD_TOKEN = process.env.AUDD_TOKEN || '';
if (!ACOUSTID_KEY && !AUDD_TOKEN) {
    console.error('Set ACOUSTID_KEY (and optionally AUDD_TOKEN)');
    process.exit(1);
}

const args = Object.fromEntries(
    process.argv.slice(2).reduce((a, v, i, arr) => {
        if (v.startsWith('--')) {
            const k = v.slice(2);
            const val = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
            a.push([k, val]);
        }
        return a;
    }, [])
);

const YT_PLAYLIST = args['yt-playlist'] || '';
const M3U = args['m3u'] || '';
const OUT = args['out'] || 'allowed.m3u';
const SAMPLE_SEC = Number(args['seconds'] || 25);
const CONCURRENCY = Number(args['concurrency'] || 3);

if (!YT_PLAYLIST && !M3U) {
    console.error('Pass --yt-playlist <url> or --m3u <file>');
    process.exit(1);
}

function sh(cmd, argv, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, argv, {
            stdio: ['ignore', 'pipe', 'pipe'],
            ...opts
        });
        let out = '';
        let err = '';
        p.stdout.on('data', d => out += d.toString());
        p.stderr.on('data', d => err += d.toString());
        p.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || ('nonzero ' + cmd))));
    });
}

async function listYtVideos(playlistUrl) {
    const j = await sh('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', playlistUrl]);
    const data = JSON.parse(j);
    const entries = data.entries || [];
    return entries.map(e => e.url?.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id||e.url}`).filter(Boolean);
}
async function readM3U(file) {
    const t = await fs.readFile(file, 'utf8');
    return t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

function tmpdir() {
    const d = path.join(os.tmpdir(), 'ytwall_screener_' + Date.now());
    fscb.mkdirSync(d, {
        recursive: true
    });
    return d;
}

async function sampleAudio(url, dir) {
    const out = path.join(dir, '%(id)s.%(ext)s');
    const args = ['-f', 'bestaudio/best', '--no-playlist', '--no-warnings', '-N', '4', '--extract-audio', '--audio-format', 'wav', '--download-sections', `*0-00:${String(SAMPLE_SEC).padStart(2,'0')}`, '-o', out, url];
    await sh('yt-dlp', args);
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.wav'));
    if (!files.length) throw new Error('no wav produced');
    return path.join(dir, files[0]);
}
async function fpcalc(file) {
    const out = await sh('fpcalc', ['-json', file]);
    const j = JSON.parse(out);
    return {
        duration: j.duration,
        fingerprint: j.fingerprint
    };
}
async function acoustIdLookup(fp, dur) {
    const u = new URL('https://api.acoustid.org/v2/lookup');
    u.searchParams.set('client', ACOUSTID_KEY);
    u.searchParams.set('duration', String(dur));
    u.searchParams.set('fingerprint', fp);
    u.searchParams.set('meta', 'recordings+recordingids+releasegroups');
    const r = await fetch(u);
    if (!r.ok) return null;
    return r.json();
}
async function musicBrainzRecording(mbid) {
    await new Promise(r => setTimeout(r, 1100));
    const r = await fetch(`https://musicbrainz.org/ws/2/recording/${mbid}?inc=isrcs+releases+release-groups&fmt=json`, {
        headers: {
            'User-Agent': 'ytwall-screener/1.0 (linux desktop)'
        }
    });
    if (!r.ok) return null;
    return r.json();
}

function decisionFromMB(mb) {
    const hasISRC = Array.isArray(mb?.isrcs) && mb.isrcs.length > 0;
    const hasOfficial = Array.isArray(mb?.releases) && mb.releases.some(x => (x.status || '').toLowerCase() === 'official');
    return (hasISRC || hasOfficial) ? 'BLOCK' : 'UNKNOWN';
}

async function auddLookupFile(file) {
    if (!AUDD_TOKEN) return null;
    const fd = new FormData();
    fd.append('api_token', AUDD_TOKEN);
    fd.append('return', 'apple_music,spotify,deezer');
    fd.append('file', new Blob([await fs.readFile(file)]), path.basename(file));
    const r = await fetch('https://api.audd.io/', {
        method: 'POST',
        body: fd
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j;
}

function decisionFromAudD(j) {
    const m = j?.result;
    if (!m) return 'UNKNOWN';
    const hasISRC = !!(m.isrc || m?.apple_music?.isrc || m?.spotify?.external_ids?.isrc);
    return hasISRC ? 'BLOCK' : 'UNKNOWN';
}

async function screenUrl(url) {
    const dir = tmpdir();
    try {
        const wav = await sampleAudio(url, dir);
        if (AUDD_TOKEN) {
            const audd = await auddLookupFile(wav);
            if (audd && audd.status === 'success' && audd.result) {
                const dec = decisionFromAudD(audd);
                if (dec === 'BLOCK') return {
                    url,
                    decision: 'BLOCK',
                    source: 'AudD'
                };
            }
        }
        if (ACOUSTID_KEY) {
            const fp = await fpcalc(wav);
            const res = await acoustIdLookup(fp.fingerprint, fp.duration);
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

async function run() {
    const urls = YT_PLAYLIST ? await listYtVideos(YT_PLAYLIST) : await readM3U(M3U);
    console.log(`Found ${urls.length} items`);
    const allowed = [];
    const blocked = [];
    let idx = 0;
    let active = 0;
    const q = [...urls];
    async function worker() {
        while (q.length) {
            const u = q.shift();
            const n = ++idx;
            active++;
            process.stdout.write(`\r[${n}/${urls.length}] screening… active=${active}   `);
            const r = await screenUrl(u);
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
