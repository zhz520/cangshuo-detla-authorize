package com.delta.admin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.domain.R;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.order.dto.ReviewView;
import com.delta.order.entity.Order;
import com.delta.order.mapper.ReviewMapper;
import com.delta.order.service.OrderService;
import com.delta.player.entity.Player;
import com.delta.player.service.PlayerService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/app/players/{playerId}")
@RequiredArgsConstructor
public class PlayerReviewController {
    private final PlayerService playerService;
    private final com.delta.player.service.PlayerDirectoryService directory;
    private final ReviewMapper reviewMapper;
    private final OrderService orderService;

    @GetMapping("/reviews")
    public R<Page<ReviewView>> reviews(@PathVariable Long playerId,
                                      @RequestParam(defaultValue = "1") int pageNum,
                                      @RequestParam(defaultValue = "10") int pageSize) {
        directory.requireVisible(playerId);
        return R.ok(reviewMapper.selectViews(new Page<>(Math.max(1,pageNum),Math.min(50,Math.max(1,pageSize))),playerId));
    }

    @GetMapping("/reviewable-orders")
    @PreAuthorize("hasRole('USER')")
    public R<List<ReviewableOrder>> reviewableOrders(@PathVariable Long playerId) {
        if (!"USER".equals(SecurityUtils.getUserType())) return R.fail(403, "仅下单用户可以评价");
        List<Order> orders = orderService.list(new LambdaQueryWrapper<Order>()
                .select(Order::getId,Order::getOrderNo,Order::getProductName)
                .eq(Order::getUserId,SecurityUtils.getUserId()).eq(Order::getPlayerId,playerId)
                .eq(Order::getStatus,"CONFIRMED").orderByDesc(Order::getCreatedAt).last("LIMIT 50"));
        return R.ok(orders.stream().map(o -> new ReviewableOrder(o.getId(),o.getOrderNo(),o.getProductName())).toList());
    }

    public record ReviewableOrder(Long id,String orderNo,String productName) {}
}
