package com.delta.common.domain;

import lombok.Data;
import java.math.BigDecimal;

@Data
public class PlayerPriceConfig {
    private Long playerId;
    private Integer levelId;
    private String levelName;
    private BigDecimal priceIncreaseRate;
}
