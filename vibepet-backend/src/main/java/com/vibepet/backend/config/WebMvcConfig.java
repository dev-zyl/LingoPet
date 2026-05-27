package com.vibepet.backend.config;

import com.vibepet.backend.interceptor.AuthInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    @Value("${vibepet.upload-dir}")
    private String uploadDir;

    public WebMvcConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    /**
     * 注册拦截器
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**"); // 仅拦截动态 API
    }

    /**
     * 配置跨域 (CORS) 策略，完美适配 Tauri 自定义网络协议及 localhost 开发
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("*") // 支持通配符允许任何源跨域
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }

    /**
     * 核心：映射本地存储目录为静态资源 URL 路径，便于 Cloudflare 缓存
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 规范路径结尾斜杠
        String path = uploadDir;
        if (!path.endsWith(File.separator)) {
            path = path + File.separator;
        }
        
        // 自动兼容 Windows 本地开发 (需要加 file: 前缀) 和 Linux 部署
        String resourceLocation = path;
        if (!resourceLocation.startsWith("file:") && !resourceLocation.startsWith("classpath:")) {
            resourceLocation = "file:" + resourceLocation;
        }

        registry.addResourceHandler("/images/**")
                .addResourceLocations(resourceLocation);
    }
}
