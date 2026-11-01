package com.delta.common.utils;

import com.delta.common.exception.BusinessException;
import java.math.BigDecimal;

public final class Money {
    private Money() {}
    public static BigDecimal positive(BigDecimal amount) {
        if(amount==null || amount.signum()<=0 || amount.compareTo(new BigDecimal("1000000"))>0 || amount.stripTrailingZeros().scale()>2)
            throw new BusinessException(400,"金额须大于0、最多两位小数且不超过100万元");
        return amount;
    }
    public static int cents(BigDecimal amount) {return positive(amount).movePointRight(2).intValueExact();}
}
