package com.delta.common.security.utils;

import com.delta.common.exception.BusinessException;

import java.util.Locale;

/** Canonical role handling shared by admin creation, updates and login. */
public final class AdminRolePolicy {
    private AdminRolePolicy() {}

    public static String normalize(String role) {
        if (role == null || role.trim().isEmpty()) {
            throw new BusinessException(400, "请选择管理员或客服角色");
        }
        String value = role.trim().toUpperCase(Locale.ROOT);
        if (!"ADMIN".equals(value) && !"CS".equals(value) && !"BOTH".equals(value)) {
            throw new BusinessException(400, "账号角色配置无效");
        }
        return value;
    }

    /** BOTH is a legacy role with administrator permissions. */
    public static String effectiveRole(String role) {
        return "CS".equals(normalize(role)) ? "CS" : "ADMIN";
    }
}
