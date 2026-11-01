package com.delta.admin.config;

import com.delta.common.security.utils.PasswordPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Explicitly enabled first-account setup for a fresh customer database. */
@Component
@ConditionalOnProperty(name = "app.bootstrap-admin.enabled", havingValue = "true")
public class BootstrapAdminRunner implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final String username;
    private final String password;

    public BootstrapAdminRunner(JdbcTemplate jdbc, PasswordEncoder encoder,
            @Value("${app.bootstrap-admin.username:admin}") String username,
            @Value("${app.bootstrap-admin.password:}") String password) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.username = username;
        this.password = password;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM admin", Long.class);
        if (count != null && count > 0) return;
        if (username == null || !username.matches("[A-Za-z0-9_]{3,64}")) {
            throw new IllegalArgumentException("首次管理员账号须为3至64位字母、数字或下划线");
        }
        PasswordPolicy.validate(password);
        jdbc.update("INSERT INTO admin (username,password,nickname,role,status) VALUES (?,?,?,'ADMIN',1)",
                username, encoder.encode(password), "平台管理员");
    }
}
