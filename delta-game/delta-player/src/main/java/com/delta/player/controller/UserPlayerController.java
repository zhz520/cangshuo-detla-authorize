package com.delta.player.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.domain.PageQuery;
import com.delta.common.domain.R;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import com.delta.player.entity.Player;
import com.delta.player.service.PlayerService;
import com.delta.system.service.SysConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 面向普通用户的打手查询与指定接口
 * 路径挂在 /order 下，与前端 api/order.js 对应
 */
@RestController
@RequestMapping("/order")
@RequiredArgsConstructor
public class UserPlayerController {
    private final PlayerService playerService;
    private final OrderService orderService;
    private final CrossModuleMapper crossModuleMapper;
    private final SysConfigService sysConfigService;
    private final com.delta.player.service.PlayerDirectoryService directory;
    private final com.delta.order.service.OrderPricingService pricing;

    @GetMapping("/available-players")
    public R<Map<String, Object>> availablePlayers(PageQuery query,
                                                    @RequestParam(value = "keyword", required = false) String keyword) {
        LambdaQueryWrapper<Player> w = directory.visibleQuery()
                .and(keyword != null && !keyword.isEmpty(), qw -> qw.like(Player::getNickname, keyword))
                .orderByDesc(Player::getAvgRating);
        Page<Player> page = playerService.page(new Page<>(query.getPageNum(), query.getPageSize()), w);
        // 使用公开字段白名单，避免将打手身份和财务资料返回给下单用户。
        java.util.List<Map<String,Object>> records=page.getRecords().stream().map(p -> {
            Map<String,Object> row=new java.util.LinkedHashMap<>();
            var view=directory.view(p);
            row.put("id",p.getId());row.put("nickname",p.getNickname());row.put("avatar",p.getAvatar());
            row.put("levelName",view.getLevelName());row.put("priceIncreaseRate",view.getPriceIncreaseRate());
            row.put("isOnline",p.getIsOnline());row.put("avgRating",p.getAvgRating());
            row.put("completedOrders",crossModuleMapper.selectPlayerCompletedOrders(p.getId()));
            row.put("activeOrders",crossModuleMapper.selectPlayerActiveOrders(p.getId()));
            return row;
        }).toList();
        int maxConcurrent = Integer.parseInt(sysConfigService.getConfigValue("order.max_active_per_player", "5"));
        Map<String, Object> result = new HashMap<>();
        Page<Map<String,Object>> safePage=new Page<>(page.getCurrent(),page.getSize(),page.getTotal());
        safePage.setRecords(records);result.put("players", safePage);
        result.put("maxConcurrent", maxConcurrent);
        return R.ok(result);
    }

    /** 指定打手并直接指派（订单 PAID 且未分配时可用） */
    @PostMapping("/{id}/designate-player")
    public R<Void> designatePlayer(@PathVariable Long id, @RequestBody Map<String, Long> body) {
        Long userId = SecurityUtils.getUserId();
        Order order = orderService.getById(id);
        if (order == null) return R.fail("订单不存在");
        if (!order.getUserId().equals(userId)) return R.fail("无权操作");
        if (!"PAID".equals(order.getStatus())) return R.fail("当前状态不允许指定打手");
        if (order.getPlayerId() != null) return R.fail("订单已分配打手，无需重复指定");
        Long playerId = body.get("playerId");
        if (playerId == null) return R.fail("请选择打手");
        var quote=pricing.quote(order.getProductId(),playerId,null);
        java.math.BigDecimal paidRate=order.getPriceIncreaseRate()==null?java.math.BigDecimal.ZERO:order.getPriceIncreaseRate();
        if(quote.getPriceIncreaseRate().compareTo(paidRate)>0)
            return R.fail(400,"所选打手需要加价，请在下单时选择该打手");
        orderService.assignOrder(id, playerId);
        return R.ok();
    }
}
