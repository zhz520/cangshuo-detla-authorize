package com.delta.admin.platform;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

public final class PlatformLicense {
    private PlatformLicense() {}
    public static final String FORMAT = "delta-license-v1";

    public record Envelope(@NotBlank @Size(max=32) String format,
                           @NotBlank @Size(max=24000) String payload,
                           @NotBlank @Size(max=128) String signature) {}
    public record Claims(String licenseId, String customerId, String instanceId,
                         Instant issuedAt, Instant notBefore, Instant expiresAt, List<String> features) {}
}
