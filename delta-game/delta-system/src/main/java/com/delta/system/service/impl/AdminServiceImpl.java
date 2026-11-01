package com.delta.system.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.delta.common.exception.BusinessException;
import com.delta.common.security.utils.AdminRolePolicy;
import com.delta.system.entity.Admin;
import com.delta.system.mapper.AdminMapper;
import com.delta.system.service.AdminService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
@RequiredArgsConstructor
public class AdminServiceImpl extends ServiceImpl<AdminMapper, Admin> implements AdminService {
    private final PasswordEncoder passwordEncoder;

    @Override
    public boolean save(Admin entity) {
        entity.setUsername(entity.getUsername() == null ? null : entity.getUsername().trim());
        if(entity.getUsername()==null || !entity.getUsername().matches("[A-Za-z0-9_.@-]{3,64}")) throw new BusinessException(400,"账号须为3～64位字母、数字或 _ . @ -");
        com.delta.common.security.utils.PasswordPolicy.validate(entity.getPassword());
        entity.setRole(AdminRolePolicy.normalize(entity.getRole()));
        if (!StringUtils.hasText(entity.getNickname())) entity.setNickname(entity.getUsername());
        if (entity.getStatus() == null) entity.setStatus(1);
        if (entity.getStatus() != 0 && entity.getStatus() != 1) throw new BusinessException(400, "账号状态无效");
        if (entity.getPhone() != null) entity.setPhone(entity.getPhone().trim());
        if (entity.getAvatar() == null) entity.setAvatar("");
        entity.setId(null);entity.setDeleted(0);entity.setLoginFailCount(0);entity.setLockTime(null);
        long count = count(new LambdaQueryWrapper<Admin>().eq(Admin::getUsername, entity.getUsername()));
        if (count > 0) throw new BusinessException("用户名已存在");
        entity.setPassword(passwordEncoder.encode(entity.getPassword()));
        return super.save(entity);
    }
}
