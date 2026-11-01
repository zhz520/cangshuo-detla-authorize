package com.delta.order.dto;

import jakarta.validation.constraints.*;

public record ReviewCreateRequest(
        @NotNull Long orderId,
        @NotNull @Min(1) @Max(5) Integer rating,
        @NotBlank @Size(max = 500) String content,
        @Size(max = 4096) String images) {}
