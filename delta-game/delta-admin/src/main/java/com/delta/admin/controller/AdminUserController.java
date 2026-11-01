package com.delta.admin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.PageQuery;
import com.delta.common.domain.R;
import com.delta.common.exception.BusinessException;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import com.delta.pay.service.TransactionService;
import com.delta.user.entity.User;
import com.delta.user.entity.Wallet;
import com.delta.user.service.UserService;
import com.delta.user.service.WalletService;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/admin/user")
@RequiredArgsConstructor
@org.springframework.security.access.prepost.PreAuthorize("hasRole('ADMIN')")
public class AdminUserController {
    private final UserService userService;
    private final WalletService walletService;
    private final OrderService orderService;
    private final TransactionService transactionService;
    private final com.delta.admin.service.UserManagementService management;

    @OpLog(module = "user", operation = "新增用户")
    @PostMapping
    public R<User> create(@jakarta.validation.Valid @RequestBody com.delta.admin.service.UserManagementService.UserRequest body) { return R.ok(management.save(null,body)); }
    @OpLog(module = "user", operation = "编辑用户")
    @PutMapping("/{id}")
    public R<User> update(@PathVariable Long id,@jakarta.validation.Valid @RequestBody com.delta.admin.service.UserManagementService.UserRequest body) { return R.ok(management.save(id,body)); }
    @OpLog(module = "user", operation = "删除用户")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {management.delete(id);return R.ok();}

    @GetMapping("/list")
    public R<Page<User>> list(PageQuery query,
                              @RequestParam(value = "keyword", required = false) String keyword,
                              @RequestParam(value = "status", required = false) Integer status) {
        if(keyword!=null&&keyword.length()>64) return R.fail(400,"搜索内容过长");
        LambdaQueryWrapper<User> w = new LambdaQueryWrapper<User>()
                .and(keyword != null && !keyword.isBlank(), q->q.like(User::getNickname,keyword).or().like(User::getPhone,keyword))
                .eq(status != null, User::getStatus, status)
                .orderByDesc(User::getCreatedAt);
        Page<User> page = userService.page(new Page<>(query.getPageNum(), query.getPageSize()), w);
        for (User u : page.getRecords()) {
            Wallet wallet = walletService.getByUserId(u.getId());
            u.setBalance(wallet != null ? wallet.getBalance() : java.math.BigDecimal.ZERO);
        }
        return R.ok(page);
    }

    @GetMapping("/{id}")
    public R<Map<String, Object>> detail(@PathVariable Long id) {
        Map<String, Object> data = new HashMap<>();
        data.put("user", userService.getById(id));
        data.put("wallet", walletService.getByUserId(id));
        long orderCount = orderService.count(new LambdaQueryWrapper<Order>().eq(Order::getUserId, id));
        data.put("orderCount", orderCount);
        return R.ok(data);
    }

    @OpLog(module = "user", operation = "更新用户状态")
    @PutMapping("/{id}/status")
    public R<Void> updateStatus(@PathVariable Long id, @RequestParam("status") Integer status) {
        management.setStatus(id,status);
        return R.ok();
    }

    @OpLog(module = "user", operation = "调整用户余额")
    @PutMapping("/{id}/balance")
    @Transactional(rollbackFor = Exception.class)
    public R<Void> adjustBalance(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        BigDecimal amount = new BigDecimal(body.get("amount").toString());
        String remark = body.getOrDefault("remark", "").toString();
        if (amount.compareTo(BigDecimal.ZERO) == 0) {
            throw new BusinessException("调整金额不能为0");
        }

        Wallet wallet = walletService.getByUserId(id);
        if (wallet == null) {
            walletService.initWallet(id);
            wallet = walletService.getByUserId(id);
        }

        BigDecimal balanceBefore = wallet.getBalance();
        BigDecimal balanceAfter = balanceBefore.add(amount);
        if (balanceAfter.compareTo(BigDecimal.ZERO) < 0) {
            throw new BusinessException("调整后余额不能为负数");
        }

        wallet.setBalance(balanceAfter);
        walletService.updateById(wallet);

        String type = amount.compareTo(BigDecimal.ZERO) > 0 ? "ADMIN_RECHARGE" : "ADMIN_DEDUCT";
        transactionService.record(type, "USER", id, amount.abs(),
                balanceBefore, balanceAfter, null, null, null,
                "管理员调整: " + (remark.isEmpty() ? (amount.compareTo(BigDecimal.ZERO) > 0 ? "充值" : "扣款") : remark));

        return R.ok();
    }
}
