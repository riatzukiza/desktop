import fscb from 'node:fs';
import path from 'node:path';
import { sh } from "./misc.ts"
import {promises as fs} from 'node:fs';
import os from 'node:os';


export type PlaylistEntry = {
    url:string;
    id: string;
}
export async function listYtVideos(playlistUrl:string) {
    const j:string = await sh('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', playlistUrl]) as string;
    const data = JSON.parse(j);
    const entries = data.entries || [];
    return entries.map((e: PlaylistEntry) => e.url?.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id || e.url}`)
        .filter(Boolean);
}
export async function readM3U(file: string) {
    const t = await fs.readFile(file, 'utf8');
    return t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

export function tmpdir() {
    const d = path.join(os.tmpdir(), 'ytwall_screener_' + Date.now());
    fscb.mkdirSync(d, {
        recursive: true
    });
    return d;
}

export async function sampleAudio(url:string, dir:string, sampleSeconds:number = 25) {
    const out = path.join(dir, '%(id)s.%(ext)s');
    const args = ['-f', 'bestaudio/best',
                  '--no-playlist',
                  '--no-warnings',
                  '-N', '4',
                  '--extract-audio',
                  '--audio-format', 'wav',
                  '--download-sections', `*0-00:${String(sampleSeconds).padStart(2,'0')}`,
                  '-o', out, url];
    await sh('yt-dlp', args);
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.wav'));
    if (!files.length) throw new Error('no wav produced');
    return path.join(dir, files[0]);
}
