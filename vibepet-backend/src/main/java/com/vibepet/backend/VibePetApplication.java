package com.vibepet.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling // 开启定时任务，用于定时从 Redis 批量同步点赞、下载数回 MySQL
public class VibePetApplication {
    public static void main(String[] args) {
        // 设置时区为上海/北京时间
        System.setProperty("user.timezone", "Asia/Shanghai");
        SpringApplication.run(VibePetApplication.class, args);
    }
}
