package com.delta.admin;

import com.delta.admin.controller.AdminUserController;
import com.delta.admin.service.UserManagementService;
import com.delta.common.config.SecurityConfig;
import com.delta.common.exception.*;
import com.delta.common.redis.service.RedisService;
import com.delta.common.security.filter.JwtAuthenticationFilter;
import com.delta.common.security.handler.*;
import com.delta.common.security.service.*;
import com.delta.order.service.OrderService;
import com.delta.pay.service.*;
import com.delta.player.service.WithdrawService;
import com.delta.player.service.impl.*;
import com.delta.system.service.impl.OperationLogServiceImpl;
import com.delta.user.controller.UserAuthController;
import com.delta.user.service.UserPasswordService;
import com.delta.user.service.impl.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.*;
import org.springframework.data.redis.core.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes=UserAccountIntegrationTest.Config.class,properties={
 "spring.profiles.active=test","spring.datasource.url=jdbc:h2:mem:userauth;MODE=MySQL;DB_CLOSE_DELAY=-1;NON_KEYWORDS=USER,LEVEL,TRANSACTION",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "spring.datasource.type=com.zaxxer.hikari.HikariDataSource","spring.main.allow-bean-definition-overriding=true",
 "jwt.secret=test-only-key-012345678901234567890123456789012345678901234567890123456789","jwt.expiration=3600000"
})
@AutoConfigureMockMvc
@Sql(scripts="/reward-schema.sql",config=@org.springframework.test.context.jdbc.SqlConfig(encoding="UTF-8"))
class UserAccountIntegrationTest {
    @Configuration @EnableAutoConfiguration(excludeName="com.alibaba.druid.spring.boot3.autoconfigure.DruidDataSourceAutoConfigure")
    @MapperScan({"com.delta.user.mapper","com.delta.player.mapper","com.delta.common.mapper","com.delta.system.mapper"})
    @Import({UserServiceImpl.class,WalletServiceImpl.class,PlayerServiceImpl.class,PlayerWalletServiceImpl.class,OperationLogServiceImpl.class,
            com.delta.common.mybatis.handler.MetaObjectHandlerImpl.class,UserPasswordService.class,UserManagementService.class,UserAuthController.class,AdminUserController.class,
            SecurityConfig.class,JwtAuthenticationFilter.class,TokenService.class,AuthenticationEntryPointImpl.class,AccessDeniedHandlerImpl.class,GlobalExceptionHandler.class})
    static class Config {}
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TokenService tokens;
    @Autowired ObjectMapper json;
    @MockBean VerificationService verification;
    @MockBean RateLimitService limits;
    @MockBean RedisService redis;
    @MockBean StringRedisTemplate strings;
    @MockBean OrderService orders;
    @MockBean PaymentService payments;
    @MockBean TransactionService transactions;
    @MockBean WithdrawService withdraws;
    final Map<String,String> setupCache=new ConcurrentHashMap<>();
    final Map<String,Object> sessions=new ConcurrentHashMap<>();
    private static final String PASSWORD="SecureUserPass123";
    @BeforeEach void cache() {
        setupCache.clear();sessions.clear();ValueOperations<String,String> values=mock(ValueOperations.class);
        when(strings.opsForValue()).thenReturn(values);
        doAnswer(a->{setupCache.put(a.getArgument(0),a.getArgument(1));return null;}).when(values).set(anyString(),anyString(),any(Duration.class));
        when(values.getAndDelete(anyString())).thenAnswer(a->setupCache.remove(a.getArgument(0)));
        doAnswer(a->{sessions.put(a.getArgument(0),a.getArgument(1));return null;}).when(redis).set(anyString(),any(),anyLong(),any(TimeUnit.class));
        when(redis.get(anyString())).thenAnswer(a->sessions.get(a.getArgument(0)));
        when(redis.delete(anyString())).thenAnswer(a->sessions.remove(a.getArgument(0))!=null);
    }
    private RequestPostProcessor role(String type,long id){return authentication(new UsernamePasswordAuthenticationToken(Map.of("userId",id,"userType",type),null,List.of(new SimpleGrantedAuthority("ROLE_"+type))));}
    private Map<?,?> data(MvcResult result)throws Exception{return (Map<?,?>)json.readValue(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8),Map.class).get("data");}
    private String setupTicket(String phone)throws Exception{
        var result=mvc.perform(post("/user/auth/h5-login").contentType("application/json").content(json.writeValueAsString(Map.of("phone",phone,"code","123456","requestId","verified-by-test"))))
                .andExpect(jsonPath("$.data.passwordSetupRequired").value(true)).andExpect(jsonPath("$.data.token").isEmpty()).andReturn();
        return (String)data(result).get("setupToken");
    }
    private String setupBody(String ticket,String password,String confirmation)throws Exception{return json.writeValueAsString(Map.of("setupToken",ticket,"password",password,"confirmation",confirmation,"userId",8));}
    private String adminBody(String phone,String password)throws Exception{return json.writeValueAsString(Map.of("phone",phone,"nickname","后台用户","avatar","","status",1,"password",password));}
    private String loginBody(String phone,String password)throws Exception{return json.writeValueAsString(Map.of("phone",phone,"password",password,"captchaId","11111111-1111-1111-1111-111111111111","captchaCode","123456"));}

    @Test void smsLoginMustSetPasswordBeforeReceivingBusinessToken()throws Exception{
        String ticket=setupTicket("13900000007");
        mvc.perform(get("/user/profile").header("Authorization","Bearer "+ticket)).andExpect(jsonPath("$.code").value(401));
        var result=mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,PASSWORD,PASSWORD)))
                .andExpect(jsonPath("$.data.passwordSetupRequired").value(false)).andExpect(jsonPath("$.data.userId").value(7)).andExpect(jsonPath("$.data.token").isNotEmpty()).andReturn();
        String hash=jdbc.queryForObject("SELECT password FROM `user` WHERE id=7",String.class);
        assertThat(hash).isNotEqualTo(PASSWORD);assertThat(encoder.matches(PASSWORD,hash)).isTrue();
        assertThat(tokens.authenticate((String)data(result).get("token"))).isNotNull();
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,PASSWORD,PASSWORD))).andExpect(jsonPath("$.code").value(401));
        assertThat(jdbc.queryForObject("SELECT password FROM `user` WHERE id=8",String.class)).isNull();
    }
    @Test void weakMismatchedExpiredOrChangedAccountSetupCannotSetPassword()throws Exception{
        String ticket=setupTicket("13900000007");
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,"abc123","abc123"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,PASSWORD,"different123456"))).andExpect(jsonPath("$.code").value(400));
        jdbc.update("UPDATE `user` SET auth_version=1 WHERE id=7");
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,PASSWORD,PASSWORD))).andExpect(jsonPath("$.code").value(403));
        ticket=setupTicket("13900000007");setupCache.clear();
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,PASSWORD,PASSWORD))).andExpect(jsonPath("$.code").value(401));
        assertThat(jdbc.queryForObject("SELECT password FROM `user` WHERE id=7",String.class)).isNull();
    }
    @Test void userPasswordBoundaryAcceptsEightAndRejectsSevenOrThirtyThree()throws Exception{
        String ticket=setupTicket("13900000007");
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,"Abcd123","Abcd123"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,"A12345678901234567890123456789012","A12345678901234567890123456789012"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/user/auth/set-password").contentType("application/json").content(setupBody(ticket,"Abcd1234","Abcd1234")))
                .andExpect(jsonPath("$.data.token").isNotEmpty());
        assertThat(encoder.matches("Abcd1234",jdbc.queryForObject("SELECT password FROM `user` WHERE id=7",String.class))).isTrue();
    }
    @Test void sharedPasswordPolicyAlsoAppliesToAdministratorsAndCustomerService(){
        org.assertj.core.api.Assertions.assertThatCode(()->com.delta.common.security.utils.PasswordPolicy.validate("Abcd1234")).doesNotThrowAnyException();
        org.assertj.core.api.Assertions.assertThatThrownBy(()->com.delta.common.security.utils.PasswordPolicy.validate("Abcd123"))
                .isInstanceOf(com.delta.common.exception.BusinessException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(()->com.delta.common.security.utils.PasswordPolicy.validate("A12345678901234567890123456789012"))
                .isInstanceOf(com.delta.common.exception.BusinessException.class);
    }
    @Test void configuredUsersCanUseSmsOrPasswordAndWrongPasswordOrCaptchaFails()throws Exception{
        jdbc.update("UPDATE `user` SET password=? WHERE id=7",encoder.encode(PASSWORD));
        mvc.perform(post("/user/auth/password-login").contentType("application/json").content(loginBody("13900000007",PASSWORD))).andExpect(jsonPath("$.data.token").isNotEmpty());
        mvc.perform(post("/user/auth/password-login").contentType("application/json").content(loginBody("13900000007","wrong-password"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/user/auth/password-login").contentType("application/json").content(loginBody("13900000999",PASSWORD))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/user/auth/h5-login").contentType("application/json").content("{\"phone\":\"13900000007\",\"code\":\"123456\",\"requestId\":\"verified-by-test\"}"))
                .andExpect(jsonPath("$.data.passwordSetupRequired").value(false)).andExpect(jsonPath("$.data.token").isNotEmpty());
        doThrow(new BusinessException(400,"验证码错误")).when(verification).verifyLoginCaptcha(any(),any(),any());
        mvc.perform(post("/user/auth/password-login").contentType("application/json").content(loginBody("13900000007",PASSWORD))).andExpect(jsonPath("$.code").value(400));
    }
    @Test void bannedOrDeletedUsersCannotRegainAccessBySmsRegistration()throws Exception{
        jdbc.update("UPDATE `user` SET status=0 WHERE id=7");
        mvc.perform(post("/user/auth/h5-login").contentType("application/json").content("{\"phone\":\"13900000007\",\"code\":\"123456\",\"requestId\":\"verified-by-test\"}"))
                .andExpect(jsonPath("$.code").value(403));
        jdbc.update("UPDATE `user` SET deleted=1 WHERE id=7");
        mvc.perform(post("/user/auth/h5-login").contentType("application/json").content("{\"phone\":\"13900000007\",\"code\":\"123456\",\"requestId\":\"verified-by-test\"}"))
                .andExpect(jsonPath("$.code").value(403));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM `user` WHERE phone='13900000007'",Integer.class)).isEqualTo(1);
    }
    @Test void onlyAdminCanCreateEditDeleteAndHashesNeverAppearInResponses()throws Exception{
        mvc.perform(post("/admin/user").with(role("CS",1)).contentType("application/json").content(adminBody("13800000100",PASSWORD))).andExpect(jsonPath("$.code").value(403));
        var result=mvc.perform(post("/admin/user").with(role("ADMIN",1)).contentType("application/json").content(adminBody("13800000100",PASSWORD)))
                .andExpect(jsonPath("$.data.password").doesNotExist()).andExpect(jsonPath("$.data.passwordSet").value(true)).andReturn();
        long id=((Number)data(result).get("id")).longValue();
        assertThat(jdbc.queryForObject("SELECT balance FROM wallet WHERE user_id=?",java.math.BigDecimal.class,id)).isEqualByComparingTo("0");
        mvc.perform(get("/admin/user/list").with(role("ADMIN",1)).param("keyword","13800000100")).andExpect(jsonPath("$.data.records[0].id").value(id)).andExpect(jsonPath("$.data.records[0].password").doesNotExist());
        mvc.perform(post("/admin/user").with(role("ADMIN",1)).contentType("application/json").content(adminBody("13800000100",PASSWORD))).andExpect(jsonPath("$.code").value(409));
        mvc.perform(put("/admin/user/"+id).with(role("USER",7)).contentType("application/json").content(adminBody("13800000101",PASSWORD))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(put("/admin/user/"+id).with(role("ADMIN",1)).contentType("application/json").content(adminBody("13800000101",""))).andExpect(jsonPath("$.data.phone").value("13800000101"));
        mvc.perform(delete("/admin/user/"+id).with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(200));
        assertThat(jdbc.queryForObject("SELECT deleted FROM `user` WHERE id=?",Integer.class,id)).isEqualTo(1);
        String audit=jdbc.queryForObject("SELECT GROUP_CONCAT(detail) FROM operation_log WHERE module='user'",String.class);assertThat(audit).doesNotContain(PASSWORD).doesNotContain("$2a$");
    }
    @Test void passwordResetPhoneChangeAndBanUnbanInvalidateExistingSessions()throws Exception{
        jdbc.update("UPDATE player SET openid='user-seven' WHERE id=1");
        String userToken=tokens.createToken(7L,"USER"),playerToken=tokens.createToken(1L,"PLAYER");
        mvc.perform(put("/admin/user/7").with(role("ADMIN",1)).contentType("application/json").content(adminBody("13900000007",PASSWORD))).andExpect(jsonPath("$.code").value(200));
        assertThat(tokens.authenticate(userToken)).isNull();assertThat(tokens.authenticate(playerToken)).isNull();
        userToken=tokens.createToken(7L,"USER");
        mvc.perform(put("/admin/user/7/status").param("status","0").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(200));
        mvc.perform(put("/admin/user/7/status").param("status","1").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(200));
        assertThat(tokens.authenticate(userToken)).isNull();
        userToken=tokens.createToken(7L,"USER");
        mvc.perform(put("/admin/user/7").with(role("ADMIN",1)).contentType("application/json").content(adminBody("13900000107",""))).andExpect(jsonPath("$.code").value(200));
        assertThat(tokens.authenticate(userToken)).isNull();
    }
    @Test void deletionProtectsFundsAndUnfinishedBusinessAndRetainsHistory()throws Exception{
        mvc.perform(delete("/admin/user/7").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(409));
        jdbc.update("UPDATE wallet SET balance=0 WHERE user_id=7");when(orders.count(any())).thenReturn(1L);
        mvc.perform(delete("/admin/user/7").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(409));
        when(orders.count(any())).thenReturn(0L);jdbc.update("UPDATE `order` SET status='CONFIRMED' WHERE user_id=7");
        mvc.perform(delete("/admin/user/7").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(200));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM `order` WHERE user_id=7",Integer.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM wallet WHERE user_id=7",Integer.class)).isEqualTo(1);
        mvc.perform(get("/admin/user/list").with(role("ADMIN",1)).param("keyword","13900000007")).andExpect(jsonPath("$.data.records").isEmpty());
    }
    @Test void userWithPendingRewardRecoveryCannotBeDeleted()throws Exception{
        jdbc.update("UPDATE wallet SET balance=0 WHERE user_id=7");
        jdbc.update("INSERT INTO player_reward(reward_no,request_id,user_id,player_id,order_id,order_no,amount,fee,income,fee_percent,status,pending_recovery,user_balance_before,user_balance_after,player_balance_before,player_balance_after) VALUES('PENDING_TEST','pending-recovery-test',7,1,100,'ORDER100',10,0,10,0,'REVERSAL_PENDING',10,10,0,0,10)");
        mvc.perform(delete("/admin/user/7").with(role("ADMIN",1))).andExpect(jsonPath("$.code").value(409));
        assertThat(jdbc.queryForObject("SELECT deleted FROM `user` WHERE id=7",Integer.class)).isZero();
    }
}
