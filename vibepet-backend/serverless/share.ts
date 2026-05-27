/**
 * VibePet Git-Based 社区创意工坊 - 客户端上传代理云函数
 * 
 * 部署指引：
 * 1. 扔入一个新建的 Vercel 免费项目中，路径为 api/share.ts
 * 2. 在 Vercel 后台的环境变量 (Environment Variables) 中配置：
 *    - GITHUB_TOKEN: 拥有你 GitHub 创意工坊仓库写入权限的 Personal Access Token (PAT)
 *    - GITHUB_OWNER: 你的 GitHub 用户名
 *    - GITHUB_REPO: 你的创意工坊仓库名 (例如 vibepet-workshop)
 * 3. 部署后，将接口地址配置到客户端即可！
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 开启跨域响应头，允许 Tauri 客户端请求
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Device-UUID'
  );

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
    const {
      petId,
      actionType,
      title,
      author,
      promptUsed,
      framesCount,
      frameDuration,
      imageBufferBase64 // 用户导出的横版 WebP 精灵图 Base64 字符串
    } = req.body;

    // 参数校验
    if (!petId || !actionType || !title || !imageBufferBase64) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // 格式化标识名
    const timestamp = Date.now();
    const cleanAuthor = (author || 'anonymous').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '').substring(0, 16);
    const fileNamePrefix = `${cleanAuthor}_${timestamp}`;

    // 动作图片和元数据配置在仓库里的存储相对路径
    const imagePath = `patches/${petId}/${actionType}/${fileNamePrefix}.webp`;
    const jsonPath = `patches/${petId}/${actionType}/${fileNamePrefix}.json`;

    // 构造将要保存在 CDN 上的图片绝对链接 (jsDelivr CDN)
    const imageUrl = `https://fastly.jsdelivr.net/gh/${owner}/${repo}@main/${imagePath}`;

    const metadata = {
      title,
      author: cleanAuthor,
      petId,
      actionType,
      framesCount: Number(framesCount || 8),
      frameDuration: Number(frameDuration || 120),
      promptUsed: promptUsed || '',
      imageUrl,
      createdTime: new Date().toISOString()
    };

    // 将图片 Base64 转换成 Buffer 字节
    const imageBuffer = Buffer.from(imageBufferBase64, 'base64');
    const jsonContent = JSON.stringify(metadata, null, 2);

    // 1. 上传图片文件到 GitHub
    const imageUploadUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${imagePath}`;
    const imageUploadRes = await fetch(imageUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VibePet-Serverless-Proxy'
      },
      body: JSON.stringify({
        message: `Add workshop image: ${imagePath}`,
        content: imageBuffer.toString('base64')
      })
    });

    if (!imageUploadRes.ok) {
      const errText = await imageUploadRes.text();
      return res.status(502).json({ error: 'Failed to upload image to GitHub', details: errText });
    }

    // 2. 上传 JSON 配置文件到 GitHub
    const jsonUploadUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${jsonPath}`;
    const jsonUploadRes = await fetch(jsonUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VibePet-Serverless-Proxy'
      },
      body: JSON.stringify({
        message: `Add workshop metadata: ${jsonPath}`,
        content: Buffer.from(jsonContent).toString('base64')
      })
    });

    if (!jsonUploadRes.ok) {
      const errText = await jsonUploadRes.text();
      return res.status(502).json({ error: 'Failed to upload metadata to GitHub', details: errText });
    }

    // 返回成功信息
    return res.status(200).json({
      success: true,
      message: 'Successfully submitted to VibePet Community Workshop!',
      imageUrl,
      jsonUrl: `https://fastly.jsdelivr.net/gh/${owner}/${repo}@main/${jsonPath}`
    });

  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
