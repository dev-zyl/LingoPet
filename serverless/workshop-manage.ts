import { VercelRequest, VercelResponse } from '@vercel/node';

type ManageAction = 'hide' | 'restore' | 'delete';

const GITHUB_API_BASE = 'https://api.github.com';

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

    if (!['hide', 'restore', 'delete'].includes(action) || !validateMetaPath(metaPath)) {
      return res.status(400).json({ error: 'Invalid action or metaPath' });
    }

    const contentUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${metaPath}`;
    const metaFile = await githubRequest<{ sha: string; content: string }>(contentUrl, token);
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
