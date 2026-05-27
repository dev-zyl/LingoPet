-- 创建数据库 (若不存在)
CREATE DATABASE IF NOT EXISTS `vibepet_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

USE `vibepet_db`;

-- 1. 用户匿名信息表
CREATE TABLE IF NOT EXISTS `pet_user` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `device_uuid` VARCHAR(64) NOT NULL COMMENT '客户端机器唯一指纹 UUID',
  `nickname` VARCHAR(32) NOT NULL DEFAULT '神秘宠物训练师' COMMENT '昵称',
  `avatar_url` VARCHAR(255) DEFAULT '' COMMENT '头像',
  `created_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_device_uuid` (`device_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户匿名信息表';

-- 2. 动作分享切片表
CREATE TABLE IF NOT EXISTS `pet_action_patch` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL COMMENT '上传者用户ID',
  `pet_id` VARCHAR(64) NOT NULL COMMENT '关联的原宠物ID (例如 default-cat)',
  `action_type` VARCHAR(32) NOT NULL COMMENT '动作类型 (focus/rhythm/gongde等)',
  `title` VARCHAR(64) NOT NULL COMMENT '动作标题 (例如 炫酷打坐专注)',
  `image_url` VARCHAR(255) NOT NULL COMMENT '动作帧图相对访问路径 (例如 /images/xxx.webp)',
  `frames_count` INT NOT NULL DEFAULT 8 COMMENT '动作帧数',
  `frame_duration` INT NOT NULL DEFAULT 120 COMMENT '单帧播放时长 (ms)',
  `prompt_used` TEXT COMMENT '生成该图所用的 Prompt 提示词',
  `ref_image_url` VARCHAR(255) DEFAULT '' COMMENT '原 AI 绘图参考图，供他人微调',
  `downloads_count` INT NOT NULL DEFAULT 0 COMMENT '套用/下载次数',
  `likes_count` INT NOT NULL DEFAULT 0 COMMENT '点赞数',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态 (1:公开, 0:下架/审核中)',
  `created_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_pet_action` (`pet_id`, `action_type`),
  INDEX `idx_created` (`created_time`),
  INDEX `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='动作分享切片表';
