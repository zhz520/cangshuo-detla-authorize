package com.delta.player.dto;

import lombok.Data;
import java.math.BigDecimal;

@Data
public class PlayerProfileVO {
    private Long id;
    private String nickname;
    private String avatar;
    private String realName;
    private String phone;
    private String status;
    private String gameLevel;
    private Integer level;
    private String introduction;
    private String levelName;
    private String coverImage;
    private java.util.List<String> albumImages;
    private String story;
    private String voiceUrl;
    private Integer voiceDuration;
    private BigDecimal avgRating;
    private Integer orderCount;
    private BigDecimal completeRate;
    private BigDecimal balance;
    private BigDecimal totalIncome;
    private Integer isOnline;
}
