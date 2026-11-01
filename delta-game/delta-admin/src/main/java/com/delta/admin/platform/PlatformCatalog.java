package com.delta.admin.platform;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import java.io.IOException;
import java.util.List;

public record PlatformCatalog(String version, String channel, int schemaVersion,
                              List<Feature> features, List<String> releaseNotes) {
    public record Feature(String id, String name, String description, boolean paid, String minVersion,
                          List<String> dependencies, String entryPath, List<String> capabilities) {}

    public static PlatformCatalog load(ObjectMapper json) {
        try (var stream = new ClassPathResource("platform/catalog.json").getInputStream()) {
            return json.readValue(stream, PlatformCatalog.class);
        } catch (IOException error) {
            throw new IllegalStateException("系统功能目录无法加载", error);
        }
    }
}
