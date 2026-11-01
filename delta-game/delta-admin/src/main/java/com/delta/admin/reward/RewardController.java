package com.delta.admin.reward;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.domain.*;
import com.delta.common.security.utils.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequiredArgsConstructor
public class RewardController {
    private final RewardService rewards;
    public record PayRequest(@NotNull @DecimalMin("0.01") @Digits(integer=5,fraction=2) BigDecimal amount,
            @NotBlank @Pattern(regexp="[a-zA-Z0-9-]{16,64}") String requestId,@Size(max=200) String remark) {}
    public record ReversalRequest(@NotBlank @Size(max=200) String reason) {}
    @GetMapping("/order/{orderId}/reward") @PreAuthorize("hasRole('USER')")
    public R<Map<String,Object>> options(@PathVariable Long orderId) {return R.ok(rewards.options(orderId,SecurityUtils.getUserId()));}
    @PostMapping("/order/{orderId}/reward") @PreAuthorize("hasRole('USER')")
    public R<RewardReceipt> pay(@PathVariable Long orderId,@Valid @RequestBody PayRequest body) {
        return R.ok(RewardReceipt.from(rewards.pay(orderId,SecurityUtils.getUserId(),body.amount(),body.requestId(),body.remark())));
    }
    @GetMapping("/user/rewards/eligible-orders") @PreAuthorize("hasRole('USER')")
    public R<List<Map<String,Object>>> eligible(@RequestParam Long playerId) {return R.ok(rewards.eligibleOrders(playerId,SecurityUtils.getUserId()));}
    @GetMapping("/admin/rewards") @PreAuthorize("hasRole('ADMIN')")
    public R<Page<Reward>> list(PageQuery page,@RequestParam(required=false) Long userId,@RequestParam(required=false) Long playerId,
            @RequestParam(required=false) String orderNo,@RequestParam(required=false) String status,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return R.ok(rewards.page(new Page<>(page.getPageNum(),page.getPageSize()),new LambdaQueryWrapper<Reward>()
                .eq(userId!=null,Reward::getUserId,userId).eq(playerId!=null,Reward::getPlayerId,playerId)
                .eq(orderNo!=null&&!orderNo.isBlank(),Reward::getOrderNo,orderNo).eq(status!=null&&!status.isBlank(),Reward::getStatus,status)
                .ge(startDate!=null,Reward::getCreatedAt,startDate==null?null:startDate.atStartOfDay())
                .lt(endDate!=null,Reward::getCreatedAt,endDate==null?null:endDate.plusDays(1).atStartOfDay()).orderByDesc(Reward::getId)));
    }
    @PostMapping("/admin/rewards/{id}/reverse") @PreAuthorize("hasRole('ADMIN')")
    public R<Reward> reverse(@PathVariable Long id,@Valid @RequestBody ReversalRequest body) {return R.ok(rewards.reverse(id,SecurityUtils.getUserId(),body.reason().trim()));}
}
