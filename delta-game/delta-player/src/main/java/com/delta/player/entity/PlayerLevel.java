package com.delta.player.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.delta.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("player_level")
public class PlayerLevel extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Integer id;
    private String name;
    private Integer sortOrder;
    private Integer status;
    private Integer grabCaptchaRequired;
    /** 指定该等级下单时的涨价百分比，10 表示涨价 10%。 */
    private java.math.BigDecimal priceIncreaseRate;
    @TableLogic
    private Integer deleted;
}
