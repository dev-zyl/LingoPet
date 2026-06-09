import { VercelRequest, VercelResponse } from '@vercel/node';

type ManageAction = 'hide' | 'restore' | 'delete' | 'cleanup-handoffs';

const GITHUB_API_BASE = 'https://api.github.com';
const WORKSHOP_INDEX_PATH = 'patches/index.json';
const HANDOFFS_PATH = 'handoffs';

interface GithubContentEntry {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
}

function withCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
}

function validateMetaPath(metaPath: string): boolean {
  return metaPath.startsWith('patches/') && metaPath.endsWith('.json') && metaPath !== 'patches/index.json';
}

async function githubRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'VibePet-Workshop-Manage',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `GitHub request failed: HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function getGithubFile(path: string, token: string, owner: string, repo: string): Promise<{ sha: string; content: string } | null> {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'VibePet-Workshop-Manage',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `GitHub request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as { sha: string; content: string };
}

async function putGithubFile(
  path: string,
  content: Buffer,
  message: string,
  token: string,
  owner: string,
  repo: string,
  sha?: string,
): Promise<void> {
  await githubRequest(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

function parseRepoPathFromImageUrl(imageUrl?: string): string | null {
  if (!imageUrl) return null;
  const marker = '@main/';
  const markerIndex = imageUrl.indexOf(marker);
  if (markerIndex >= 0) {
    return imageUrl.slice(markerIndex + marker.length);
  }
  const rawMarker = '/main/';
  const rawIndex = imageUrl.indexOf(rawMarker);
  if (rawIndex >= 0) {
    return imageUrl.slice(rawIndex + rawMarker.length);
  }
  return null;
}

function handoffTimestampFromPath(path: string): number | null {
  const relative = path.replace(/^handoffs\//, '');
  const firstSegment = relative.split('/')[0] || '';
  const timestamp = Number(firstSegment.split('_')[0]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

async function listGithubDirectory(path: string, token: string, owner: string, repo: string): Promise<GithubContentEntry[]> {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'VibePet-Workshop-Manage',
    },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `GitHub request failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data as GithubContentEntry[] : [];
}

async function deleteGithubFile(path: string, sha: string, message: string, token: string, owner: string, repo: string): Promise<void> {
  await githubRequest(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha }),
  });
}

async function collectFilesUnder(path: string, token: string, owner: string, repo: string): Promise<GithubContentEntry[]> {
  const entries = await listGithubDirectory(path, token, owner, repo);
  const files: GithubContentEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      files.push(entry);
    } else if (entry.type === 'dir') {
      files.push(...await collectFilesUnder(entry.path, token, owner, repo));
    }
  }
  return files;
}

async function cleanupHandoffs(
  olderThanDays: number,
  token: string,
  owner: string,
  repo: string,
): Promise<{ deletedCount: number; keptCount: number }> {
  const safeDays = Number.isFinite(olderThanDays) ? Math.max(1, Math.min(olderThanDays, 365)) : 7;
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const entries = await listGithubDirectory(HANDOFFS_PATH, token, owner, repo);
  let deletedCount = 0;
  let keptCount = 0;

  for (const entry of entries) {
    const timestamp = handoffTimestampFromPath(entry.path);
    if (!timestamp || timestamp >= cutoff) {
      keptCount++;
      continue;
    }

    const files = entry.type === 'file'
      ? [entry]
      : await collectFilesUnder(entry.path, token, owner, repo);
    for (const file of files) {
      await deleteGithubFile(file.path, file.sha, `Cleanup workshop handoff: ${file.path}`, token, owner, repo);
      deletedCount++;
    }
  }

  return { deletedCount, keptCount };
}

async function updateWorkshopIndex(
  action: ManageAction,
  metadata: Record<string, unknown>,
  metaPath: string,
  token: string,
  owner: string,
  repo: string,
): Promise<void> {
  const indexFile = await getGithubFile(WORKSHOP_INDEX_PATH, token, owner, repo);
  const currentIndex = indexFile
    ? JSON.parse(Buffer.from(indexFile.content, 'base64').toString('utf8')) as Array<Record<string, unknown>>
    : [];
  if (!Array.isArray(currentIndex)) {
    throw new Error('patches/index.json format is invalid');
  }

  let nextIndex: Array<Record<string, unknown>>;
  if (action === 'delete') {
    nextIndex = currentIndex.filter((item) => item.metaPath !== metaPath);
  } else {
    const status = action === 'hide' ? 'hidden' : 'published';
    let found = false;
    nextIndex = currentIndex.map((item) => {
      if (item.metaPath !== metaPath) return item;
      found = true;
      return { ...item, status, updatedTime: metadata.updatedTime };
    });
    if (!found) {
      nextIndex.unshift({ ...metadata, metaPath });
    }
  }

  nextIndex.sort((a, b) => new Date(String(b.createdTime || 0)).getTime() - new Date(String(a.createdTime || 0)).getTime());
  await putGithubFile(
    WORKSHOP_INDEX_PATH,
    Buffer.from(JSON.stringify(nextIndex, null, 2)),
    `Update workshop index after ${action}: ${metaPath}`,
    token,
    owner,
    repo,
    indexFile?.sha,
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  withCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const adminToken = process.env.WORKSHOP_ADMIN_TOKEN;
  const providedToken = req.headers['x-admin-token'];

  if (!token || !owner || !repo || !adminToken) {
    return res.status(500).json({ error: 'Server configuration missing: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, or WORKSHOP_ADMIN_TOKEN is not set' });
  }
  if (typeof providedToken !== 'string' || providedToken !== adminToken) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }

  try {
    const action = req.body?.action as ManageAction;
    const metaPath = String(req.body?.metaPath || '');

    if (action === 'cleanup-handoffs') {
      const olderThanDays = Number(req.body?.olderThanDays || 7);
      const result = await cleanupHandoffs(olderThanDays, token, owner, repo);
      return res.status(200).json({ success: true, action, olderThanDays: Math.max(1, Math.min(olderThanDays || 7, 365)), ...result });
    }

    if (!['hide', 'restore', 'delete'].includes(action) || !validateMetaPath(metaPath)) {
      return res.status(400).json({ error: 'Invalid action or metaPath' });
    }

    const contentUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${metaPath}`;
    const metaFile = await getGithubFile(metaPath, token, owner, repo);
    if (!metaFile) {
      if (action === 'delete') {
        await updateWorkshopIndex(action, {}, metaPath, token, owner, repo);
        return res.status(200).json({ success: true, action, metaPath, staleIndexOnly: true });
      }
      return res.status(404).json({ error: `Workshop metadata not found: ${metaPath}` });
    }
    const rawContent = Buffer.from(metaFile.content, 'base64').toString('utf8');
    const metadata = JSON.parse(rawContent) as Record<string, unknown>;

    if (action === 'delete') {
      await githubRequest(contentUrl, token, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `Delete workshop metadata: ${metaPath}`,
          sha: metaFile.sha,
        }),
      });

      const imagePath = parseRepoPathFromImageUrl(typeof metadata.imageUrl === 'string' ? metadata.imageUrl : undefined);
      if (imagePath) {
        const imageUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${imagePath}`;
        try {
          const imageFile = await githubRequest<{ sha: string }>(imageUrl, token);
          await githubRequest(imageUrl, token, {
            method: 'DELETE',
            body: JSON.stringify({
              message: `Delete workshop image: ${imagePath}`,
              sha: imageFile.sha,
            }),
          });
        } catch (error) {
          console.warn('Failed to delete workshop image, continuing with metadata delete only.', error);
        }
      }

      await updateWorkshopIndex(action, metadata, metaPath, token, owner, repo);
      return res.status(200).json({ success: true, action, metaPath });
    }

    metadata.status = action === 'hide' ? 'hidden' : 'published';
    metadata.updatedTime = new Date().toISOString();

    await githubRequest(contentUrl, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `${action === 'hide' ? 'Hide' : 'Restore'} workshop item: ${metaPath}`,
        sha: metaFile.sha,
        content: Buffer.from(JSON.stringify(metadata, null, 2)).toString('base64'),
      }),
    });

    await updateWorkshopIndex(action, metadata, metaPath, token, owner, repo);
    return res.status(200).json({
      success: true,
      action,
      metaPath,
      status: metadata.status,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
