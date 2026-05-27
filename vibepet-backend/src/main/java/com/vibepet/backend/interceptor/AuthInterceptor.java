package com.vibepet.backend.interceptor;

import com.vibepet.backend.entity.PetUser;
import com.vibepet.backend.repository.PetUserRepository;
import com.vibepet.backend.util.UserContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Optional;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final PetUserRepository userRepository;

    public AuthInterceptor(PetUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // 放行 OPTIONS 预检请求 (CORS 必备)
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        // 放行静态图片文件资源，静态资源通常不走这个拦截器，但做个兜底放行
        String uri = request.getRequestURI();
        if (uri.startsWith("/images/")) {
            return true;
        }

        // 提取设备 UUID 指纹
        String deviceUuid = request.getHeader("X-Device-UUID");
        if (deviceUuid == null || deviceUuid.trim().isEmpty()) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Missing client credentials (X-Device-UUID)");
            return false;
        }

        deviceUuid = deviceUuid.trim();

        // 检索或无感自动注册用户
        Optional<PetUser> userOpt = userRepository.findByDeviceUuid(deviceUuid);
        PetUser user;
        if (userOpt.isPresent()) {
            user = userOpt.get();
        } else {
            // 自动注册
            user = PetUser.builder()
                    .deviceUuid(deviceUuid)
                    .nickname("训练师_" + deviceUuid.substring(Math.max(0, deviceUuid.length() - 6)))
                    .avatarUrl("")
                    .build();
            user = userRepository.save(user);
        }

        // 绑定线程上下文
        UserContext.setUser(user);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) throws Exception {
        // 必须清理 ThreadLocal 防止内存泄露
        UserContext.clear();
    }
}
