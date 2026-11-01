package com.delta.admin.platform;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "platform")
public class PlatformProperties {
    private String customerId = "742";
    private String statePath = "./.local/platform/state.json";
    private String publicKeyPath = "";
}
