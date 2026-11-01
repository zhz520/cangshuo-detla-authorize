package com.delta.admin;

import com.delta.common.enums.UserTypeEnum;
import com.delta.common.exception.BusinessException;
import com.delta.common.redis.service.RedisService;
import com.delta.common.security.service.TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TokenRoleCaseTest {
    @Mock RedisService redis;
    @Mock JdbcTemplate jdbc;
    private TokenService tokens;

    @BeforeEach
    void setUp() {
        tokens = new TokenService();
        ReflectionTestUtils.setField(tokens, "secret", "test-secret-that-is-long-enough-for-hs256-signing-123456");
        ReflectionTestUtils.setField(tokens, "expiration", 60_000L);
        ReflectionTestUtils.setField(tokens, "redisService", redis);
        ReflectionTestUtils.setField(tokens, "jdbc", jdbc);
    }

    @Test
    void lowerCaseCsRoleCanReceiveCsToken() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(admin("cs")));
        assertThat(tokens.createToken(5L, UserTypeEnum.CS)).isNotBlank();
    }

    @Test
    void lowerCaseAdminRoleCanReceiveAdminToken() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(admin("admin")));
        assertThat(tokens.createToken(5L, UserTypeEnum.ADMIN)).isNotBlank();
    }

    @Test
    void csRoleCannotReceiveAdminToken() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(admin("CS")));
        assertThatThrownBy(() -> tokens.createToken(5L, UserTypeEnum.ADMIN))
                .isInstanceOf(BusinessException.class);
    }

    private static Map<String, Object> admin(String role) {
        Map<String, Object> row = new HashMap<>();
        row.put("status", 1);
        row.put("role", role);
        row.put("password", "hash");
        row.put("phone", "");
        row.put("openid", null);
        row.put("auth_version", 1);
        return row;
    }
}
