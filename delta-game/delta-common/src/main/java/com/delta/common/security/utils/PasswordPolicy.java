package com.delta.common.security.utils;
import com.delta.common.exception.BusinessException;
public final class PasswordPolicy {
    private PasswordPolicy() {}
    public static void validate(String password) {
        validate(password,8,32,"密码须包含字母和数字，长度8至32字符且UTF-8不超过72字节");
    }
    /** All account types share the same password boundary. */
    public static void validateUser(String password) {
        validate(password);
    }
    private static void validate(String password,int minLength,int maxLength,String message) {
        if(password==null || password.length()<minLength || password.length()>maxLength
                || !password.matches(".*[A-Za-z].*") || !password.matches(".*[0-9].*")
                || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72)
            throw new BusinessException(400,message);
    }
}
