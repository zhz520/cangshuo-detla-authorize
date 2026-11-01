package com.delta.pay.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.pay.entity.Payment;
import com.delta.pay.config.WxPayConfiguration;
import com.delta.common.redis.service.RedisService;
import com.delta.system.service.SysConfigService;
import com.wechat.pay.java.core.exception.ServiceException;
import com.wechat.pay.java.service.refund.model.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.concurrent.TimeUnit;

/** Durable refund requests and missed payment notifications are retried from committed rows. */
@Component
@RequiredArgsConstructor
@Slf4j
public class WxPaymentRecoveryTask {
    private final PaymentService payments;
    private final WxPayConfiguration configuration;
    private final SysConfigService configs;
    private final RedisService redis;

    @Scheduled(fixedDelay=30000,initialDelay=30000)
    public void recover() {
        if(!configuration.isEnabled()) return;
        var clients=configuration.getClients();if(clients==null || !redis.tryLock("task:wx-payment-recovery",5,TimeUnit.MINUTES)) return;
        try {
            for(Payment payment:payments.list(new LambdaQueryWrapper<Payment>().eq(Payment::getStatus,"REFUNDING").eq(Payment::getPayMethod,"WECHAT").orderByAsc(Payment::getUpdatedAt).last("LIMIT 20"))) {
                try {
                    QueryByOutRefundNoRequest query=new QueryByOutRefundNoRequest();query.setOutRefundNo(payment.getRefundNo());
                    Refund result;
                    try {result=clients.getRefundService().queryByOutRefundNo(query);}
                    catch(ServiceException e) {
                        if(!"RESOURCE_NOT_EXISTS".equals(e.getErrorCode())) throw e;
                        CreateRequest request=new CreateRequest();request.setOutTradeNo(payment.getPaymentNo());request.setOutRefundNo(payment.getRefundNo());request.setReason(payment.getRefundReason());
                        String callback=configs.getConfigValue("wx.pay.refund-notify-url","");
                        if(callback.isBlank()) callback=clients.getConfig().notifyUrl().replaceFirst("/notify$","/refund-notify");
                        request.setNotifyUrl(callback);
                        AmountReq amount=new AmountReq();amount.setTotal((long)com.delta.common.utils.Money.cents(payment.getAmount()));amount.setRefund((long)com.delta.common.utils.Money.cents(payment.getRefundAmount()));amount.setCurrency("CNY");request.setAmount(amount);
                        result=clients.getRefundService().create(request);
                    }
                    payments.acceptRefundResult(result);
                } catch(Exception e){log.error("微信退款待恢复: paymentId={}",payment.getId(),e);}
            }
            for(Payment payment:payments.list(new LambdaQueryWrapper<Payment>().eq(Payment::getStatus,"PAYING").eq(Payment::getPayMethod,"WECHAT").lt(Payment::getCreatedAt,java.time.LocalDateTime.now().minusMinutes(1)).orderByAsc(Payment::getUpdatedAt).last("LIMIT 20"))) {
                try{payments.reconcilePayment(payment.getId());}catch(Exception e){log.error("微信支付待对账: paymentId={}",payment.getId(),e);}
            }
        } finally {redis.unlock("task:wx-payment-recovery");}
    }
}
