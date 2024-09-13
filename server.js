import JSZip from "jszip";
import { mkdirSync, readdirSync } from "node:fs";
import { readFile, watch, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { minify } from "html-minifier-terser";

const port = process.env.PORT || 8002;
const host = "0.0.0.0";

// Custom live reload after build solution
// Usage: new EventSource(...).onmessage(e => e.data === 'reload' && location.reload())
const clients = [];

const games = [];
readdirSync(".", { withFileTypes: true }).forEach((dirent) => {
  if (dirent.isDirectory()) return;
  if (!dirent.name.endsWith(".html")) return;
  const name = dirent.name.replace(".html", "");
  games.push(name);
  watchSource(name);
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

async function serveGameSource(req, res) {
  const game = req.url.slice(1);
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

async function watchSource(name) {
  log(`Watching ${name}`);
  const indexPath = resolve(`${name}.html`);
  try {
    var watcher = watch(indexPath);
  } catch (err) {
    log(`Failed to watch ${indexPath}`);
    throw new Error(`Failed to watch ${indexPath}`, { cause: err });
  }
  try {
    for await (const event of watcher) {
      switch (event.eventType) {
        case "rename":
        case "change": {
          log(`Rebuilding ${indexPath}`);
          await buildSource(name);
          break;
        }
        default: {
          log(`Unhandled event ${event.eventType}`);
          break;
        }
      }
    }
  } catch (err) {
    log(`Failed to watch ${indexPath}`);
  }
}

async function buildSource(name) {
  const indexPath = resolve(`./${name}.html`);
  const zipPath = resolve(`./dist/${name}.zip`);

  try {
    var data = await readFile(indexPath, { encoding: "utf-8" });
  } catch (err) {
    log(`Failed to read ${indexPath}`);
    throw new Error(`Failed to read ${indexPath}`, { cause: err });
  }

  clients.forEach((client) => client.write("data: reload\n\n"));

  try {
    var minified = await minifyHtml(data);
  } catch (err) {
    log(`Failed to minify ${indexPath}`);
    throw new Error("Failed to minify index.html", { cause: err });
  }

  const zip = new JSZip();
  zip.file("index.html", minified);
  try {
    var content = await zip.generateAsync({ type: "nodebuffer" });
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
  log(`dist.zip ${size.toFixed(1)}kB`);
}

async function minifyHtml(data) {
  return await minify(data, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
  });
}

server.listen(port, host, onListen);

function onListen() {
  const { address, port } = server.address();
  log(`Server is running on http://${address}:${port}`);
}

function log(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`${now} ${message}`);
}
