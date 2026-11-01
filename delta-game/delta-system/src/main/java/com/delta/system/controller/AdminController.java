package com.delta.system.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.PageQuery;
import com.delta.common.domain.R;
import com.delta.common.exception.BusinessException;
import com.delta.common.security.utils.AdminRolePolicy;
import com.delta.system.entity.Admin;
import com.delta.system.service.AdminService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/system/admin")
@RequiredArgsConstructor
public class AdminController {
    private final AdminService adminService;
    private final PasswordEncoder passwordEncoder;

    @GetMapping("/list")
    public R<Page<Admin>> list(PageQuery query, @RequestParam(value = "username", required = false) String username) {
        LambdaQueryWrapper<Admin> wrapper = new LambdaQueryWrapper<Admin>()
                .like(username != null, Admin::getUsername, username)
                .orderByDesc(Admin::getCreatedAt);
        return R.ok(adminService.page(new Page<>(query.getPageNum(), query.getPageSize()), wrapper));
    }

    @GetMapping("/{id}")
    public R<Admin> getById(@PathVariable Long id) {
        Admin admin = adminService.getById(id);
        if (admin != null) admin.setPassword(null);
        return R.ok(admin);
    }

    @OpLog(module = "system", operation = "新增管理员")
    @PostMapping
    public R<Void> add(@RequestBody Admin admin) {
        adminService.save(admin);
        return R.ok();
    }

    @OpLog(module = "system", operation = "编辑管理员")
    @PutMapping
    public R<Void> update(@RequestBody Admin admin) {
        if (admin.getId() == null) throw new BusinessException(400, "管理员ID不能为空");
        Admin update = new Admin();
        update.setId(admin.getId());
        if (admin.getUsername() != null) {
            String username = admin.getUsername().trim();
            if (!username.matches("[A-Za-z0-9_.@-]{3,64}")) throw new BusinessException(400, "账号须为3～64位字母、数字或 _ . @ -");
            update.setUsername(username);
        }
        update.setNickname(admin.getNickname());
        update.setAvatar(admin.getAvatar());
        update.setPhone(admin.getPhone() == null ? null : admin.getPhone().trim());
        if (StringUtils.hasText(admin.getRole())) update.setRole(AdminRolePolicy.normalize(admin.getRole()));
        if (admin.getStatus() != null) {
            if (admin.getStatus() != 0 && admin.getStatus() != 1) throw new BusinessException(400, "账号状态无效");
            update.setStatus(admin.getStatus());
        }
        if (StringUtils.hasText(admin.getPassword())) {
            com.delta.common.security.utils.PasswordPolicy.validate(admin.getPassword());
            update.setPassword(passwordEncoder.encode(admin.getPassword()));
        }
        adminService.updateById(update);
        return R.ok();
    }

    @OpLog(module = "system", operation = "删除管理员")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        adminService.removeById(id);
        return R.ok();
    }
}
