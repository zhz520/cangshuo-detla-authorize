package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.*;

final class LicenseVerifier {
    private final PlatformProperties properties;
    private final ObjectMapper json;
    private final Set<String> featureIds;

    LicenseVerifier(PlatformProperties properties, ObjectMapper json, PlatformCatalog catalog) {
        this.properties = properties;
        this.json = json.copy().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        this.featureIds = new HashSet<>(catalog.features().stream().map(PlatformCatalog.Feature::id).toList());
    }

    boolean configured() { return properties.getPublicKeyPath() != null && !properties.getPublicKeyPath().isBlank(); }

    PlatformLicense.Claims verify(PlatformLicense.Envelope envelope, String instanceId, Instant now) {
        if (!configured()) throw new BusinessException(503, "尚未配置授权验证公钥，请联系系统维护人员");
        try {
            if (envelope == null || !PlatformLicense.FORMAT.equals(envelope.format())
                    || envelope.payload() == null || envelope.payload().length() > 24000
                    || !envelope.payload().matches("[A-Za-z0-9_-]+")
                    || envelope.signature() == null || envelope.signature().length() > 128
                    || !envelope.signature().matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException();
            Path keyPath = Path.of(properties.getPublicKeyPath());
            if (Files.size(keyPath) > 4096) throw new IllegalArgumentException();
            String pem = Files.readString(keyPath).replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
            var key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem)));
            var signature = Signature.getInstance("Ed25519");
            signature.initVerify(key);
            signature.update((PlatformLicense.FORMAT + "." + envelope.payload()).getBytes(StandardCharsets.UTF_8));
            byte[] signed = Base64.getUrlDecoder().decode(envelope.signature());
            if (signed.length != 64 || !signature.verify(signed)) throw new IllegalArgumentException();
            var claims = json.readValue(Base64.getUrlDecoder().decode(envelope.payload()), PlatformLicense.Claims.class);
            UUID.fromString(claims.licenseId());
            if (!Objects.equals(properties.getCustomerId(), claims.customerId())
                    || !Objects.equals(instanceId, claims.instanceId()) || claims.issuedAt() == null
                    || claims.notBefore() == null || claims.issuedAt().isAfter(now.plusSeconds(300))
                    || (claims.expiresAt() != null && !claims.expiresAt().isAfter(claims.notBefore()))
                    || claims.features() == null || claims.features().isEmpty() || claims.features().size() > 50
                    || !featureIds.containsAll(claims.features())
                    || new HashSet<>(claims.features()).size() != claims.features().size()) throw new IllegalArgumentException();
            return claims;
        } catch (Exception error) {
            throw new BusinessException(400, "授权签名、客户编号或实例信息不匹配，请使用本实例的有效授权文件");
        }
    }
}
