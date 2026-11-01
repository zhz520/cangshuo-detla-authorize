package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.*;
import java.util.Set;
import java.util.UUID;

/** Instance-local commercial state, separate from customer business tables. */
final class PlatformStateStore {
    record State(int formatVersion, String instanceId, PlatformLicense.Envelope license, Set<String> enabledFeatures) {}
    private final Path path;
    private final ObjectMapper json;

    PlatformStateStore(String path, ObjectMapper json) {
        this.path = Path.of(path).toAbsolutePath().normalize();
        this.json = json;
    }

    State load() {
        if (!Files.exists(path)) {
            var state = new State(1, UUID.randomUUID().toString(), null, Set.of());
            save(state);
            return state;
        }
        try {
            if (Files.size(path) > 65536) throw new IOException("State too large");
            var state = json.readValue(path.toFile(), State.class);
            if (state.formatVersion() != 1 || state.enabledFeatures() == null) throw new IOException("Invalid state");
            UUID.fromString(state.instanceId());
            return state;
        } catch (Exception error) {
            throw new BusinessException(503, "功能授权状态无法读取，请联系维护人员；原有业务功能不受影响");
        }
    }

    void save(State state) {
        Path temporary = null;
        try {
            Files.createDirectories(path.getParent());
            temporary = Files.createTempFile(path.getParent(), ".platform-", ".json");
            Files.write(temporary, json.writeValueAsBytes(state));
            Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException error) {
            throw new BusinessException(503, "功能授权状态保存失败，请检查实例存储权限");
        } finally {
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
        }
    }
}
