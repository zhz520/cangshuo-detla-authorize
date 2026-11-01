package com.delta.user.service;

import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.exception.BusinessException;
import com.delta.common.security.utils.PasswordPolicy;
import com.delta.user.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.security.*;
import java.time.Duration;
import java.util.*;

@Service
@RequiredArgsConstructor
public class UserPasswordService {
    private final UserService users;
    private final StringRedisTemplate redis;
    private final PasswordEncoder encoder;
    private static final SecureRandom RANDOM=new SecureRandom();
    private record Setup(Long userId,String phone,Long authVersion) {}
    public String issueSetup(User user) {
        byte[] bytes=new byte[32];RANDOM.nextBytes(bytes);
        String ticket=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(ticket),JSON.toJSONString(new Setup(user.getId(),user.getPhone(),user.getAuthVersion()==null?0L:user.getAuthVersion())),Duration.ofMinutes(5));
        return ticket;
    }
    @Transactional(rollbackFor=Exception.class)
    public User completeSetup(String ticket,String password,String confirmation) {
        PasswordPolicy.validateUser(password);
        if(!password.equals(confirmation)) throw new BusinessException(400,"两次输入的密码不一致");
        if(ticket==null || !ticket.matches("[A-Za-z0-9_-]{43}")) throw new BusinessException(401,"设置凭据无效，请重新验证手机号");
        String value=redis.opsForValue().getAndDelete(key(ticket));
        if(value==null) throw new BusinessException(401,"设置凭据已过期或已使用，请重新验证手机号");
        Setup setup=JSON.parseObject(value,Setup.class);
        User user=users.getOne(new LambdaQueryWrapper<User>().eq(User::getId,setup.userId()).last("FOR UPDATE"));
        if(user==null || !Integer.valueOf(1).equals(user.getStatus()) || !Objects.equals(user.getPhone(),setup.phone())
                || !Objects.equals(user.getAuthVersion()==null?0L:user.getAuthVersion(),setup.authVersion())) throw new BusinessException(403,"账号状态已变化，请重新登录");
        if(user.isPasswordSet()) throw new BusinessException(409,"账号已设置密码，请重新登录");
        User update=new User();update.setId(user.getId());update.setPassword(encoder.encode(password));
        update.setAuthVersion((user.getAuthVersion()==null?0:user.getAuthVersion())+1);
        if(!users.updateById(update)) throw new IllegalStateException("密码设置失败");
        user.setPassword(update.getPassword());user.setAuthVersion(update.getAuthVersion());return user;
    }
    private String key(String ticket) {
        try{return "auth:password-setup:"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(ticket.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));}
        catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
}
