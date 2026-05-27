package com.vibepet.backend.util;

import com.vibepet.backend.entity.PetUser;

public class UserContext {
    private static final ThreadLocal<PetUser> USER_HOLDER = new ThreadLocal<>();

    /**
     * 将用户信息绑定到当前请求线程
     * @param user 匿名用户
     */
    public static void setUser(PetUser user) {
        USER_HOLDER.set(user);
    }

    /**
     * 获取当前线程绑定的用户信息
     * @return 匿名用户
     */
    public static PetUser getUser() {
        return USER_HOLDER.get();
    }

    /**
     * 清理 ThreadLocal，防止 Tomcat/Netty 线程池内存泄露
     */
    public static void clear() {
        USER_HOLDER.remove();
    }
}
