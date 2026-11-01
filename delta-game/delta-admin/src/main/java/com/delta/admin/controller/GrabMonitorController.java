package com.delta.admin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.domain.R;
import com.delta.common.security.service.VerificationService;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/admin/player")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class GrabMonitorController {
    private final VerificationService verification;
    private final OrderService orders;
    @GetMapping("/{id}/grab-metrics")
    public R<Map<String,Object>> metrics(@PathVariable Long id) {
        return R.ok(Map.of("counters",verification.grabMetrics(id),"recentOrders",orders.list(new LambdaQueryWrapper<Order>()
                .select(Order::getId,Order::getOrderNo,Order::getStatus,Order::getAcceptTime)
                .eq(Order::getPlayerId,id).orderByDesc(Order::getAcceptTime).last("LIMIT 10"))));
    }
}
