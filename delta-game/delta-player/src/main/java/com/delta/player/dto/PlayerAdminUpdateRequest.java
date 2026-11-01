package com.delta.player.dto;

import jakarta.validation.constraints.*;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper=true)
public class PlayerAdminUpdateRequest extends PlayerHomepageRequest {
    @Min(1) private Integer level;
    @Min(-1) @Max(1) private Integer grabCaptchaOverride;
    @DecimalMin("-1") @DecimalMax("100") @Digits(integer=3, fraction=2)
    private java.math.BigDecimal priceIncreaseRate;

    @AssertTrue(message="涨价比例须为-1（跟随等级）或0至100之间的百分比")
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isValidPriceIncreaseRate() {
        return priceIncreaseRate == null || priceIncreaseRate.compareTo(new java.math.BigDecimal("-1")) == 0
                || priceIncreaseRate.signum() >= 0;
    }
    @Size(max=32) private String realName;
}
