/**
 * VibePet Git-Based 社区创意工坊 - 客户端上传代理云函数
 * 
 * 部署指引：
 * 1. 部署到 Vercel 项目的 api/share.ts
 * 2. 在 Vercel 后台的环境变量 (Environment Variables) 中配置：
 *    - GITHUB_TOKEN: 拥有你 GitHub 创意工坊仓库写入权限的 Personal Access Token (PAT)
 *    - GITHUB_OWNER: 你的 GitHub 用户名
 *    - GITHUB_REPO: 你的创意工坊仓库名 (例如 vibepet-workshop)
 * 3. 部署后，将接口地址配置到客户端即可！
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_API_BASE = 'https://api.github.com';
const ALLOWED_ACTION_TYPES = new Set(['focus', 'music', 'merit']);
const MAX_BATCH_ITEMS = 50;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const WORKSHOP_INDEX_PATH = 'patches/index.json';

class ShareValidationError extends Error {}

interface ShareItemInput {
  petId: string;
  actionType: 'focus' | 'music' | 'merit';
  title: string;
  author?: string;
  promptUsed?: string;
  framesCount?: number;
  frameDuration?: number;
  imageBufferBase64: string;
}

interface WorkshopMetadata {
  title: string;
  author: string;
  petId: string;
  actionType: string;
  status: 'published' | 'import-only';
  framesCount: number;
  frameDuration: number;
  promptUsed: string;
  imageUrl: string;
  createdTime: string;
  metaPath: string;
}

interface GithubFileContent {
  content: Buffer;
  sha: string;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '')
    .substring(0, 48);
  return cleaned || fallback;
}

function normalizeShareItems(body: any): { items: ShareItemInput[]; createImportManifest: boolean; publishToWorkshop: boolean; legacy: boolean } {
  if (Array.isArray(body?.items)) {
    return {
      items: body.items,
      createImportManifest: body.createImportManifest === true,
      publishToWorkshop: body.publishToWorkshop !== false,
      legacy: false,
    };
  }

  return {
    items: [{
      petId: body?.petId,
      actionType: body?.actionType,
      title: body?.title,
      author: body?.author,
      promptUsed: body?.promptUsed,
      framesCount: body?.framesCount,
      frameDuration: body?.frameDuration,
      imageBufferBase64: body?.imageBufferBase64,
    }],
    createImportManifest: false,
    publishToWorkshop: true,
    legacy: true,
  };
}

function readUint24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      width: readUint24LE(buffer, 24) + 1,
      height: readUint24LE(buffer, 27) + 1,
    };
  }
  if (chunkType === 'VP8L' && buffer[20] === 0x2f) {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
    };
  }
  if (chunkType === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function validateShareItem(item: ShareItemInput, index: number): Required<ShareItemInput> {
  const petId = sanitizePathSegment(String(item.petId || ''), '').toLowerCase();
  const actionType = String(item.actionType || '') as ShareItemInput['actionType'];
  const title = String(item.title || '').trim();
  const author = String(item.author || 'anonymous').trim() || 'anonymous';
  const promptUsed = String(item.promptUsed || '');
  const framesCount = Number(item.framesCount || 8);
  const frameDuration = Number(item.frameDuration || 120);
  const imageBufferBase64 = String(item.imageBufferBase64 || '').trim();

  if (!petId) {
    throw new ShareValidationError(`Item ${index + 1}: invalid petId`);
  }
  if (!ALLOWED_ACTION_TYPES.has(actionType)) {
    throw new ShareValidationError(`Item ${index + 1}: invalid actionType`);
  }
  if (!title) {
    throw new ShareValidationError(`Item ${index + 1}: title is required`);
  }
  if (!Number.isInteger(framesCount) || ![4, 8].includes(framesCount)) {
    throw new ShareValidationError(`Item ${index + 1}: framesCount must be 4 or 8`);
  }
  if (!Number.isFinite(frameDuration) || frameDuration <= 0 || frameDuration > 2000) {
    throw new ShareValidationError(`Item ${index + 1}: frameDuration must be between 1 and 2000`);
  }
  if (!imageBufferBase64) {
    throw new ShareValidationError(`Item ${index + 1}: imageBufferBase64 is required`);
  }

  const imageBuffer = Buffer.from(imageBufferBase64, 'base64');
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new ShareValidationError(`Item ${index + 1}: image is empty or too large`);
  }
  const dimensions = readWebpDimensions(imageBuffer);
  if (!dimensions || dimensions.width !== framesCount * 192 || dimensions.height !== 208) {
    throw new ShareValidationError(`Item ${index + 1}: WebP dimensions must be ${framesCount * 192}x208`);
  }

  return {
    petId,
    actionType,
    title,
    author,
    promptUsed,
    framesCount,
    frameDuration,
    imageBufferBase64,
  };
}

async function getGithubFile(
  owner: string,
  repo: string,
  token: string,
  path: string,
): Promise<GithubFileContent | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'VibePet-Serverless-Proxy'
    }
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to read ${path}: ${errText}`);
  }

  const data = await response.json();
  return {
    content: Buffer.from(String(data.content || ''), 'base64'),
    sha: String(data.sha || ''),
  };
}

async function uploadGithubFile(
  owner: string,
  repo: string,
  token: string,
  path: string,
  content: Buffer,
  message: string,
  sha?: string,
): Promise<void> {
  const uploadUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'VibePet-Serverless-Proxy'
    },
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      ...(sha ? { sha } : {}),
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to upload ${path}: ${errText}`);
  }
}

async function updateWorkshopIndex(
  owner: string,
  repo: string,
  token: string,
  newItems: WorkshopMetadata[],
): Promise<void> {
  const existingFile = await getGithubFile(owner, repo, token, WORKSHOP_INDEX_PATH);
  let existingItems: WorkshopMetadata[] = [];

  if (existingFile) {
    try {
      const parsed = JSON.parse(existingFile.content.toString('utf8'));
      if (Array.isArray(parsed)) {
        existingItems = parsed;
      }
    } catch {
      existingItems = [];
    }
  }

  const newMetaPaths = new Set(newItems.map((item) => item.metaPath));
  const merged = [
    ...newItems,
    ...existingItems.filter((item) => !newMetaPaths.has(String(item?.metaPath || ''))),
  ];

  merged.sort((a, b) => new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime());

  await uploadGithubFile(
    owner,
    repo,
    token,
    WORKSHOP_INDEX_PATH,
    Buffer.from(JSON.stringify(merged, null, 2)),
    `Update workshop index: ${newItems.length} item${newItems.length === 1 ? '' : 's'}`,
    existingFile?.sha,
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 开启跨域响应头，允许 Tauri 客户端请求
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 从环境变量中读取配置
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    return res.status(500).json({ error: 'Server configuration missing: GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO is not set' });
  }

  try {
    const normalized = normalizeShareItems(req.body);
    if (normalized.items.length === 0 || normalized.items.length > MAX_BATCH_ITEMS) {
      return res.status(400).json({ error: `items must contain 1-${MAX_BATCH_ITEMS} entries` });
    }

    const timestamp = Date.now();
    const createdTime = new Date(timestamp).toISOString();
    const publishedItems: WorkshopMetadata[] = [];
    const manifestId = `${timestamp}_${Math.random().toString(36).slice(2, 10)}`;

    for (let i = 0; i < normalized.items.length; i++) {
      const item = validateShareItem(normalized.items[i], i);
      const cleanAuthor = sanitizePathSegment(item.author, 'anonymous').substring(0, 16);
      const fileNamePrefix = `${cleanAuthor}_${timestamp}_${String(i + 1).padStart(2, '0')}`;
      const imagePath = normalized.publishToWorkshop
        ? `patches/${item.petId}/${item.actionType}/${fileNamePrefix}.webp`
        : `handoffs/${manifestId}/${fileNamePrefix}.webp`;
      const jsonPath = normalized.publishToWorkshop
        ? `patches/${item.petId}/${item.actionType}/${fileNamePrefix}.json`
        : '';
      const imageUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${imagePath}`;

      const metadata: WorkshopMetadata = {
        title: item.title,
        author: cleanAuthor,
        petId: item.petId,
        actionType: item.actionType,
        status: normalized.publishToWorkshop ? 'published' : 'import-only',
        framesCount: item.framesCount,
        frameDuration: item.frameDuration,
        promptUsed: item.promptUsed,
        imageUrl,
        createdTime,
        metaPath: jsonPath,
      };

      await uploadGithubFile(
        owner,
        repo,
        token,
        imagePath,
        Buffer.from(item.imageBufferBase64, 'base64'),
        `Add workshop image: ${imagePath}`,
      );
      if (normalized.publishToWorkshop) {
        await uploadGithubFile(
          owner,
          repo,
          token,
          jsonPath,
          Buffer.from(JSON.stringify(metadata, null, 2)),
          `Add workshop metadata: ${jsonPath}`,
        );
      }

      publishedItems.push(metadata);
    }

    if (normalized.publishToWorkshop && publishedItems.length > 0) {
      await updateWorkshopIndex(owner, repo, token, publishedItems);
    }

    let importManifestUrl: string | undefined;
    let openAppUrl: string | undefined;
    if (normalized.createImportManifest) {
      const manifestPath = `handoffs/${manifestId}.json`;
      const manifest = {
        schemaVersion: 1,
        createdTime,
        items: publishedItems,
      };
      await uploadGithubFile(
        owner,
        repo,
        token,
        manifestPath,
        Buffer.from(JSON.stringify(manifest, null, 2)),
        `Add workshop import handoff: ${manifestPath}`,
      );
      importManifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${manifestPath}`;
      openAppUrl = `lingopet://import-actions?url=${encodeURIComponent(importManifestUrl)}`;
    }

    if (normalized.legacy) {
      const first = publishedItems[0];
      return res.status(200).json({
        success: true,
        message: 'Successfully submitted to VibePet Community Workshop!',
        imageUrl: first.imageUrl,
        jsonUrl: `https://fastly.jsdelivr.net/gh/${owner}/${repo}@main/${first.metaPath}`,
        item: first,
      });
    }

    return res.status(200).json({
      success: true,
      items: publishedItems,
      importManifestUrl,
      openAppUrl,
    });

  } catch (error) {
    const status = error instanceof ShareValidationError ? 400 : 500;
    return res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
