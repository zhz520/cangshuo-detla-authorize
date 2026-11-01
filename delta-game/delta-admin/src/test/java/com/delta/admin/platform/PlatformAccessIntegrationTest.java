package com.delta.admin.platform;

import com.delta.common.config.SecurityConfig;
import com.delta.common.exception.GlobalExceptionHandler;
import com.delta.common.mapper.StatsMapper;
import com.delta.common.security.filter.JwtAuthenticationFilter;
import com.delta.common.security.handler.*;
import com.delta.common.security.service.TokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.*;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes=PlatformAccessIntegrationTest.Config.class, properties={
    "spring.profiles.active=test", "spring.datasource.url=jdbc:h2:mem:platform-access;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.datasource.type=com.zaxxer.hikari.HikariDataSource", "platform.state-path=${java.io.tmpdir}/platform-access/state.json"
})
@AutoConfigureMockMvc
class PlatformAccessIntegrationTest {
    @Configuration
    @EnableAutoConfiguration(excludeName="com.alibaba.druid.spring.boot3.autoconfigure.DruidDataSourceAutoConfigure")
    @Import({SecurityConfig.class,JwtAuthenticationFilter.class,AuthenticationEntryPointImpl.class,AccessDeniedHandlerImpl.class,
            GlobalExceptionHandler.class,PlatformProperties.class,PlatformService.class,PlatformController.class,IncomeAnalysisService.class})
    static class Config {}
    @MockBean TokenService tokens;
    @MockBean StatsMapper statistics;
    @Autowired MockMvc mvc;

    @Test void anonymousAndNonAdminCannotReadOrModifyLicenses() throws Exception {
        mvc.perform(get("/admin/platform/features")).andExpect(status().isUnauthorized());
        for (String role : new String[]{"CS","USER","PLAYER"}) {
            mvc.perform(get("/admin/platform/overview").with(user("test").roles(role))).andExpect(status().isForbidden());
            mvc.perform(post("/admin/platform/license/import").with(user("test").roles(role)).contentType("application/json").content("{}"))
                    .andExpect(status().isForbidden());
            mvc.perform(put("/admin/platform/features/advanced_income_reports/enabled").with(user("test").roles(role)).contentType("application/json").content("{\"enabled\":true}"))
                    .andExpect(status().isForbidden());
        }
    }
    @Test void adminCanViewCatalogButCannotUseUnlicensedReportOrFakeAnInstall() throws Exception {
        mvc.perform(get("/admin/platform/features").with(user("admin").roles("ADMIN"))).andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data[0].enabled").value(true)).andExpect(jsonPath("$.data[1].enabled").value(false));
        mvc.perform(get("/admin/platform/reports/income").param("startDate","2026-10-01").param("endDate","2026-10-02").with(user("admin").roles("ADMIN")))
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/admin/platform/updates").with(user("admin").roles("ADMIN")))
                .andExpect(jsonPath("$.data.automaticUpdateAvailable").value(false)).andExpect(jsonPath("$.data.status").value("NOT_CONFIGURED"));
    }
}
