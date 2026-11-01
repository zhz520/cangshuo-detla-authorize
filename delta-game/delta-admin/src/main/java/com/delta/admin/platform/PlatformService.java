package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.time.Clock;
import java.time.Instant;
import java.util.*;

@Service
public class PlatformService {
    private final PlatformProperties properties;
    private final PlatformCatalog catalog;
    private final PlatformStateStore store;
    private final LicenseVerifier verifier;
    private final Clock clock;

    @Autowired
    public PlatformService(PlatformProperties properties, ObjectMapper json) {
        this(properties, json, Clock.systemUTC());
    }
    PlatformService(PlatformProperties properties, ObjectMapper json, Clock clock) {
        this.properties = properties;
        this.catalog = PlatformCatalog.load(json);
        this.store = new PlatformStateStore(properties.getStatePath(), json);
        this.verifier = new LicenseVerifier(properties, json, catalog);
        this.clock = clock;
    }

    public record FeatureView(String id, String name, String description, boolean paid, String minVersion,
                              List<String> dependencies, String entryPath, List<String> capabilities,
                              String status, boolean entitled, boolean enabled, String reason) {}
    public record Overview(String customerId, String instanceId, String version, String channel,
                           boolean verifierConfigured, String licenseStatus, String licenseId, Instant expiresAt,
                           String purchaseMode, String updateMode) {}
    public record UpdateInfo(String version, String channel, int schemaVersion, List<String> releaseNotes,
                             boolean automaticUpdateAvailable, String status, String message) {}

    public synchronized Overview overview() {
        var state = store.load();
        var claims = claims(state);
        return new Overview(properties.getCustomerId(), state.instanceId(), catalog.version(), catalog.channel(),
                verifier.configured(), licenseStatus(state, claims), claims == null ? null : claims.licenseId(),
                claims == null ? null : claims.expiresAt(), "MANUAL", "MANUAL");
    }

    public synchronized List<FeatureView> features() {
        var state = store.load();
        var claims = claims(state);
        return catalog.features().stream().map(feature -> view(feature, state, claims)).toList();
    }

    public UpdateInfo updates() {
        return new UpdateInfo(catalog.version(), catalog.channel(), catalog.schemaVersion(), catalog.releaseNotes(),
                false, "NOT_CONFIGURED", "尚未连接正式版本源与更新代理，请由维护人员执行版本更新。");
    }

    public synchronized Overview importLicense(PlatformLicense.Envelope envelope) {
        var state = store.load();
        var next = verifier.verify(envelope, state.instanceId(), clock.instant());
        if (next.expiresAt() != null && !next.expiresAt().isAfter(clock.instant()))
            throw new BusinessException(400, "该授权已经到期，请联系维护人员续期");
        var previous = claims(state);
        if (previous != null && (next.issuedAt().isBefore(previous.issuedAt())
                || (next.issuedAt().equals(previous.issuedAt()) && !next.licenseId().equals(previous.licenseId()))))
            throw new BusinessException(409, "不能使用旧授权覆盖当前授权，请联系维护人员重新签发");
        var enabled = new HashSet<>(state.enabledFeatures());
        enabled.retainAll(next.features());
        store.save(new PlatformStateStore.State(1, state.instanceId(), envelope, enabled));
        return overview();
    }

    public synchronized List<FeatureView> setEnabled(String id, boolean enabled) {
        var feature = catalog.features().stream().filter(item -> item.id().equals(id)).findFirst()
                .orElseThrow(() -> new BusinessException(404, "功能模块不存在"));
        if (!feature.paid()) throw new BusinessException(400, "基础业务功能始终可用，无需开关");
        var state = store.load();
        var claims = claims(state);
        var current = view(feature, state, claims);
        if (enabled && !current.entitled()) throw new BusinessException(403, current.reason());
        if (enabled && !feature.dependencies().stream().allMatch(dependency -> {
            var item = catalog.features().stream().filter(value -> value.id().equals(dependency)).findFirst().orElseThrow();
            return view(item, state, claims).enabled();
        })) throw new BusinessException(409, "请先启用此功能依赖的模块");
        if (!enabled && catalog.features().stream().anyMatch(item -> state.enabledFeatures().contains(item.id()) && item.dependencies().contains(id)))
            throw new BusinessException(409, "请先关闭依赖此模块的功能");
        var selected = new HashSet<>(state.enabledFeatures());
        if (enabled) selected.add(id); else selected.remove(id);
        store.save(new PlatformStateStore.State(1, state.instanceId(), state.license(), selected));
        return features();
    }

    public synchronized void requireFeature(String id) {
        var state = store.load();
        var feature = catalog.features().stream().filter(item -> item.id().equals(id)).findFirst()
                .orElseThrow(() -> new BusinessException(404, "功能模块不存在"));
        var view = view(feature, state, claims(state));
        if (!view.enabled()) throw new BusinessException(403, view.reason());
    }

    private PlatformLicense.Claims claims(PlatformStateStore.State state) {
        if (state.license() == null) return null;
        try { return verifier.verify(state.license(), state.instanceId(), clock.instant()); }
        catch (BusinessException error) { return null; }
    }

    private String licenseStatus(PlatformStateStore.State state, PlatformLicense.Claims claims) {
        if (state.license() == null) return "NONE";
        if (claims == null) return "INVALID";
        if (clock.instant().isBefore(claims.notBefore())) return "NOT_YET_VALID";
        if (claims.expiresAt() != null && !clock.instant().isBefore(claims.expiresAt())) return "EXPIRED";
        return "VALID";
    }

    private FeatureView view(PlatformCatalog.Feature feature, PlatformStateStore.State state, PlatformLicense.Claims claims) {
        String status, reason;
        boolean entitled, enabled;
        if (!feature.paid()) { status = "INCLUDED"; entitled = true; enabled = true; reason = "基础功能已包含"; }
        else {
            String licenseStatus = licenseStatus(state, claims);
            entitled = "VALID".equals(licenseStatus) && claims.features().contains(feature.id());
            enabled = entitled && state.enabledFeatures().contains(feature.id());
            status = enabled ? "ENABLED" : entitled ? "DISABLED" : "EXPIRED".equals(licenseStatus) ? "EXPIRED" : "NOT_PURCHASED";
            reason = enabled ? "已启用" : entitled ? "已授权，尚未启用" : "EXPIRED".equals(licenseStatus)
                    ? "模块授权已到期，请联系维护人员续期" : "此功能尚未获得有效授权，请联系维护人员开通";
        }
        return new FeatureView(feature.id(), feature.name(), feature.description(), feature.paid(), feature.minVersion(),
                feature.dependencies(), feature.entryPath(), feature.capabilities(), status, entitled, enabled, reason);
    }
}
