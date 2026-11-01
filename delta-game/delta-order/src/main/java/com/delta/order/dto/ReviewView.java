package com.delta.order.dto;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class ReviewView {
    private Long id;
    private Long playerId;
    private String playerName;
    private Integer rating;
    private String content;
    private String images;
    private LocalDateTime createdAt;
    private String userNickname;
    private String userAvatar;
    private String productName;
}
