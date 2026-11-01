package com.delta.order.dto;

import lombok.Data;
import java.math.BigDecimal;

@Data
public class OrderQuote {
    private Long productId;
    private String productName;
    private Long designatedPlayerId;
    private Integer playerLevelId;
    private String playerLevelName;
    private BigDecimal baseAmount;
    private BigDecimal priceIncreaseRate;
    private BigDecimal priceIncreaseAmount;
    private BigDecimal amount;
}
