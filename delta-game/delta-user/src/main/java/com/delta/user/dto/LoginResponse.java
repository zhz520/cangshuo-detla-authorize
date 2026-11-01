package com.delta.user.dto;

import lombok.Data;

@Data
public class LoginResponse {
    private String token;
    private Long userId;
    private String nickname;
    private String avatar;
    private Boolean passwordSetupRequired;
    private String setupToken;
}
