package com.delta.admin;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.delta.admin.controller.AdminReviewController;
import com.delta.admin.controller.PlayerReviewController;
import com.delta.common.config.SecurityConfig;
import com.delta.common.exception.GlobalExceptionHandler;
import com.delta.common.security.filter.JwtAuthenticationFilter;
import com.delta.common.security.handler.AccessDeniedHandlerImpl;
import com.delta.common.security.handler.AuthenticationEntryPointImpl;
import com.delta.common.security.service.TokenService;
import com.delta.order.controller.ReviewController;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import com.delta.order.service.impl.ReviewServiceImpl;
import com.delta.player.controller.PublicPlayerController;
import com.delta.player.service.PlayerWalletService;
import com.delta.player.service.impl.PlayerServiceImpl;
import com.delta.admin.controller.AdminPlayerLevelController;
import com.delta.admin.controller.AdminPlayerController;
import com.delta.player.controller.PlayerController;
import com.delta.player.controller.PublicPlayerChatController;
import com.delta.player.service.PlayerLevelService;
import com.delta.player.service.PlayerDirectoryService;
import com.delta.common.chat.service.ChatSessionService;
import com.delta.common.chat.domain.entity.ChatSession;
import com.delta.common.file.controller.FileController;
import com.delta.common.file.service.FileService;
import com.delta.pay.service.PaymentService;
import com.delta.pay.service.TransactionService;
import com.delta.user.service.UserService;
import com.delta.system.service.SysConfigService;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes=PlayerDirectoryIntegrationTest.Config.class,properties={
 "spring.profiles.active=test", "spring.datasource.url=jdbc:h2:mem:directory;MODE=MySQL;DB_CLOSE_DELAY=-1;NON_KEYWORDS=USER,LEVEL",
 "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
 "spring.datasource.type=com.zaxxer.hikari.HikariDataSource", "spring.main.allow-bean-definition-overriding=true"
})
@AutoConfigureMockMvc
@Sql(scripts="/directory-schema.sql",config=@org.springframework.test.context.jdbc.SqlConfig(encoding="UTF-8"))
class PlayerDirectoryIntegrationTest {
    @Configuration
    @EnableAutoConfiguration(excludeName={"com.alibaba.druid.spring.boot3.autoconfigure.DruidDataSourceAutoConfigure"})
    @MapperScan({"com.delta.player.mapper","com.delta.order.mapper","com.delta.common.mapper"})
    @Import({AdminPlayerController.class,AdminPlayerLevelController.class,PlayerController.class,PublicPlayerChatController.class,FileController.class,PlayerLevelService.class,PlayerDirectoryService.class,PublicPlayerController.class,PlayerReviewController.class,AdminReviewController.class,ReviewController.class,
            SecurityConfig.class,JwtAuthenticationFilter.class,AuthenticationEntryPointImpl.class,AccessDeniedHandlerImpl.class,
            GlobalExceptionHandler.class,PlayerServiceImpl.class,ReviewServiceImpl.class})
    static class Config {
        @Bean MybatisPlusInterceptor pagination() {
            MybatisPlusInterceptor plugin=new MybatisPlusInterceptor();
            plugin.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL)); return plugin;
        }
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @MockBean TokenService tokens;
    @MockBean PlayerWalletService wallets;
    @MockBean OrderService orders;
    @MockBean ChatSessionService sessions;
    @MockBean FileService files;
    @MockBean com.delta.common.security.service.RateLimitService limits;
    @MockBean PaymentService payments;
    @MockBean TransactionService transactions;
    @MockBean UserService users;
    @MockBean SysConfigService configs;
    @MockBean com.delta.system.service.FeatureAuditService featureAudit;

    private RequestPostProcessor role(String role,long id) {
        return authentication(new UsernamePasswordAuthenticationToken(Map.of("userId",id,"userType",role),null,
                List.of(new SimpleGrantedAuthority("ROLE_"+role))));
    }

    @Test void directoryFiltersLevelsAndNeverPublishesPrivateFields() throws Exception {
        mvc.perform(get("/app/players").param("level","2")).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].id").value(1));
        mvc.perform(get("/app/players/levels")).andExpect(jsonPath("$.data[0]").value(2)).andExpect(jsonPath("$.data[1]").value(1));
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.data.introduction").value("擅长团队协作"))
                .andExpect(jsonPath("$.data.phone").doesNotExist()).andExpect(jsonPath("$.data.realName").doesNotExist())
                .andExpect(jsonPath("$.data.openid").doesNotExist()).andExpect(jsonPath("$.data.balance").doesNotExist());
        mvc.perform(get("/app/players/2")).andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void userCanReadOnlyCheckTheirPlayerApplicationWithoutPlayerToken() throws Exception {
        com.delta.user.entity.User user = new com.delta.user.entity.User();
        user.setId(7L);
        user.setOpenid("private-openid");
        user.setNickname("普通用户");
        when(users.getById(7L)).thenReturn(user);

        mvc.perform(get("/player/apply/status").with(role("USER", 7)))
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.registered").value(true))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"))
                .andExpect(jsonPath("$.data.nickname").doesNotExist())
                .andExpect(jsonPath("$.data.openid").doesNotExist());
        mvc.perform(get("/player/apply/status").with(role("PLAYER", 1)))
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/player/profile").with(role("USER", 7)))
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test void reviewListExcludesDeletedAndMasksIdentity() throws Exception {
        mvc.perform(get("/app/players/1/reviews")).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].userNickname").value("张**"))
                .andExpect(jsonPath("$.data.records[0].userId").doesNotExist())
                .andExpect(jsonPath("$.data.records[0].orderId").doesNotExist());
    }

    @Test void onlyAdminsCanDeleteAndDeletingLastReviewResetsBothRatings() throws Exception {
        mvc.perform(delete("/admin/review/9")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(delete("/admin/review/9").with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(delete("/admin/review/9").with(role("CS",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(delete("/admin/review/9").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(200));
        assertThat(jdbc.queryForObject("SELECT deleted FROM review WHERE id=9",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT avg_rating FROM player WHERE id=1",Double.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT review_count FROM product WHERE id=11",Integer.class)).isZero();
        mvc.perform(get("/app/players/1/reviews")).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test void onlyOwnerOfConfirmedOrderCanReviewAndRatingIsValidated() throws Exception {
        Order order=new Order();order.setId(100L);order.setUserId(7L);order.setPlayerId(1L);order.setProductId(11L);order.setStatus("CONFIRMED");
        when(orders.getOne(any())).thenReturn(order);
        String body="{\"orderId\":100,\"rating\":5,\"content\":\"配合很好\",\"playerId\":999,\"id\":777}";
        mvc.perform(post("/order/review").with(role("USER",8)).contentType("application/json").content(body)).andExpect(jsonPath("$.msg").value("无权评价"));
        order.setStatus("IN_PROGRESS");
        mvc.perform(post("/order/review").with(role("USER",7)).contentType("application/json").content(body)).andExpect(jsonPath("$.msg").value("订单状态不允许评价"));
        order.setStatus("CONFIRMED");
        mvc.perform(post("/order/review").with(role("USER",7)).contentType("application/json").content(body.replace("\"rating\":5","\"rating\":6"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/order/review").with(role("USER",7)).contentType("application/json").content(body)).andExpect(jsonPath("$.code").value(200));
        assertThat(jdbc.queryForObject("SELECT player_id FROM review WHERE order_id=100",Long.class)).isEqualTo(1L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM review WHERE id=777",Integer.class)).isZero();
        mvc.perform(post("/order/review").with(role("USER",7)).contentType("application/json").content(body)).andExpect(jsonPath("$.msg").value("已评价，不可重复"));
    }

    @Test void reviewableOrdersRequireUserAuthentication() throws Exception {
        mvc.perform(get("/app/players/1/reviewable-orders")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(get("/app/players/1/reviewable-orders").with(role("CS",1))).andExpect(jsonPath("$.code").value(403));
        when(orders.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of());
        mvc.perform(get("/app/players/1/reviewable-orders").with(role("USER",7))).andExpect(jsonPath("$.code").value(200));
    }
    @Test void configurableCategoriesRequireAdminAndDisabledCategoriesAreHidden() throws Exception {
        mvc.perform(post("/admin/player-level").with(role("CS",1)).contentType("application/json").content("{\"name\":\"魔王护\",\"sortOrder\":5,\"status\":1}")).andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/admin/player-level/2").with(role("ADMIN",1)).contentType("application/json").content("{\"name\":\"魔王护\",\"sortOrder\":5,\"status\":1}")).andExpect(jsonPath("$.code").value(200));
        mvc.perform(get("/app/players/categories")).andExpect(jsonPath("$.data[0].name").value("魔王护"));
        mvc.perform(put("/admin/player-level/2").with(role("ADMIN",1)).contentType("application/json").content("{\"name\":\"魔王护\",\"sortOrder\":5,\"status\":0}")).andExpect(jsonPath("$.code").value(200));
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.code").value(404));
        mvc.perform(delete("/admin/player-level/2").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(400));
    }

    @Test void playerEditsOwnHomepageOnlyAndAdminAssignsConfiguredCategory() throws Exception {
        String body="{\"nickname\":\"主页新昵称\",\"level\":1,\"id\":3,\"albumImages\":[\"/file/a.jpg\"],\"story\":\"我的故事\",\"coverImage\":\"/file/cover.jpg\",\"voiceUrl\":\"/file/voice.mp3\",\"voiceDuration\":12}";
        mvc.perform(put("/player/homepage").with(role("USER",1)).contentType("application/json").content(body)).andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/player/homepage").with(role("PLAYER",1)).contentType("application/json").content(body)).andExpect(jsonPath("$.code").value(200));
        assertThat(jdbc.queryForObject("SELECT level FROM player WHERE id=1",Integer.class)).isEqualTo(2);
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.data.story").value("我的故事")).andExpect(jsonPath("$.data.albumImages[0]").value("/file/a.jpg")).andExpect(jsonPath("$.data.voiceDuration").value(12));
        mvc.perform(put("/player/homepage").with(role("PLAYER",1)).contentType("application/json").content("{\"voiceDuration\":61}")).andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/player/homepage").with(role("PLAYER",1)).contentType("application/json").content("{\"coverImage\":\"javascript:bad\"}")).andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/admin/player/1").with(role("ADMIN",1)).contentType("application/json").content("{\"level\":9999}")).andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/admin/player/1").with(role("ADMIN",1)).contentType("application/json").content("{\"level\":1}")).andExpect(jsonPath("$.code").value(200));
    }

    @Test void onlyAdminCanConfigurePriceAndPlayerCannotOverrideIt() throws Exception {
        String level="{\"name\":\"金牌打手\",\"sortOrder\":10,\"status\":1,\"priceIncreaseRate\":10}";
        mvc.perform(put("/admin/player-level/2").with(role("CS",1)).contentType("application/json").content(level))
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/admin/player-level/2").with(role("ADMIN",1)).contentType("application/json").content(level))
                .andExpect(jsonPath("$.data.priceIncreaseRate").value(10));
        mvc.perform(put("/admin/player-level/2").with(role("ADMIN",1)).contentType("application/json").content(level.replace(":10}",":101}")))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.data.priceIncreaseRate").value(10));
        mvc.perform(put("/admin/player/1").with(role("ADMIN",1)).contentType("application/json").content("{\"priceIncreaseRate\":15}"))
                .andExpect(jsonPath("$.code").value(200));
        mvc.perform(put("/player/homepage").with(role("PLAYER",1)).contentType("application/json").content("{\"priceIncreaseRate\":0}"))
                .andExpect(jsonPath("$.code").value(200));
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.data.priceIncreaseRate").value(15));
        mvc.perform(put("/admin/player/1").with(role("ADMIN",1)).contentType("application/json").content("{\"priceIncreaseRate\":-0.5}"))
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/admin/player/1").with(role("ADMIN",1)).contentType("application/json").content("{\"priceIncreaseRate\":-1}"))
                .andExpect(jsonPath("$.code").value(200));
        mvc.perform(get("/app/players/1")).andExpect(jsonPath("$.data.priceIncreaseRate").value(10));
    }

    @Test void directChatUsesAuthenticatedUserAndActiveTargetWithoutAnOrder() throws Exception {
        ChatSession session=new ChatSession();session.setId(123L);
        when(sessions.findOrCreate(1000000007L,2000000001L)).thenReturn(session);
        mvc.perform(post("/app/players/1/chat")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(post("/app/players/1/chat").with(role("USER",7))).andExpect(jsonPath("$.data.id").value(123)).andExpect(jsonPath("$.data.targetName").value("测试打手"));
        mvc.perform(post("/app/players/2/chat").with(role("USER",7))).andExpect(jsonPath("$.code").value(404));
        mvc.perform(post("/app/players/1/chat").with(role("CS",7))).andExpect(jsonPath("$.code").value(403));
    }

    @Test void audioUploadChecksRoleFormatAndSize() throws Exception {
        byte[] mp3=new byte[]{73,68,51,0,0,0,0,0};
        when(files.upload(any())).thenReturn("/file/test.mp3");
        var file=new org.springframework.mock.web.MockMultipartFile("file","voice.mp3","audio/mpeg",mp3);
        mvc.perform(multipart("/common/file/profile-audio").file(file).with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(multipart("/common/file/profile-audio").file(file).with(role("PLAYER",1))).andExpect(jsonPath("$.data").value("/file/test.mp3"));
        mvc.perform(multipart("/common/file/profile-audio").file(new org.springframework.mock.web.MockMultipartFile("file","bad.mp3","audio/mpeg","bad".getBytes())).with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(400));
    }

    @Test void publicRoutesCannotPerformWritesOrReusePlayerAuthorization() throws Exception {
        mvc.perform(delete("/product/11")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(delete("/product/11").with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(delete("/product/11").with(role("CS",1))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(post("/maintenance/set").param("enabled","true")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(post("/maintenance/set").param("enabled","true").with(role("USER",7)))
                .andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/player/profile").with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/file/wxpay/test.pem")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(multipart("/common/file/upload").file(new org.springframework.mock.web.MockMultipartFile("file","x.png","image/png",new byte[]{1})))
                .andExpect(jsonPath("$.code").value(401));
    }

}
