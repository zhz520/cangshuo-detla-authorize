package com.delta.user.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class PasswordLoginRequest {
    @NotBlank @Pattern(regexp="1[0-9]{10}") private String phone;
    @NotBlank @Size(max=72) @lombok.ToString.Exclude private String password;
    @NotBlank @Size(max=36) private String captchaId;
    @NotBlank @Pattern(regexp="[0-9]{6}") private String captchaCode;
}
