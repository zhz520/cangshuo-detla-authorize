package com.delta.admin;

import com.delta.common.enums.UserTypeEnum;
import com.delta.common.exception.BusinessException;
import com.delta.common.redis.service.RedisService;
import com.delta.common.security.service.RateLimitService;
import com.delta.common.security.service.TokenService;
import com.delta.common.security.utils.AdminRolePolicy;
import com.delta.cs.dto.AdminLoginRequest;
import com.delta.cs.dto.AdminLoginResponse;
import com.delta.cs.service.impl.AdminAuthServiceImpl;
import com.delta.system.entity.Admin;
import com.delta.system.service.AdminService;
import com.delta.system.service.OperationLogService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAuthServiceTest {
    @Mock AdminService admins;
    @Mock PasswordEncoder passwords;
    @Mock TokenService tokens;
    @Mock OperationLogService operationLogs;
    @Mock RedisService redis;
    @Mock RateLimitService limits;
    @InjectMocks AdminAuthServiceImpl auth;

    @Test
    void accountRoleIsAuthoritativeForLegacyClients() {
        Admin account = account(" cs ", 1);
        when(admins.getOne(any())).thenReturn(account);
        when(passwords.matches("Abcd1234", "hash")).thenReturn(true);
        when(redis.hasKey(anyString())).thenReturn(false);
        when(tokens.createToken(7L, UserTypeEnum.CS)).thenReturn("token");

        AdminLoginRequest request = new AdminLoginRequest();
        request.setUsername("  example.user  ");
        request.setPassword("Abcd1234");
        request.setRole("ADMIN"); // old cached page may still send the wrong selection
        AdminLoginResponse response = auth.login(request);

        assertThat(response.getRole()).isEqualTo("CS");
        assertThat(response.getToken()).isEqualTo("token");
        assertThat(response.getAdminId()).isEqualTo(7L);
    }

    @Test
    void mixedCaseAdminRoleResolvesToAdmin() {
        Admin account = account("admin", 1);
        when(admins.getOne(any())).thenReturn(account);
        when(passwords.matches("Abcd1234", "hash")).thenReturn(true);
        when(redis.hasKey(anyString())).thenReturn(false);
        when(tokens.createToken(7L, UserTypeEnum.ADMIN)).thenReturn("admin-token");

        AdminLoginRequest request = new AdminLoginRequest();
        request.setUsername("example.user");
        request.setPassword("Abcd1234");

        assertThat(auth.login(request).getRole()).isEqualTo("ADMIN");
    }

    @Test
    void invalidDatabaseRoleCannotAuthenticate() {
        when(admins.getOne(any())).thenReturn(account("UNKNOWN", 1));
        when(passwords.matches("Abcd1234", "hash")).thenReturn(true);
        when(redis.hasKey(anyString())).thenReturn(false);
        AdminLoginRequest request = new AdminLoginRequest();
        request.setUsername("example.user");
        request.setPassword("Abcd1234");

        assertThatThrownBy(() -> auth.login(request))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("角色配置无效");
    }

    @Test
    void rolePolicyNormalizesOnlySupportedValues() {
        assertThat(AdminRolePolicy.normalize(" Admin ")).isEqualTo("ADMIN");
        assertThat(AdminRolePolicy.normalize("cs")).isEqualTo("CS");
        assertThat(AdminRolePolicy.effectiveRole("both")).isEqualTo("ADMIN");
        assertThatThrownBy(() -> AdminRolePolicy.normalize("root")).isInstanceOf(BusinessException.class);
    }

    private static Admin account(String role, int status) {
        Admin admin = new Admin();
        admin.setId(7L);
        admin.setNickname("测试账号");
        admin.setPassword("hash");
        admin.setRole(role);
        admin.setStatus(status);
        admin.setLoginFailCount(0);
        return admin;
    }
}
