import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const host = process.env.LOCAL_SHARE_HOST || "127.0.0.1";
const port = Number(process.env.LOCAL_SHARE_PORT || 8787);
const rootDir = join(process.cwd(), "tmp", "local-workshop");
const actionTypes = new Set(["focus", "music", "merit"]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "")
    .substring(0, 48);
  return cleaned || fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeItems(body) {
  if (Array.isArray(body?.items)) return body.items;
  return [{
    petId: body?.petId,
    actionType: body?.actionType,
    title: body?.title,
    author: body?.author,
    promptUsed: body?.promptUsed,
    framesCount: body?.framesCount,
    frameDuration: body?.frameDuration,
    imageBufferBase64: body?.imageBufferBase64,
  }];
}

function shouldPublishToWorkshop(body) {
  return body?.publishToWorkshop !== false;
}

function validateItem(item, index) {
  const petId = sanitizePathSegment(item.petId, "");
  const actionType = String(item.actionType || "");
  const title = String(item.title || "").trim();
  const author = sanitizePathSegment(item.author || "local", "local");
  const promptUsed = String(item.promptUsed || "");
  const framesCount = Number(item.framesCount);
  const frameDuration = Number(item.frameDuration || 120);
  const imageBufferBase64 = String(item.imageBufferBase64 || "").trim();

  if (!petId) throw new Error(`Item ${index + 1}: invalid petId`);
  if (!actionTypes.has(actionType)) throw new Error(`Item ${index + 1}: invalid actionType`);
  if (!title) throw new Error(`Item ${index + 1}: title is required`);
  if (![4, 8].includes(framesCount)) throw new Error(`Item ${index + 1}: framesCount must be 4 or 8`);
  if (!Number.isFinite(frameDuration) || frameDuration <= 0 || frameDuration > 2000) {
    throw new Error(`Item ${index + 1}: invalid frameDuration`);
  }
  if (!imageBufferBase64) throw new Error(`Item ${index + 1}: imageBufferBase64 is required`);

  return { petId, actionType, title, author, promptUsed, framesCount, frameDuration, imageBufferBase64 };
}

async function handleShare(req, res) {
  try {
    const rawBody = await readBody(req);
    const body = JSON.parse(rawBody || "{}");
    const items = normalizeItems(body);
    const publishToWorkshop = shouldPublishToWorkshop(body);
    if (items.length === 0 || items.length > 50) {
      return sendJson(res, 400, { error: "items must contain 1-50 entries" });
    }

    const timestamp = Date.now();
    const createdTime = new Date(timestamp).toISOString();
    const publishedItems = [];
    const manifestId = `${timestamp}_${Math.random().toString(36).slice(2, 10)}`;

    for (let i = 0; i < items.length; i++) {
      const item = validateItem(items[i], i);
      const prefix = `${item.author}_${timestamp}_${String(i + 1).padStart(2, "0")}`;
      const imagePath = publishToWorkshop
        ? `patches/${item.petId}/${item.actionType}/${prefix}.webp`
        : `handoffs/${manifestId}/${prefix}.webp`;
      const metaPath = publishToWorkshop ? `patches/${item.petId}/${item.actionType}/${prefix}.json` : "";
      const imageUrl = `http://${host}:${port}/${imagePath}`;
      const metadata = {
        title: item.title,
        author: item.author,
        petId: item.petId,
        actionType: item.actionType,
        status: publishToWorkshop ? "published" : "import-only",
        framesCount: item.framesCount,
        frameDuration: item.frameDuration,
        promptUsed: item.promptUsed,
        imageUrl,
        createdTime,
        metaPath,
      };

      await mkdir(join(rootDir, publishToWorkshop ? join("patches", item.petId, item.actionType) : join("handoffs", manifestId)), { recursive: true });
      await writeFile(join(rootDir, imagePath), Buffer.from(item.imageBufferBase64, "base64"));
      if (publishToWorkshop) {
        await writeFile(join(rootDir, metaPath), JSON.stringify(metadata, null, 2));
      }
      publishedItems.push(metadata);
    }

    const manifestPath = `handoffs/${manifestId}.json`;
    await mkdir(join(rootDir, "handoffs"), { recursive: true });
    await writeFile(join(rootDir, manifestPath), JSON.stringify({
      schemaVersion: 1,
      createdTime,
      items: publishedItems,
    }, null, 2));

    const importManifestUrl = `http://${host}:${port}/${manifestPath}`;
    return sendJson(res, 200, {
      success: true,
      items: publishedItems,
      importManifestUrl,
      openAppUrl: `lingopet://import-actions?url=${encodeURIComponent(importManifestUrl)}`,
    });
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const relPath = normalize(decodeURIComponent(url.pathname).replace(/^[/\\]+/, ""));
  if (!relPath.startsWith("patches") && !relPath.startsWith("handoffs")) {
    return sendJson(res, 404, { error: "Not Found" });
  }
  try {
    const file = await readFile(join(rootDir, relPath));
    const ext = extname(relPath);
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": ext === ".json" ? "application/json; charset=utf-8" : "image/webp",
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not Found" });
  }
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (req.method === "POST" && req.url?.startsWith("/api/share")) return void handleShare(req, res);
  if (req.method === "GET") return void serveStatic(req, res);
  sendJson(res, 405, { error: "Method Not Allowed" });
});

server.on("error", (error) => {
  console.error("Local share API failed:", error);
  process.exitCode = 1;
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught local share API error:", error);
  process.exit(1);
});

process.on("exit", (code) => {
  console.error(`Local share API exited with code ${code}`);
});

server.listen(port, host, () => {
  console.log(`Local LingoPet share API: http://${host}:${port}/api/share`);
});
