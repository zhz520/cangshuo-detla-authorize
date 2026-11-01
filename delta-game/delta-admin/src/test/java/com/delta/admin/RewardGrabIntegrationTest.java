package com.delta.admin;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.delta.admin.controller.*;
import com.delta.admin.reward.*;
import com.delta.common.chat.domain.entity.ChatSession;
import com.delta.common.chat.service.ChatSessionService;
import com.delta.common.config.SecurityConfig;
import com.delta.common.exception.GlobalExceptionHandler;
import com.delta.common.redis.service.RedisService;
import com.delta.common.security.filter.JwtAuthenticationFilter;
import com.delta.common.security.handler.*;
import com.delta.common.security.service.*;
import com.delta.order.service.OrderService;
import com.delta.order.service.impl.*;
import com.delta.pay.service.TransactionService;
import com.delta.pay.service.impl.TransactionServiceImpl;
import com.delta.player.controller.PlayerOrderController;
import com.delta.player.service.*;
import com.delta.player.service.impl.*;
import com.delta.product.service.ProductService;
import com.delta.system.service.*;
import com.delta.system.service.impl.*;
import com.delta.user.service.impl.*;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes=RewardGrabIntegrationTest.Config.class,properties={
 "spring.profiles.active=test","spring.datasource.url=jdbc:h2:mem:reward;MODE=MySQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000;NON_KEYWORDS=USER,LEVEL,TRANSACTION",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "spring.datasource.type=com.zaxxer.hikari.HikariDataSource","spring.main.allow-bean-definition-overriding=true"
})
@AutoConfigureMockMvc
@Sql(scripts="/reward-schema.sql",config=@org.springframework.test.context.jdbc.SqlConfig(encoding="UTF-8"))
class RewardGrabIntegrationTest {
    @Configuration
    @EnableAutoConfiguration(excludeName="com.alibaba.druid.spring.boot3.autoconfigure.DruidDataSourceAutoConfigure")
    @MapperScan({"com.delta.admin.mapper","com.delta.player.mapper","com.delta.order.mapper","com.delta.pay.mapper","com.delta.user.mapper","com.delta.common.mapper","com.delta.system.mapper"})
    @Import({RewardService.class,RewardController.class,RewardGrabRulesService.class,RewardGrabSettingsController.class,FeatureAuditService.class,
            OperationLogServiceImpl.class,SysConfigServiceImpl.class,WalletServiceImpl.class,PlayerWalletServiceImpl.class,UserServiceImpl.class,
            PlayerServiceImpl.class,PlayerLevelService.class,com.delta.order.service.OrderPricingService.class,com.delta.order.controller.OrderController.class,OrderServiceImpl.class,OrderPlayerServiceImpl.class,OrderProgressServiceImpl.class,
            TransactionServiceImpl.class,PlayerOrderController.class,com.delta.player.controller.PlayerEarningsController.class,com.delta.order.controller.PlayerWorkController.class,SecurityConfig.class,JwtAuthenticationFilter.class,
            AuthenticationEntryPointImpl.class,AccessDeniedHandlerImpl.class,GlobalExceptionHandler.class})
    static class Config {
        @Bean MybatisPlusInterceptor pagination(){var p=new MybatisPlusInterceptor();p.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));return p;}
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired RewardService rewards;
    @Autowired OrderService orders;
    @Autowired RewardGrabRulesService settings;
    @MockBean TokenService tokens;
    @MockBean VerificationService verification;
    @MockBean ProductService products;
    @Autowired com.delta.order.service.OrderPricingService pricing;
    @MockBean com.delta.order.service.PlayerReplaceRequestService replaceRequests;
    @MockBean RedisService redis;
    @MockBean org.springframework.data.redis.core.StringRedisTemplate redisTemplate;
    @MockBean ChatSessionService chats;
    @SpyBean TransactionService transactions;

    private RequestPostProcessor role(String role,long id){return authentication(new UsernamePasswordAuthenticationToken(Map.of("userId",id,"userType",role),null,List.of(new SimpleGrantedAuthority("ROLE_"+role))));}
    private String body(String request,String amount){return "{\"amount\":"+amount+",\"requestId\":\"request-reward-"+request+"\",\"remark\":\"感谢\"}";}
    private BigDecimal balance(String table,String column,long id){return jdbc.queryForObject("SELECT balance FROM "+table+" WHERE "+column+"=?",BigDecimal.class,id);}
    private int number(String sql){return jdbc.queryForObject(sql,Integer.class);}

    private void pricedProduct(String amount) {
        var product=new com.delta.product.entity.Product();
        product.setId(11L);product.setName("体验单");product.setStatus(1);product.setPrice(new BigDecimal(amount));
        when(products.getById(11L)).thenReturn(product);
        jdbc.update("UPDATE player SET is_online=1");
        jdbc.update("UPDATE player_level SET price_increase_rate=10 WHERE id=2");
    }

    @Test void quoteUsesLevelOrIndividualRateAndRejectsUnavailableOrAmbiguousChoices() throws Exception {
        pricedProduct("50");
        mvc.perform(get("/order/quote").param("productId","11")).andExpect(jsonPath("$.code").value(401));
        mvc.perform(get("/order/quote").param("productId","11").with(role("CS",1))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/order/quote").param("productId","11").with(role("USER",7)))
                .andExpect(jsonPath("$.data.amount").value(50)).andExpect(header().string("Cache-Control","no-store, private"));
        mvc.perform(get("/order/quote").param("productId","11").param("playerLevelId","2").with(role("USER",7)))
                .andExpect(jsonPath("$.data.amount").value(55)).andExpect(jsonPath("$.data.priceIncreaseAmount").value(5));
        assertThat(pricing.quote(11L,2L,null).getAmount()).isEqualByComparingTo("55");
        jdbc.update("UPDATE player SET price_increase_rate=15 WHERE id=2");
        assertThat(pricing.quote(11L,2L,null).getAmount()).isEqualByComparingTo("57.50");
        jdbc.update("UPDATE player SET price_increase_rate=0 WHERE id=2");
        assertThat(pricing.quote(11L,2L,null).getAmount()).isEqualByComparingTo("50");
        assertThatThrownBy(()->pricing.quote(11L,2L,2)).hasMessageContaining("不能同时选择");
        jdbc.update("UPDATE player_level SET status=0 WHERE id=2");
        assertThatThrownBy(()->pricing.quote(11L,2L,null)).hasMessageContaining("暂不可接单");
        assertThatThrownBy(()->pricing.quote(11L,null,2)).hasMessageContaining("已停用");
    }

    @Test void createRecalculatesMoneyRejectsTamperingAndPreservesPaidSnapshot() throws Exception {
        pricedProduct("45.01");
        jdbc.update("UPDATE player_level SET price_increase_rate=15 WHERE id=2");
        when(redisTemplate.opsForValue()).thenReturn(mock(org.springframework.data.redis.core.ValueOperations.class));
        int original=number("SELECT COUNT(*) FROM `order`");
        mvc.perform(post("/order").with(role("USER",7)).contentType("application/json")
                .content("{\"productId\":11,\"playerLevelId\":2,\"amount\":45.01,\"priceIncreaseRate\":0}"))
                .andExpect(jsonPath("$.msg").value("价格已变化，请核对最新金额后重新提交"));
        assertThat(number("SELECT COUNT(*) FROM `order`")).isEqualTo(original);
        String response=mvc.perform(post("/order").with(role("USER",7)).contentType("application/json")
                .content("{\"productId\":11,\"playerLevelId\":2,\"amount\":51.76}"))
                .andExpect(jsonPath("$.code").value(200)).andExpect(jsonPath("$.data.baseAmount").value(45.01))
                .andExpect(jsonPath("$.data.priceIncreaseRate").value(15)).andExpect(jsonPath("$.data.priceIncreaseAmount").value(6.75))
                .andReturn().getResponse().getContentAsString();
        long orderId=com.alibaba.fastjson2.JSON.parseObject(response).getJSONObject("data").getLongValue("id");
        jdbc.update("UPDATE player_level SET price_increase_rate=30 WHERE id=2");
        assertThat(orders.getById(orderId).getAmount()).isEqualByComparingTo("51.76");
        assertThat(orders.getById(orderId).getPriceIncreaseRate()).isEqualByComparingTo("15");
        jdbc.update("UPDATE player SET is_online=0 WHERE id=2");
        assertThatThrownBy(()->pricing.quote(11L,2L,null)).hasMessageContaining("暂不可接单");
    }

    @Test void paidLevelOrdersCanOnlyBeSeenAndAcceptedByMatchingLevel() throws Exception {
        jdbc.update("UPDATE `order` SET requested_player_level_id=2 WHERE id=200");
        jdbc.update("UPDATE player SET grab_captcha_override=0");
        mvc.perform(get("/player/order/200/accept-challenge").with(role("PLAYER",1))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/player/work/200").with(role("PLAYER",1))).andExpect(jsonPath("$.code").value(404));
        mvc.perform(get("/player/order/hall").with(role("PLAYER",1))).andExpect(jsonPath("$.data.total").value(1));
        assertThat(accept(200,1)).isFalse();
        assertThatThrownBy(()->orders.assignOrder(200L,1L)).hasMessageContaining("所选等级");
        assertThat(accept(200,2)).isTrue();
        verify(verification,never()).verifyGrab(anyLong(),anyLong(),any(),any(),any(),any(),any());
    }

    @Test void rewardIsOneAtomicTransferWithIndependentLedgersAndFeeSnapshot() throws Exception {
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("normal","10"))).andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.playerBalanceBefore").doesNotExist()).andExpect(jsonPath("$.data.playerBalanceAfter").doesNotExist());
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("90");assertThat(balance("player_wallet","player_id",1)).isEqualByComparingTo("30");
        assertThat(number("SELECT COUNT(*) FROM `transaction` WHERE related_order_id=100 AND type IN ('REWARD_PAY','REWARD_INCOME')")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT amount FROM `order` WHERE id=100",BigDecimal.class)).isEqualByComparingTo("50");
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("normal","10"))).andExpect(jsonPath("$.code").value(200));
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("90");assertThat(number("SELECT COUNT(*) FROM player_reward")).isEqualTo(1);
        mvc.perform(post("/order/101/reward").with(role("USER",7)).contentType("application/json").content(body("normal","10"))).andExpect(jsonPath("$.code").value(409));
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("different","10"))).andExpect(jsonPath("$.code").value(409));
    }
    @Test void invalidOwnersRolesAmountsAndUnfinishedOrdersNeverMoveMoney() throws Exception {
        mvc.perform(post("/order/100/reward").contentType("application/json").content(body("a","10"))).andExpect(jsonPath("$.code").value(401));
        mvc.perform(post("/order/100/reward").with(role("PLAYER",1)).contentType("application/json").content(body("a","10"))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(post("/order/100/reward").with(role("USER",8)).contentType("application/json").content(body("a","10"))).andExpect(jsonPath("$.code").value(404));
        for(String amount:List.of("0","-1","0.123","201","999999999"))mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("bad",amount))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/order/200/reward").with(role("USER",7)).contentType("application/json").content(body("unfinished","10"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("insufficient","150"))).andExpect(jsonPath("$.code").value(400));
        jdbc.update("UPDATE player SET openid='user-seven' WHERE id=1");
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("self","10"))).andExpect(jsonPath("$.code").value(400));
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("100");assertThat(number("SELECT COUNT(*) FROM player_reward")).isZero();
    }
    @Test void expiredOrderAndDisabledSwitchAreEnforced() throws Exception {
        jdbc.update("UPDATE `order` SET complete_time=DATEADD('DAY',-31,CURRENT_TIMESTAMP) WHERE id=100");
        mvc.perform(post("/order/100/reward").with(role("USER",7)).contentType("application/json").content(body("expired","10"))).andExpect(jsonPath("$.code").value(400));
        jdbc.update("UPDATE sys_config SET config_value=REPLACE(config_value,'\"rewardEnabled\":true','\"rewardEnabled\":false') WHERE config_key='features.reward_grab'");
        mvc.perform(get("/order/101/reward").with(role("USER",7))).andExpect(jsonPath("$.data.eligible").value(false));
        mvc.perform(post("/order/101/reward").with(role("USER",7)).contentType("application/json").content(body("closed","10"))).andExpect(jsonPath("$.code").value(400));
    }
    @Test void ledgerFailureRollsBackBothWalletsAndRewardRecord() {
        doThrow(new IllegalStateException("simulated ledger failure")).when(transactions).record(anyString(),anyString(),anyLong(),any(),any(),any(),any(),any(),any(),any());
        assertThatThrownBy(()->rewards.pay(100L,7L,new BigDecimal("10"),"reward-ledger-failure","")).isInstanceOf(IllegalStateException.class);
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("100");assertThat(balance("player_wallet","player_id",1)).isEqualByComparingTo("20");assertThat(number("SELECT COUNT(*) FROM player_reward")).isZero();
    }
    @Test void adminReversalIsAuditedAndNeverCreatesNegativeBalance() throws Exception {
        Reward reward=rewards.pay(100L,7L,new BigDecimal("10"),"reward-reverse-test","");
        String path="/admin/rewards/"+reward.getId()+"/reverse";
        mvc.perform(post(path).with(role("CS",1)).contentType("application/json").content("{\"reason\":\"异常\"}")).andExpect(jsonPath("$.code").value(403));
        mvc.perform(post(path).with(role("ADMIN",1)).contentType("application/json").content("{\"reason\":\" \"}")).andExpect(jsonPath("$.code").value(400));
        jdbc.update("UPDATE player_wallet SET balance=0 WHERE player_id=1");
        mvc.perform(post(path).with(role("ADMIN",1)).contentType("application/json").content("{\"reason\":\"异常打赏\"}")).andExpect(jsonPath("$.data.status").value("REVERSAL_PENDING")).andExpect(jsonPath("$.data.pendingRecovery").value(10));
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("90");
        jdbc.update("UPDATE player_wallet SET balance=20 WHERE player_id=1");
        mvc.perform(post(path).with(role("ADMIN",1)).contentType("application/json").content("{\"reason\":\"重试追回\"}")).andExpect(jsonPath("$.data.status").value("REVERSED"));
        mvc.perform(post(path).with(role("ADMIN",1)).contentType("application/json").content("{\"reason\":\"重复冲正\"}")).andExpect(jsonPath("$.data.status").value("REVERSED"));
        assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("100");assertThat(balance("player_wallet","player_id",1)).isEqualByComparingTo("10");
        assertThat(number("SELECT COUNT(*) FROM `transaction` WHERE type IN ('REWARD_REFUND','REWARD_REVERSAL')")).isEqualTo(2);
        assertThat(number("SELECT COUNT(*) FROM operation_log WHERE module='reward-grab'")).isEqualTo(2);
    }
    private List<Boolean> concurrent(Callable<Boolean> a,Callable<Boolean> b) throws Exception {
        var executor=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try{List<Future<Boolean>> jobs=new ArrayList<>();for(var action:List.of(a,b))jobs.add(executor.submit(()->{start.await();return action.call();}));start.countDown();return List.of(jobs.get(0).get(15,TimeUnit.SECONDS),jobs.get(1).get(15,TimeUnit.SECONDS));}finally{executor.shutdownNow();}
    }
    private boolean tip(long order,long user,String request){try{rewards.pay(order,user,new BigDecimal("10"),request,"");return true;}catch(com.delta.common.exception.BusinessException e){return false;}}
    @Test void simultaneousDuplicateRewardDeductsOnce() throws Exception {
        concurrent(()->tip(100,7,"reward-concurrent-a"),()->tip(100,7,"reward-concurrent-b"));
        assertThat(number("SELECT COUNT(*) FROM player_reward")).isEqualTo(1);assertThat(balance("wallet","user_id",7)).isEqualByComparingTo("90");
    }
    @Test void concurrentPlayerDailyLimitIsRespected() throws Exception {
        jdbc.update("UPDATE sys_config SET config_value=REPLACE(config_value,'\"playerDailyLimit\":5','\"playerDailyLimit\":1') WHERE config_key='features.reward_grab'");
        List<Boolean> result=concurrent(()->tip(100,7,"reward-limit-a"),()->tip(102,8,"reward-limit-b"));
        assertThat(result.stream().filter(Boolean::booleanValue).count()).isEqualTo(1);
        assertThat(balance("player_wallet","player_id",1)).isEqualByComparingTo("30");
    }
    @Test void playerOverrideAndLevelExemptionAreServerEnforced() throws Exception {
        doThrow(new com.delta.common.exception.BusinessException(400,"验证码错误")).when(verification).verifyGrab(anyLong(),anyLong(),any(),any(),any(),any(),any());
        mvc.perform(post("/player/order/200/accept").with(role("PLAYER",1)).contentType("application/json").content("{}")).andExpect(jsonPath("$.code").value(400));
        assertThat(number("SELECT COUNT(*) FROM `order` WHERE id=200 AND player_id IS NULL")).isEqualTo(1);
        jdbc.update("UPDATE player SET grab_captcha_override=0 WHERE id=1");
        mvc.perform(post("/player/order/200/accept").with(role("PLAYER",1)).contentType("application/json").content("{}")).andExpect(jsonPath("$.code").value(200));
        mvc.perform(post("/player/order/201/accept").with(role("PLAYER",2)).contentType("application/json").content("{}")).andExpect(jsonPath("$.code").value(200));
        verify(verification,times(1)).verifyGrab(anyLong(),anyLong(),any(),any(),any(),any(),any());
    }
    private boolean accept(long order,long player){try{orders.acceptOrder(order,player);return true;}catch(com.delta.common.exception.BusinessException e){return false;}}
    @Test void parallelGrabHasOneWinnerAndOnePrimaryParticipation() throws Exception {
        jdbc.update("UPDATE player SET grab_captcha_override=0");
        List<Boolean> result=concurrent(()->accept(200,1),()->accept(200,2));
        assertThat(result.stream().filter(Boolean::booleanValue).count()).isEqualTo(1);
        assertThat(number("SELECT COUNT(*) FROM order_player WHERE order_id=200 AND role='PRIMARY'")).isEqualTo(1);
    }
    @Test void parallelGrabsCannotExceedPlayerLimitAndFrozenExemptPlayerCannotAccept() throws Exception {
        jdbc.update("UPDATE player SET grab_captcha_override=0");jdbc.update("UPDATE sys_config SET config_value='1' WHERE config_key='order.max_active_per_player'");
        List<Boolean> result=concurrent(()->accept(200,2),()->accept(201,2));
        assertThat(result.stream().filter(Boolean::booleanValue).count()).isEqualTo(1);
        jdbc.update("UPDATE player SET status='FROZEN' WHERE id=1");
        assertThat(accept(result.get(0)?201:200,1)).isFalse();
    }
    @Test void settingsRequireAdminValidateRangesAndTakeEffectWithoutRestart() throws Exception {
        mvc.perform(get("/admin/reward-grab/settings").with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
        mvc.perform(get("/admin/rewards").with(role("CS",1))).andExpect(jsonPath("$.code").value(403));
        var rules=settings.get();String json=com.alibaba.fastjson2.JSON.toJSONString(rules);
        mvc.perform(put("/admin/reward-grab/settings").with(role("ADMIN",1)).contentType("application/json").content(json.replace("\"captchaSeconds\":120","\"captchaSeconds\":0"))).andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/admin/reward-grab/settings").with(role("ADMIN",1)).contentType("application/json").content(json.replace("\"feePercent\":0","\"feePercent\":10"))).andExpect(jsonPath("$.code").value(200));
        Reward reward=rewards.pay(100L,7L,new BigDecimal("10"),"reward-fee-test","");assertThat(reward.getIncome()).isEqualByComparingTo("9");
        assertThat(number("SELECT COUNT(*) FROM operation_log WHERE module='reward-grab'")).isEqualTo(1);
    }
    @Test void playerDetailsHideCredentialsBeforeAcceptAndRejectOtherPlayersOrders() throws Exception {
        jdbc.update("UPDATE `order` SET game_account='SECRET_ACCOUNT',contact='SECRET_CONTACT',extra_fields='SECRET_FIELDS' WHERE id=200");
        mvc.perform(get("/player/work/200").with(role("PLAYER",1))).andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.gameAccount").isEmpty()).andExpect(jsonPath("$.data.contact").isEmpty()).andExpect(jsonPath("$.data.extraFields").isEmpty());
        jdbc.update("UPDATE `order` SET status='ACCEPTED',player_id=2 WHERE id=200");
        mvc.perform(get("/player/work/200").with(role("PLAYER",1))).andExpect(jsonPath("$.code").value(404));
        mvc.perform(get("/player/work/200").with(role("PLAYER",2))).andExpect(jsonPath("$.data.gameAccount").value("SECRET_ACCOUNT"));
        mvc.perform(get("/player/work/200").with(role("USER",7))).andExpect(jsonPath("$.code").value(403));
    }
    @Test void rewardIncomeSummaryIsSeparateAndCustomerReceiptNeverExposesPlayerBalance() throws Exception {
        rewards.pay(100L,7L,new BigDecimal("10"),"reward-summary-test","");
        mvc.perform(get("/player/earnings/summary").with(role("PLAYER",1))).andExpect(jsonPath("$.data.rewardIncome").value(10))
                .andExpect(jsonPath("$.data.totalIncome").value(30));
        mvc.perform(get("/order/100/reward").with(role("USER",7))).andExpect(jsonPath("$.data.reward.playerBalanceBefore").doesNotExist())
                .andExpect(jsonPath("$.data.reward.reversalAdminId").doesNotExist());
        mvc.perform(get("/player/order/200/accept-challenge").with(role("PLAYER",1)).param("deviceId","test-device-12345678"))
                .andExpect(header().string("Cache-Control","no-store, private")).andExpect(jsonPath("$.data.required").value(true));
    }
}
