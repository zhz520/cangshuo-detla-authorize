package com.delta.user.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.delta.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.math.BigDecimal;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("user")
public class User extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String openid;
    private String nickname;
    private String avatar;
    private String phone;
    @com.fasterxml.jackson.annotation.JsonIgnore
    @lombok.ToString.Exclude
    private String password;
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Long authVersion;
    public boolean isPasswordSet() { return password!=null && !password.isBlank(); }
    private Integer status;
    @TableLogic
    private Integer deleted;

    /** 余额（非DB字段） */
    @TableField(exist = false)
    private BigDecimal balance;
}
