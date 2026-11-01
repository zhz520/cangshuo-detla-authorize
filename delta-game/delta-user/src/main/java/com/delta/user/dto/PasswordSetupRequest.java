package com.delta.user.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class PasswordSetupRequest {
    @NotBlank @Pattern(regexp="[A-Za-z0-9_-]{43}") @lombok.ToString.Exclude private String setupToken;
    @NotBlank @Size(max=72) @lombok.ToString.Exclude private String password;
    @NotBlank @Size(max=72) @lombok.ToString.Exclude private String confirmation;
}
