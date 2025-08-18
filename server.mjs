#!/home/err/.volta/bin/node
// server.mjs — static overlay server + wallpaper controller
// usage:
//   node server.mjs --playlist ~/.config/ytwall.m3u --port 3323 --volume 25 --shuffle
//   node server.mjs --url "https://www.youtube.com/playlist?list=XXXX" --port 3323
// flags: --public ./public --ytdl /usr/local/bin/yt-dlp --socket /tmp/ytwall.sock

import http from "node:http";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import net from "node:net";
import { promises as fs } from "node:fs";
import fscb from "node:fs";
import path from "node:path";
import url from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
      acc.push([k, v]);
    }
    return acc;
  }, [])
);

const PORT = Number(args.port || 3323);
const VOLUME = Number(args.volume || 50);
const SHUFFLE = args.shuffle !== "false"; // default true
const PLAYLIST = args.playlist || null;
const URL_IN = args.url || null;
const PUBLIC_DIR = path.resolve(args.public || "./public");
const YTDL = args.ytdl || "/usr/local/bin/yt-dlp";
const RUNTIME = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || process.env.UID || ''}`;
const SOCKET = args.socket || `${RUNTIME}/ytwall.sock`;

const XWINWRAP = args.xwinwrap || "xwinwrap";
const MPV = args.mpv || "mpv";

if (!PLAYLIST && !URL_IN) {
  console.error("Pass --playlist <file.m3u> or --url <YouTube URL/playlist>");
  process.exit(1);
}

let mpvSock = null;
let xwrapProc = null;
let current = { title: "", artist: "", meta: {} };
const wsClients = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function sendFile(res, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) return sendFile(res, path.join(filePath, "index.html"));
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    fscb.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.statusCode = 404; res.end("not found");
  }
}

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of wsClients) if (ws.readyState === 1) ws.send(s);
}

function mpvSend(cmd) {
  if (!mpvSock) return; mpvSock.write(JSON.stringify({ command: cmd }) + "\n");
}

function prettyTitle() {
    console.log(current);
  const mt = current.title || "";
  const t = current.meta.title || current.meta.TITLE || "";
  const a = current.artist || current.meta.artist || current.meta.ARTIST || "";
  if (a && t) return `${a} — ${t}`;
  return mt || t || "…";
}

async function connectMpvSock(retries = 60) {
    return await new Promise((resolve, reject) => {
        const attempt = () => {
            const s = net.createConnection(SOCKET, () => {
                mpvSock = s; wireMpvIPC(s); resolve();
            });
            s.on("error", () => { if (retries-- > 0) setTimeout(attempt, 250); else reject(new Error("mpv IPC connect failed")); });
        };
        attempt();
    });
}
async function tryConnectMpvSock(retries = 60) {
  if (fscb.existsSync(SOCKET)) { try { fscb.unlinkSync(SOCKET); } catch {} }
    return connectMpvSock(retries)
}

function wireMpvIPC(s) {
  let buf = "";
  let loadTimer = null;

  const armWatchdog = () => {
    clearTimeout(loadTimer);
    // if nothing fully loads in 15s, skip
    loadTimer = setTimeout(() => mpvSend(["playlist-next", "force"]), 15000);
  };

  s.on("data", (d) => {
    buf += d.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }

      // Core events for robustness
      if (j.event === "start-file") {
        armWatchdog();
      }
      if (j.event === "file-loaded") {
        clearTimeout(loadTimer);
      }
      if (j.event === "end-file") {
        // reason can be "eof", "error", "redirect", "stop", "quit"
        if (j.reason === "error") {
          // hop to next and keep rolling
          mpvSend(["playlist-next", "force"]);
        }
      }

      // Your existing metadata updates
      if (j.event === "property-change") {
        if (j.name === "media-title") {
          current.title = j.data || "";
          broadcast({ type: "track", title: prettyTitle() });
        }
        if (j.name === "metadata") {
          current.meta = j.data || {};
          current.artist = current.meta.artist || current.meta.ARTIST || "";
          broadcast({ type: "track", title: prettyTitle() });
        }
      }
    }
  });

  s.on("close", () => {
    mpvSock = null;
    console.warn("mpv IPC closed; attempting reconnect…");
    connectMpvSock().catch(() => {/* will retry on next loop */});
  });
  mpvSend(["observe_property", 1, "media-title"]);
  mpvSend(["observe_property", 2, "metadata"]);
  mpvSend(["get_property", "media-title"]);
  mpvSend(["get_property", "metadata"]);
}

function startWallpaper() {
    // ensure runtime dir + cleanup stale socket
    try { if (RUNTIME) fscb.mkdirSync(RUNTIME, { recursive: true }); } catch {}
    try { if (fscb.existsSync(SOCKET)) fscb.unlinkSync(SOCKET); } catch {}

    const mpvArgs = [
        "-wid", "WID",
        `--input-ipc-server=${SOCKET}`,
        `--volume=${VOLUME}`,
        "--idle=yes",
        "--loop-playlist=inf",
        ...(SHUFFLE ? ["--shuffle"] : []),
        "--no-osc", "--no-osd-bar",
        "--force-window",
        "--hwdec=auto-copy",

        // yt-dlp hook (stays latest & plays nicer with YT)
        `--script-opts=ytdl_hook-ytdl_path=${YTDL}`,
        // (boolean raw-option: empty value is "set")
        "--ytdl-raw-options=force-ipv4=,extractor-args=youtube:player_client=android",

        // Prefer sane formats and avoid odd containers
        "--ytdl-format=bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=1080][ext=mp4]/best",

        // Reconnect on flaky HTTP / token hiccups
        "--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=10",

        // Give buffering a little headroom
        "--cache=yes", "--cache-secs=90", "--demuxer-max-bytes=200MiB", "--demuxer-readahead-secs=30",

        "--log-file=/tmp/mpv-wall.log",
    ];
    if (PLAYLIST) mpvArgs.push(`--playlist=${PLAYLIST}`); else mpvArgs.push(URL_IN);
    const xArgs = ["-b","-s","-fs","-st","-sp","-nf","-ov","-fdt","--", MPV, ...mpvArgs];
    xwrapProc = spawn(XWINWRAP, xArgs, { stdio: "ignore" });
    xwrapProc.on("exit", (code, sig) => { console.log("xwinwrap exited", code, sig); process.exit(0); });

    setTimeout(() => { connectMpvSock().catch(e => console.error(e)); }, 400);
    // wait for socket to appear, then connect (robust vs. timing)
    const start = Date.now();
    const poll = setInterval(() => {
        if (fscb.existsSync(SOCKET)) {
            clearInterval(poll);
            connectMpvSock().catch(e => console.error(e));
        } else if (Date.now() - start > 15000) {
            clearInterval(poll);
            console.error("mpv IPC socket never appeared:", SOCKET);
        }
    }, 200);
}

// HTTP server (static + tiny API)
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === "/health") { res.setHeader("Content-Type","application/json"); res.end(JSON.stringify({ ok: true, title: prettyTitle() })); return; }
  if (u.pathname === "/api/title") { res.setHeader("Content-Type","application/json"); res.end(JSON.stringify({ title: prettyTitle(), meta: current.meta })); return; }
  if (u.pathname === "/api/next") { mpvSend(["playlist-next","weak"]); res.end("ok"); return; }
  if (u.pathname === "/api/prev") { mpvSend(["playlist-prev","weak"]); res.end("ok"); return; }
  if (u.pathname === "/api/pause") { mpvSend(["cycle","pause"]); res.end("ok"); return; }
  if (u.pathname === "/api/vol") { const d = Number(u.query.delta || 5); mpvSend(["add","volume", d]); res.end("ok"); return; }

  // static files
  let safe = path.normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, "");
  if (!safe) safe = "index.html";
  const filePath = path.join(PUBLIC_DIR, safe);
  await sendFile(res, filePath);

});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: "track", title: prettyTitle() }));
});

server.listen(PORT, async () => {
  console.log(`overlay http://localhost:${PORT}/  | WS /ws | static ${PUBLIC_DIR}`);

  startWallpaper();
});

process.on("SIGINT", () => { try { mpvSock?.end(); } catch {}; try { xwrapProc?.kill("SIGTERM"); } catch {}; try { fscb.unlinkSync(SOCKET); } catch {}; process.exit(0); });
process.on("SIGTERM", () => { try { mpvSock?.end(); } catch {}; try { xwrapProc?.kill("SIGTERM"); } catch {}; try { fscb.unlinkSync(SOCKET); } catch {}; process.exit(0); });
