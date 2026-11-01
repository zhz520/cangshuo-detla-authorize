package com.delta.admin.platform;

import com.delta.common.exception.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class PlatformServiceTest {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final Instant now = Instant.parse("2026-11-01T00:00:00Z");
    private KeyPair keys;
    private PlatformProperties properties;
    private PlatformService platform;

    @BeforeEach void setup() throws Exception {
        keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        var publicKey = directory.resolve("public.pem");
        Files.writeString(publicKey, "-----BEGIN PUBLIC KEY-----\n" + Base64.getEncoder().encodeToString(keys.getPublic().getEncoded()) + "\n-----END PUBLIC KEY-----\n");
        properties = new PlatformProperties(); properties.setStatePath(directory.resolve("state.json").toString()); properties.setPublicKeyPath(publicKey.toString());
        platform = service(now);
    }
    private PlatformService service(Instant time) { return new PlatformService(properties, json, Clock.fixed(time, ZoneOffset.UTC)); }
    private PlatformLicense.Envelope signed(String customer, String instance, Instant issuedAt, Instant start, Instant end, List<String> features) throws Exception {
        var claims = new PlatformLicense.Claims(UUID.randomUUID().toString(), customer, instance, issuedAt, start, end, features);
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(claims));
        var signature = Signature.getInstance("Ed25519"); signature.initSign(keys.getPrivate());
        signature.update((PlatformLicense.FORMAT + "." + payload).getBytes(StandardCharsets.UTF_8));
        return new PlatformLicense.Envelope(PlatformLicense.FORMAT, payload, Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign()));
    }
    private PlatformLicense.Envelope grant() throws Exception {
        return signed("742", platform.overview().instanceId(), now, now, now.plusSeconds(3600), List.of("advanced_income_reports"));
    }
    private PlatformService.FeatureView report() { return platform.features().stream().filter(feature -> feature.id().equals("advanced_income_reports")).findFirst().orElseThrow(); }

    @Test void coreRemainsAvailableAndPaidModuleCannotBeEnabledWithoutALicense() {
        assertThat(platform.features().get(0).enabled()).isTrue(); assertThat(report().enabled()).isFalse();
        assertThatThrownBy(() -> platform.setEnabled("advanced_income_reports", true)).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> platform.requireFeature("advanced_income_reports")).isInstanceOf(BusinessException.class);
    }
    @Test void signedGrantMustBeEnabledAndSurvivesRestartAndCanBeDisabled() throws Exception {
        String instance = platform.overview().instanceId(); platform.importLicense(grant());
        assertThat(report().entitled()).isTrue(); assertThat(report().enabled()).isFalse();
        platform.setEnabled("advanced_income_reports", true); platform = service(now);
        assertThat(platform.overview().instanceId()).isEqualTo(instance); platform.requireFeature("advanced_income_reports");
        platform.setEnabled("advanced_income_reports", false);
        assertThatThrownBy(() -> platform.requireFeature("advanced_income_reports")).isInstanceOf(BusinessException.class);
    }
    @Test void rejectsForgedCrossCustomerCrossInstanceAndUnknownFeatureGrants() throws Exception {
        var grant = grant();
        String changed = Base64.getUrlEncoder().withoutPadding().encodeToString(new String(Base64.getUrlDecoder().decode(grant.payload()), StandardCharsets.UTF_8).replace("742", "743").getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> platform.importLicense(new PlatformLicense.Envelope(grant.format(),changed,grant.signature()))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> platform.importLicense(signed("743",platform.overview().instanceId(),now,now,now.plusSeconds(60),List.of("advanced_income_reports")))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> platform.importLicense(signed("742",UUID.randomUUID().toString(),now,now,now.plusSeconds(60),List.of("advanced_income_reports")))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> platform.importLicense(signed("742",platform.overview().instanceId(),now,now,now.plusSeconds(60),List.of("not_a_feature")))).isInstanceOf(BusinessException.class);
        assertThat(platform.overview().licenseStatus()).isEqualTo("NONE");
    }
    @Test void expiredLicenseImmediatelyBlocksPaidApiButLeavesCoreAvailable() throws Exception {
        platform.importLicense(grant()); platform.setEnabled("advanced_income_reports", true); platform = service(now.plusSeconds(3600));
        assertThat(platform.overview().licenseStatus()).isEqualTo("EXPIRED");
        assertThatThrownBy(() -> platform.requireFeature("advanced_income_reports")).isInstanceOf(BusinessException.class);
        assertThat(platform.features().get(0).enabled()).isTrue();
    }
    @Test void futureGrantCannotBeEnabledBeforeItsStartAndOldGrantCannotReplaceNewerOne() throws Exception {
        var future = signed("742",platform.overview().instanceId(),now,now.plusSeconds(60),now.plusSeconds(3600),List.of("advanced_income_reports"));
        platform.importLicense(future);
        assertThat(platform.overview().licenseStatus()).isEqualTo("NOT_YET_VALID");
        assertThatThrownBy(() -> platform.setEnabled("advanced_income_reports",true)).isInstanceOf(BusinessException.class);
        platform = service(now.plusSeconds(61));
        platform.setEnabled("advanced_income_reports",true);
        assertThatThrownBy(() -> platform.importLicense(signed("742",platform.overview().instanceId(),now.minusSeconds(1),now,now.plusSeconds(3600),List.of("advanced_income_reports")))).isInstanceOf(BusinessException.class);
    }
    @Test void localSwitchTamperingDoesNotGrantAccessAndCorruptStateIsNotRecreated() throws Exception {
        platform.overview();
        Path state = Path.of(properties.getStatePath());
        var original = Files.readString(state);
        Files.writeString(state, original.replace("\"enabledFeatures\":[]", "\"enabledFeatures\":[\"advanced_income_reports\"]"));
        assertThatThrownBy(() -> platform.requireFeature("advanced_income_reports")).isInstanceOf(BusinessException.class);
        Files.writeString(state,"broken");
        assertThatThrownBy(() -> platform.overview()).isInstanceOf(BusinessException.class);
        assertThat(Files.readString(state)).isEqualTo("broken");
    }
    @Test void missingPublicKeyCannotTurnIntoATrialOrSelfIssuedLicense() throws Exception {
        var grant = grant(); properties.setPublicKeyPath("");
        assertThatThrownBy(() -> platform.importLicense(grant)).isInstanceOf(BusinessException.class);
        assertThat(report().entitled()).isFalse(); assertThat(platform.updates().automaticUpdateAvailable()).isFalse();
    }
    @Test void invalidReplacementLeavesPreviousLicenseAndSettingsIntact() throws Exception {
        platform.importLicense(grant()); platform.setEnabled("advanced_income_reports",true);
        String before = Files.readString(Path.of(properties.getStatePath()));
        assertThatThrownBy(() -> platform.importLicense(new PlatformLicense.Envelope("bad","bad","bad"))).isInstanceOf(BusinessException.class);
        assertThat(Files.readString(Path.of(properties.getStatePath()))).isEqualTo(before); platform.requireFeature("advanced_income_reports");
    }
}
