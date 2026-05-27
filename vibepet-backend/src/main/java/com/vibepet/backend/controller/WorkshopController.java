package com.vibepet.backend.controller;

import com.vibepet.backend.entity.PetActionPatch;
import com.vibepet.backend.repository.PetActionPatchRepository;
import com.vibepet.backend.util.UserContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/workshop")
public class WorkshopController {

    private final PetActionPatchRepository patchRepository;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public WorkshopController(PetActionPatchRepository patchRepository, StringRedisTemplate redisTemplate) {
        this.patchRepository = patchRepository;
        this.redisTemplate = redisTemplate;
    }

    /**
     * 获取创意工坊所有的动作切片包 (支持 Redis 缓存，贴合高性能规则)
     */
    @GetMapping("/list")
    public List<PetActionPatch> getWorkshopList() {
        String cacheKey = "workshop:list";
        try {
            // 1. 尝试从 Redis 缓存中快速拉取数据
            String cachedJson = redisTemplate.opsForValue().get(cacheKey);
            if (cachedJson != null && !cachedJson.trim().isEmpty()) {
                return objectMapper.readValue(cachedJson, objectMapper.getTypeFactory().constructCollectionType(List.class, PetActionPatch.class));
            }
        } catch (Exception e) {
            System.err.println("Redis 缓存拉取异常（降级至 MySQL 数据库直查）：" + e.getMessage());
        }

        // 2. Redis 未命中，直查 MySQL 数据库中公开状态的 Patch 动作切片包
        List<PetActionPatch> patches = patchRepository.findAll().stream()
                .filter(p -> p.getStatus() != null && p.getStatus() == 1)
                .toList();

        try {
            // 3. 将拉取的数据回写至 Redis，并配置 30 分钟缓存时间，防止穿透
            String jsonStr = objectMapper.writeValueAsString(patches);
            redisTemplate.opsForValue().set(cacheKey, jsonStr, 30, TimeUnit.MINUTES);
        } catch (Exception e) {
            System.err.println("Redis 缓存写入异常：" + e.getMessage());
        }

        return patches;
    }

    /**
     * 动作包被下载/套用成功上报接口 (将 downloads_count 真实递增，并清理 Redis 缓存)
     */
    @PostMapping("/download")
    public Map<String, Object> incrementDownloads(@RequestBody Map<String, Object> payload) {
        Map<String, Object> result = new HashMap<>();
        if (!payload.containsKey("patchId")) {
            result.put("success", false);
            result.put("error", "参数缺少 patchId");
            return result;
        }

        try {
            Long patchId = Long.valueOf(payload.get("patchId").toString());
            // 执行数据库真实 downloadsCount 递增
            int affected = patchRepository.incrementDownloadsCount(patchId, 1);
            if (affected > 0) {
                // 套用成功！主动删除 Redis 列表缓存，确保下一次客户端拉取获得最实时、绝对真实的下载计数值！
                redisTemplate.delete("workshop:list");
                result.put("success", true);
                result.put("msg", "真实下载数上报并递增成功！");
            } else {
                result.put("success", false);
                result.put("error", "未找到指定 patchId 动作记录");
            }
        } catch (Exception e) {
            result.put("success", false);
            result.put("error", "下载上报异常：" + e.getMessage());
        }
        return result;
    }

    /**
     * 上报动作包接口 (客户端分享动作时写入本地 MySQL 数据库)
     */
    @PostMapping("/share")
    public Map<String, Object> sharePatch(@RequestBody PetActionPatch patch) {
        Map<String, Object> result = new HashMap<>();
        try {
            // 获取当前认证的 User
            if (UserContext.getUser() == null) {
                result.put("success", false);
                result.put("error", "用户未授权（请在 Headers 携带 X-Device-UUID）");
                return result;
            }
            
            patch.setUserId(UserContext.getUser().getId());
            patch.setStatus(1); // 默认设为公开
            PetActionPatch saved = patchRepository.save(patch);
            
            // 清除缓存
            redisTemplate.delete("workshop:list");
            
            result.put("success", true);
            result.put("patchId", saved.getId());
        } catch (Exception e) {
            result.put("success", false);
            result.put("error", "分享写入失败：" + e.getMessage());
        }
        return result;
    }
}
