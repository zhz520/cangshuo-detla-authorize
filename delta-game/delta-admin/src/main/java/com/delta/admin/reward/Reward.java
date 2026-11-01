package com.delta.admin.reward;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@TableName("player_reward")
public class Reward {
    @TableId(type=IdType.AUTO) private Long id;
    private String rewardNo;
    private String requestId;
    private Long userId;
    private Long playerId;
    private Long orderId;
    private String orderNo;
    private BigDecimal amount;
    private BigDecimal fee;
    private BigDecimal income;
    private BigDecimal feePercent;
    private BigDecimal userBalanceBefore;
    private BigDecimal userBalanceAfter;
    private BigDecimal playerBalanceBefore;
    private BigDecimal playerBalanceAfter;
    private BigDecimal reversalUserBalanceBefore;
    private BigDecimal reversalUserBalanceAfter;
    private BigDecimal reversalPlayerBalanceBefore;
    private BigDecimal reversalPlayerBalanceAfter;
    private String paymentMethod;
    private String remark;
    private String status;
    private BigDecimal pendingRecovery;
    private String reversalReason;
    private Long reversalAdminId;
    private LocalDateTime reversedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
