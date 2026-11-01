package com.delta.order.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.domain.PageQuery;
import com.delta.common.domain.R;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.order.dto.CreateOrderRequest;
import com.delta.order.entity.Order;
import com.delta.order.entity.OrderPlayer;
import com.delta.order.entity.OrderProgress;
import com.delta.order.entity.PlayerReplaceRequest;
import com.delta.order.service.OrderPlayerService;
import com.delta.order.service.OrderProgressService;
import com.delta.order.service.OrderService;
import com.delta.order.service.PlayerReplaceRequestService;
import com.delta.common.event.BusinessEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/order")
@RequiredArgsConstructor
public class OrderController {
    private final OrderService orderService;
    private final com.delta.order.service.OrderPricingService orderPricing;
    private final OrderPlayerService orderPlayerService;
    private final OrderProgressService orderProgressService;
    private final PlayerReplaceRequestService replaceRequestService;
    private final ApplicationEventPublisher eventPublisher;
    private final com.delta.common.mapper.CrossModuleMapper crossModuleMapper;

    @GetMapping("/quote")
    public R<com.delta.order.dto.OrderQuote> quote(@RequestParam Long productId,
            @RequestParam(required=false) Long designatedPlayerId,@RequestParam(required=false) Integer playerLevelId,
            jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store, private");
        return R.ok(orderPricing.quote(productId,designatedPlayerId,playerLevelId));
    }

    @PostMapping
    public R<Order> create(@RequestBody CreateOrderRequest request) {
        return R.ok(orderService.createOrder(SecurityUtils.getUserId(), request));
    }

    @GetMapping("/my")
    public R<Page<Order>> myOrders(PageQuery query, @RequestParam(required = false) String status) {
        Long userId = SecurityUtils.getUserId();
        LambdaQueryWrapper<Order> wrapper = new LambdaQueryWrapper<Order>()
                .eq(Order::getUserId, userId)
                .eq(status != null && !status.isEmpty(), Order::getStatus, status)
                .orderByDesc(Order::getCreatedAt);
        Page<Order> page = orderService.page(new Page<>(query.getPageNum(), query.getPageSize()), wrapper);
        fillPlayerInfo(page.getRecords());
        return R.ok(page);
    }

    @GetMapping("/{id}")
    public R<Order> detail(@PathVariable Long id) {
        Order order = orderService.getById(id);
        requireOwner(order);
        if (order != null) {
            if (order.getPlayerId() != null) {
                order.setPlayerName(crossModuleMapper.selectPlayerNickname(order.getPlayerId()));
                order.setPlayerAvatar(crossModuleMapper.selectPlayerAvatar(order.getPlayerId()));
            }
            if (order.getUserId() != null) {
                order.setUserNickname(crossModuleMapper.selectUserNickname(order.getUserId()));
                order.setUserAvatar(crossModuleMapper.selectUserAvatar(order.getUserId()));
            }
            // 填充队友信息
            fillTeammates(order);
        }
        return R.ok(order);
    }

    private void fillPlayerInfo(java.util.List<Order> orders) {
        if (orders == null) return;
        for (Order o : orders) {
            if (o.getPlayerId() != null) {
                o.setPlayerName(crossModuleMapper.selectPlayerNickname(o.getPlayerId()));
                o.setPlayerAvatar(crossModuleMapper.selectPlayerAvatar(o.getPlayerId()));
            }
        }
    }

    private void fillTeammates(Order order) {
        // 只返回 TEAMMATE 角色，不包含 PRIMARY（主打手）
        List<OrderPlayer> teammates = orderPlayerService.list(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<OrderPlayer>()
                        .eq(OrderPlayer::getOrderId, order.getId())
                        .eq(OrderPlayer::getRole, "TEAMMATE")
                        .orderByAsc(OrderPlayer::getCreatedAt));
        if (teammates != null) {
            for (OrderPlayer op : teammates) {
                op.setNickname(crossModuleMapper.selectPlayerNickname(op.getPlayerId()));
                op.setAvatar(crossModuleMapper.selectPlayerAvatar(op.getPlayerId()));
            }
        }
        order.setTeammates(teammates);
    }

    @GetMapping("/{id}/progress")
    public R<List<OrderProgress>> progress(@PathVariable Long id) {
        requireOwner(orderService.getById(id));
        return R.ok(orderProgressService.list(new LambdaQueryWrapper<OrderProgress>()
                .eq(OrderProgress::getOrderId, id).orderByAsc(OrderProgress::getCreatedAt)));
    }

    private void requireOwner(Order order) {
        if(order==null || !SecurityUtils.getUserId().equals(order.getUserId()))
            throw new com.delta.common.exception.BusinessException(404,"订单不存在");
    }

    @PostMapping("/{id}/cancel")
    public R<Void> cancel(@PathVariable Long id) {
        orderService.cancelOrder(id, SecurityUtils.getUserId());
        return R.ok();
    }

    @PostMapping("/{id}/confirm")
    public R<Void> confirm(@PathVariable Long id) {
        orderService.confirmOrder(id, SecurityUtils.getUserId());
        return R.ok();
    }

    @PostMapping("/{id}/replace")
    public R<Void> requestReplace(@PathVariable Long id, @RequestBody PlayerReplaceRequest req) {
        PlayerReplaceRequest supplied=req;req=new PlayerReplaceRequest();req.setReason(supplied.getReason());
        if(req.getReason()==null || req.getReason().isBlank() || req.getReason().length()>1000) return R.fail(400,"换人原因长度不符合要求");
        Long userId = SecurityUtils.getUserId();
        Order order = orderService.getById(id);
        if (order == null) return R.fail("订单不存在");
        if (!order.getUserId().equals(userId)) return R.fail("无权操作");
        if (!"IN_PROGRESS".equals(order.getStatus())) return R.fail("当前状态不允许申请换人");
        // 防重复
        long pending = replaceRequestService.count(new LambdaQueryWrapper<PlayerReplaceRequest>()
                .eq(PlayerReplaceRequest::getOrderId, id)
                .eq(PlayerReplaceRequest::getStatus, "PENDING"));
        if (pending > 0) return R.fail("已有换人申请正在处理中");
        req.setOrderId(id);
        req.setUserId(userId);
        req.setOldPlayerId(order.getPlayerId());
        req.setStatus("PENDING");
        req.setCreatedAt(java.time.LocalDateTime.now());
        replaceRequestService.save(req);
        // 通知客服
        eventPublisher.publishEvent(new BusinessEvent(this, "REPLACE_REQUEST",
                "CS", null, id, "用户申请换人，订单ID: " + id));
        return R.ok();
    }
}
