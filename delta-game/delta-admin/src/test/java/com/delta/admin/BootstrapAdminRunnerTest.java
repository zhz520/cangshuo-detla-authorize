package com.delta.admin;

import com.delta.admin.config.BootstrapAdminRunner;
import com.delta.common.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class BootstrapAdminRunnerTest {
    @Test void createsOnlyANewAdministratorWithAnEncodedPassword() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var encoder = new BCryptPasswordEncoder();
        when(jdbc.queryForObject("SELECT COUNT(*) FROM admin", Long.class)).thenReturn(0L);
        new BootstrapAdminRunner(jdbc, encoder, "admin", "Fresh742Password").run(null);
        verify(jdbc).update(anyString(), eq("admin"),
                argThat((String hash) -> encoder.matches("Fresh742Password", hash)), eq("平台管理员"));
    }

    @Test void neverResetsOrAddsAccountsWhenTheDatabaseAlreadyHasAnAdministrator() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT COUNT(*) FROM admin", Long.class)).thenReturn(1L);
        new BootstrapAdminRunner(jdbc, new BCryptPasswordEncoder(), "admin", "").run(null);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void refusesAnInvalidInitialPassword() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT COUNT(*) FROM admin", Long.class)).thenReturn(0L);
        assertThatThrownBy(() -> new BootstrapAdminRunner(jdbc, new BCryptPasswordEncoder(), "admin", "123")
                .run(null)).isInstanceOf(BusinessException.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
