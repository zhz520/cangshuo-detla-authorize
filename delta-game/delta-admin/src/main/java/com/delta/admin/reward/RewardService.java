package com.delta.admin.reward;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.delta.common.event.BusinessEvent;
import com.delta.admin.mapper.RewardMapper;
import com.delta.common.exception.BusinessException;
import com.delta.common.utils.Money;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import com.delta.pay.service.TransactionService;
import com.delta.player.entity.*;
import com.delta.player.service.*;
import com.delta.system.service.*;
import com.delta.user.entity.Wallet;
import com.delta.user.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.*;
import java.time.*;
import java.util.*;

@Service
@lombok.extern.slf4j.Slf4j
@RequiredArgsConstructor
public class RewardService extends ServiceImpl<RewardMapper,Reward> {
    private final OrderService orders;
    private final PlayerService players;
    private final UserService users;
    private final WalletService wallets;
    private final PlayerWalletService playerWallets;
    private final TransactionService transactions;
    private final RewardGrabRulesService rules;
    private final FeatureAuditService audit;
    private final ApplicationEventPublisher events;

    public Order ownedOrder(Long orderId,Long userId,boolean lock) {
        var query=new LambdaQueryWrapper<Order>().eq(Order::getId,orderId).eq(Order::getUserId,userId);
        if(lock) query.last("FOR UPDATE");
        Order order=orders.getOne(query);
        if(order==null) throw new BusinessException(404,"订单不存在");
        return order;
    }
    private String unavailable(Order order, Long userId, RewardGrabRulesService.Rules rule) {
        if(!rule.rewardEnabled()) return "打赏功能暂未开启";
        if(!Set.of("COMPLETED","CONFIRMED","REVIEWED").contains(order.getStatus())) return "订单完成后才可打赏";
        if(order.getPlayerId()==null) return "订单没有服务打手";
        if(order.getCompleteTime()==null || order.getCompleteTime().plusDays(rule.validDays()).isBefore(LocalDateTime.now())) return "已超过打赏有效期";
        var player=players.getById(order.getPlayerId());var user=users.getById(userId);
        if(player==null || user==null || !Integer.valueOf(1).equals(user.getStatus()) || !"ACTIVE".equals(player.getStatus())) return "打赏账号不可用";
        if(Objects.equals(player.getOpenid(),user.getOpenid()) && player.getOpenid()!=null
                || player.getPhone()!=null && !player.getPhone().isBlank() && player.getPhone().equals(user.getPhone())) return "不能给自己打赏";
        return null;
    }
    public Map<String,Object> options(Long orderId,Long userId) {
        Order order=ownedOrder(orderId,userId,false);var rule=rules.get();
        Reward reward=getOne(new LambdaQueryWrapper<Reward>().eq(Reward::getOrderId,orderId));
        String reason=reward==null?unavailable(order,userId,rule):"该订单已打赏";
        Map<String,Object> result=new HashMap<>();result.put("eligible",reason==null);result.put("reason",reason);
        result.put("minAmount",rule.minAmount());result.put("maxAmount",rule.maxAmount());result.put("feePercent",rule.feePercent());
        result.put("reward",RewardReceipt.from(reward));var wallet=wallets.getByUserId(userId);
        result.put("balance",wallet==null?BigDecimal.ZERO:wallet.getBalance());return result;
    }
    public List<Map<String,Object>> eligibleOrders(Long playerId,Long userId) {
        var rule=rules.get();if(!rule.rewardEnabled()) return List.of();
        return orders.list(new LambdaQueryWrapper<Order>().eq(Order::getUserId,userId).eq(Order::getPlayerId,playerId)
                .in(Order::getStatus,"COMPLETED","CONFIRMED","REVIEWED")
                .ge(Order::getCompleteTime,LocalDateTime.now().minusDays(rule.validDays()))
                .notInSql(Order::getId,"SELECT order_id FROM player_reward").orderByDesc(Order::getCompleteTime).last("LIMIT 20"))
                .stream().filter(o->unavailable(o,userId,rule)==null)
                .map(o->Map.<String,Object>of("id",o.getId(),"orderNo",o.getOrderNo(),"productName",Objects.toString(o.getProductName(),"订单"))).toList();
    }
    @Transactional(rollbackFor=Exception.class)
    public Reward pay(Long orderId,Long userId,BigDecimal amount,String requestId,String remark) {
        Money.positive(amount);
        Order order=ownedOrder(orderId,userId,true);
        // Lock order -> customer wallet -> player wallet consistently for payment and reversal.
        Wallet wallet=wallets.getByUserId(userId);
        if(wallet==null) throw new BusinessException("钱包不存在");
        Reward previous=getOne(new LambdaQueryWrapper<Reward>().eq(Reward::getUserId,userId).eq(Reward::getRequestId,requestId));
        if(previous!=null) {
            if(!previous.getOrderId().equals(orderId) || previous.getAmount().compareTo(amount)!=0) throw new BusinessException(409,"请求编号已用于其他打赏");
            return previous;
        }
        if(count(new LambdaQueryWrapper<Reward>().eq(Reward::getOrderId,orderId))>0) throw new BusinessException(409,"该订单已打赏，不可重复");
        var rule=rules.get();String reason=unavailable(order,userId,rule);
        if(reason!=null) throw new BusinessException(400,reason);
        if(amount.compareTo(rule.minAmount())<0 || amount.compareTo(rule.maxAmount())>0) throw new BusinessException(400,"打赏金额须在"+rule.minAmount()+"～"+rule.maxAmount()+"元之间");
        PlayerWallet pw=playerWallets.getByPlayerId(order.getPlayerId());
        if(pw==null) throw new BusinessException("打手钱包不存在，请联系客服");
        LocalDateTime start=LocalDate.now().atStartOfDay(),end=start.plusDays(1);
        if(currentDailyCount(daily(start,end).eq(Reward::getUserId,userId))>=rule.userDailyLimit()) throw new BusinessException("今日打赏次数已达上限");
        if(currentDailyCount(daily(start,end).eq(Reward::getPlayerId,order.getPlayerId()))>=rule.playerDailyLimit()) throw new BusinessException("该打手今日接收打赏次数已达上限");
        if(currentDailyCount(daily(start,end).eq(Reward::getPlayerId,order.getPlayerId()).eq(Reward::getUserId,userId))>=rule.pairDailyLimit()) throw new BusinessException("今日对该打手的打赏次数已达上限");
        if(wallet.getBalance().compareTo(amount)<0) throw new BusinessException(400,"余额不足，请先充值");
        Reward reward=new Reward();reward.setRewardNo("RW"+UUID.randomUUID().toString().replace("-",""));
        reward.setRequestId(requestId);reward.setUserId(userId);reward.setPlayerId(order.getPlayerId());
        reward.setOrderId(orderId);reward.setOrderNo(order.getOrderNo());reward.setAmount(amount);
        reward.setFeePercent(rule.feePercent());reward.setFee(amount.multiply(rule.feePercent()).divide(new BigDecimal("100"),2,RoundingMode.HALF_UP));
        reward.setIncome(amount.subtract(reward.getFee()));reward.setRemark(remark);reward.setPaymentMethod("BALANCE");
        reward.setStatus("PAID");reward.setPendingRecovery(BigDecimal.ZERO);reward.setCreatedAt(LocalDateTime.now());reward.setUpdatedAt(reward.getCreatedAt());
        BigDecimal ub=wallet.getBalance(),pb=pw.getBalance();
        wallet.setBalance(ub.subtract(amount));pw.setBalance(pb.add(reward.getIncome()));pw.setTotalIncome(pw.getTotalIncome().add(reward.getIncome()));
        reward.setUserBalanceBefore(ub);reward.setUserBalanceAfter(wallet.getBalance());
        reward.setPlayerBalanceBefore(pb);reward.setPlayerBalanceAfter(pw.getBalance());
        if(!wallets.updateById(wallet) || !playerWallets.updateById(pw) || !save(reward)) throw new IllegalStateException("打赏入账失败");
        transactions.record("REWARD_PAY","USER",userId,amount.negate(),ub,wallet.getBalance(),orderId,null,null,"打赏支出 · "+reward.getRewardNo());
        transactions.record("REWARD_INCOME","PLAYER",order.getPlayerId(),reward.getIncome(),pb,pw.getBalance(),orderId,null,null,"打赏收入 · "+order.getOrderNo()+" · "+reward.getRewardNo());
        notifyAfterCommit(new BusinessEvent(this,"打赏到账","PLAYER",order.getPlayerId(),orderId,"收到打赏，实收¥"+reward.getIncome()));
        return reward;
    }
    private LambdaQueryWrapper<Reward> daily(LocalDateTime start,LocalDateTime end) {
        // Include reversed records, so reversal cannot be used to evade daily limits.
        return new LambdaQueryWrapper<Reward>().ge(Reward::getCreatedAt,start).lt(Reward::getCreatedAt,end);
    }
    private int currentDailyCount(LambdaQueryWrapper<Reward> query) {
        return list(query.last("FOR UPDATE")).size();
    }
    private void notifyAfterCommit(BusinessEvent event) {
        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
            new org.springframework.transaction.support.TransactionSynchronization() {
                @Override public void afterCommit() {
                    try { events.publishEvent(event); }
                    catch(RuntimeException e) { log.error("打赏通知发送失败，账务已提交",e); }
                }
            });
    }
    @Transactional(rollbackFor=Exception.class)
    public Reward reverse(Long id,Long adminId,String reason) {
        Reward snapshot=getById(id);if(snapshot==null) throw new BusinessException(404,"打赏记录不存在");
        ownedOrder(snapshot.getOrderId(),snapshot.getUserId(),true);
        Wallet wallet=wallets.getByUserId(snapshot.getUserId());
        PlayerWallet pw=playerWallets.getByPlayerId(snapshot.getPlayerId());
        Reward reward=getOne(new LambdaQueryWrapper<Reward>().eq(Reward::getId,id).last("FOR UPDATE"));
        if("REVERSED".equals(reward.getStatus())) return reward;
        if(wallet==null || pw==null) throw new BusinessException("钱包不存在，暂不能冲正");
        String before=reward.getStatus();reward.setReversalReason(reason);reward.setReversalAdminId(adminId);reward.setUpdatedAt(LocalDateTime.now());
        if(pw.getBalance().compareTo(reward.getIncome())<0) {
            reward.setStatus("REVERSAL_PENDING");reward.setPendingRecovery(reward.getIncome());
        } else {
            BigDecimal ub=wallet.getBalance(),pb=pw.getBalance();
            wallet.setBalance(ub.add(reward.getAmount()));pw.setBalance(pb.subtract(reward.getIncome()));
            reward.setReversalUserBalanceBefore(ub);reward.setReversalUserBalanceAfter(wallet.getBalance());
            reward.setReversalPlayerBalanceBefore(pb);reward.setReversalPlayerBalanceAfter(pw.getBalance());
            pw.setTotalIncome(pw.getTotalIncome().subtract(reward.getIncome()));
            if(!wallets.updateById(wallet) || !playerWallets.updateById(pw)) throw new IllegalStateException("冲正失败");
            transactions.record("REWARD_REFUND","USER",reward.getUserId(),reward.getAmount(),ub,wallet.getBalance(),reward.getOrderId(),null,null,"打赏冲正退款 · "+reward.getRewardNo());
            transactions.record("REWARD_REVERSAL","PLAYER",reward.getPlayerId(),reward.getIncome().negate(),pb,pw.getBalance(),reward.getOrderId(),null,null,"打赏冲正扣款 · "+reward.getRewardNo());
            reward.setStatus("REVERSED");reward.setPendingRecovery(BigDecimal.ZERO);reward.setReversedAt(LocalDateTime.now());
            notifyAfterCommit(new BusinessEvent(this,"打赏冲正","USER",reward.getUserId(),reward.getOrderId(),"异常打赏已退回余额"));
            notifyAfterCommit(new BusinessEvent(this,"打赏冲正","PLAYER",reward.getPlayerId(),reward.getOrderId(),"异常打赏已冲正扣回"));
        }
        updateById(reward);audit.record("打赏冲正",id,before,Map.of("status",reward.getStatus(),"reason",reason,"pendingRecovery",reward.getPendingRecovery()));
        return reward;
    }
}
