package com.delta.admin.reward;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** Customer receipt excludes the player's wallet balance and internal management fields. */
public record RewardReceipt(Long id,Long orderId,BigDecimal amount,BigDecimal fee,BigDecimal income,String status,LocalDateTime createdAt) {
    public static RewardReceipt from(Reward reward) {
        return reward==null?null:new RewardReceipt(reward.getId(),reward.getOrderId(),reward.getAmount(),reward.getFee(),reward.getIncome(),reward.getStatus(),reward.getCreatedAt());
    }
}
