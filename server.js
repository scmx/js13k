import JSZip from "jszip";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile, watch, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const port = Number(process.env.PORT || 8002);
const host = "0.0.0.0";

// Custom live reload after build solution
// Usage: new EventSource(...).onmessage(e => e.data === 'reload' && location.reload())
const clients = [];

const games = [];
readdirSync(".", { withFileTypes: true }).forEach((dirent) => {
  if (!dirent.isDirectory()) return;
  if (!/^\d{4}_\w+$/.test(dirent.name)) return;
  games.push(dirent.name);
  watchSource(dirent.name);
});

const server = createServer((req, res) => {
  if (req.headers["accept"] === "text/event-stream") {
    handleEventStream(req, res);
    return;
  }
  if (req.url === "/") {
    listGames(req, res);
    return;
  }
  serveGameSource(req, res);
});

/**
 * @param {Req} req
 * @param {Res} res
 */
function handleEventStream(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  clients.push(res);
  log("Client connected");

  req.on("close", () => {
    const index = clients.indexOf(res);
    if (index === -1) return;
    clients.splice(index, 1);
    log("Client disconnected");
  });
}

/**
 * @param {Req} _req
 * @param {Res} res
 */
async function listGames(_req, res) {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-cache",
  });
  res.end(
    `<ul>
  ${games.map((game) => `<li><a href="/${game}">${game}</a></li>`).join("")}
</ul>`,
    "utf-8",
  );
}

const liveReloadScript = `
    <script type="module">
      const source = new EventSource(location.origin);
      source.onmessage = (event) => {
        if (event.data === "reload") window.location.reload();
      };
    </script>
`;

/**
 * @param {Req} req
 * @param {Res} res
 */
async function serveGameSource(req, res) {
  const url = req.url;
  if (!url) throw new Error(`Error parsing url`);
  const game = url.slice(1);
  const sourceFile = `${game}.html`;
  try {
    var data = await readFile(sourceFile, { encoding: "utf-8" });
  } catch (err) {
    res.writeHead(500);
    res.end(`Error loading ${sourceFile}`);
    return;
  }
  data.replace("</body>", `${liveReloadScript}</body>`);
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-cache",
  });
  res.end(data, "utf-8");
}

mkdirSync("dist", { recursive: true });

/** @param {string} name */
async function watchSource(name) {
  log(`Watching ${name}`);
  const folderPath = `./${name}`;
  try {
    var watcher = watch(folderPath);
  } catch (err) {
    log(`Failed to watch ${folderPath}`);
    throw new Error(`Failed to watch ${folderPath}`, { cause: err });
  }
  try {
    for await (const event of watcher) {
      switch (event.eventType) {
        case "rename":
        case "change": {
          buildSourceDebounced(name);
          break;
        }
        default: {
          log(`Unhandled event ${event.eventType}`);
          break;
        }
      }
    }
  } catch (err) {
    log(`Failed to watch ${folderPath}`);
  }
}

let timeouts = new Map();
/** @param {string} name */
async function buildSourceDebounced(name) {
  clearTimeout(timeouts.get(name));
  timeouts.set(
    name,
    setTimeout(() => buildSource(name), 200),
  );
}

/** @param {string} name */
async function buildSource(name) {
  log(`Rebuilding ${name}`);
  const indexPath = resolve(`./${name}.html`);
  const zipPath = resolve(`./dist/${name}.zip`);

  clients.forEach((client) => client.write("data: reload\n\n"));

  const zip = new JSZip();
  for (const dirent of readdirSync(`./${name}`, { withFileTypes: true })) {
    if (dirent.isDirectory()) return;

    const filePath = `./${name}/${dirent.name}`;
    try {
      var data = await readFile(filePath, { encoding: "utf-8" });
    } catch (err) {
      log(`Failed to read ${filePath}`);
      throw new Error(`Failed to read ${filePath}`, { cause: err });
    }
    zip.file(dirent.name, data);
  }

  try {
    var content = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 /* 1 best speed - 9 best compression */ },
    });
  } catch (err) {
    log(`Failed to generate zip for ${indexPath}`);
    throw new Error(`Failed to generate zip for ${indexPath}`, { cause: err });
  }

  try {
    await writeFile(zipPath, content);
  } catch (err) {
    throw new Error(`Failed to write ${zipPath}`, { cause: err });
  }

  try {
    var stats = await stat(zipPath);
  } catch (err) {
    log(`Failed to stat ${zipPath}`);
    throw new Error(`Failed to stat ${zipPath}`, { cause: err });
  }

  const size = stats.size / 1024;
  log(`dist/${name}.zip ${size.toFixed(1)}kB`);
}

server.listen(port, host, onListen);

function onListen() {
  const info = server.address();
  if (info && typeof info !== "string") {
    const { address, port } = info;
    log(`Server is running on http://${address}:${port}`);
  }
}

/** @param {string} message */
function log(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`${now} ${message}`);
}
