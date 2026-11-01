package com.delta.admin.service;

import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.common.security.utils.*;
import com.delta.order.entity.Order;
import com.delta.order.service.OrderService;
import com.delta.pay.entity.Payment;
import com.delta.pay.service.PaymentService;
import com.delta.player.entity.*;
import com.delta.player.service.*;
import com.delta.system.entity.OperationLog;
import com.delta.system.service.OperationLogService;
import com.delta.user.entity.*;
import com.delta.user.mapper.UserMapper;
import com.delta.user.service.*;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class UserManagementService {
    private final UserService users;
    private final UserMapper mapper;
    private final WalletService wallets;
    private final PlayerService players;
    private final PlayerWalletService playerWallets;
    private final WithdrawService withdraws;
    private final OrderService orders;
    private final PaymentService payments;
    private final PasswordEncoder encoder;
    private final CrossModuleMapper identities;
    private final OperationLogService logs;
    public record UserRequest(@NotBlank @Pattern(regexp="1[0-9]{10}") String phone,
            @NotBlank @Size(max=64) String nickname,@Size(max=512) String avatar,
            @NotNull @Min(0) @Max(1) Integer status,@Size(max=72) String password) {
        @Override public String toString(){return "UserRequest[redacted]";}
    }
    private User locked(Long id) {
        User user=users.getOne(new LambdaQueryWrapper<User>().eq(User::getId,id).last("FOR UPDATE"));
        if(user==null) throw new BusinessException(404,"用户不存在");return user;
    }
    private Map<String,Object> snapshot(User user) {
        return Map.of("id",user.getId(),"phone",Objects.toString(user.getPhone(),""),"nickname",Objects.toString(user.getNickname(),""),"status",user.getStatus(),"passwordSet",user.isPasswordSet());
    }
    private void audit(String action,Long id,Object before,Object after) {
        OperationLog log=new OperationLog();log.setModule("user");log.setOperation(action);log.setOperatorType("ADMIN");log.setOperatorId(SecurityUtils.getUserId());
        log.setTargetType("user");log.setTargetId(id);log.setCreatedAt(LocalDateTime.now());
        log.setDetail(JSON.toJSONString(Map.of("before",before==null?"":before,"after",after==null?"":after)));logs.save(log);
    }
    @Transactional(rollbackFor=Exception.class)
    public User save(Long id,UserRequest body) {
        if(mapper.countReservedPhone(body.phone(),id)>0) throw new BusinessException(409,"该手机号已被使用或已停用，请勿重复创建");
        if(body.nickname().trim().isEmpty()) throw new BusinessException(400,"昵称不能为空");
        String avatar=Objects.toString(body.avatar(),"");
        if(!avatar.isEmpty()&&!avatar.startsWith("/file/")&&!avatar.startsWith("https://")) throw new BusinessException(400,"头像地址无效");
        boolean passwordChanged=body.password()!=null&&!body.password().isEmpty();
        if(passwordChanged) PasswordPolicy.validateUser(body.password());
        User user=id==null?new User():locked(id);Object before=id==null?null:snapshot(user);
        String oldOpenid=user.getOpenid();user.setPhone(body.phone());user.setNickname(body.nickname().trim());user.setAvatar(avatar);user.setStatus(body.status());
        if(passwordChanged) user.setPassword(encoder.encode(body.password()));
        if(id==null) {user.setOpenid("h5:"+body.phone());user.setAuthVersion(0L);users.save(user);wallets.initWallet(user.getId());}
        else {
            if(oldOpenid!=null&&oldOpenid.startsWith("h5:")) user.setOpenid("h5:"+body.phone());
            user.setAuthVersion((user.getAuthVersion()==null?0:user.getAuthVersion())+1);users.updateById(user);
            identities.syncVerifiedIdentity(oldOpenid,user.getOpenid(),body.phone());users.syncUserProfileToPlayerIfSameOpenid(id);
        }
        audit(id==null?"新增用户":"编辑用户",user.getId(),before,Map.of("user",snapshot(user),"passwordChanged",passwordChanged));return user;
    }
    @Transactional(rollbackFor=Exception.class)
    public void setStatus(Long id,Integer status) {
        if(status==null||status<0||status>1) throw new BusinessException(400,"状态只能为正常或封禁");
        User user=locked(id);var before=snapshot(user);user.setStatus(status);user.setAuthVersion((user.getAuthVersion()==null?0:user.getAuthVersion())+1);users.updateById(user);
        audit("修改用户状态",id,before,snapshot(user));
    }
    private boolean nonzero(BigDecimal amount){return amount!=null&&amount.signum()!=0;}
    @Transactional(rollbackFor=Exception.class)
    public void delete(Long id) {
        User user=locked(id);Wallet wallet=wallets.getByUserId(id);
        if(wallet!=null&&(nonzero(wallet.getBalance())||nonzero(wallet.getFrozenAmount()))) throw new BusinessException(409,"用户仍有余额或冻结金额，请先处理资金");
        Player player=players.getOne(new LambdaQueryWrapper<Player>().eq(Player::getOpenid,user.getOpenid()).last("FOR UPDATE"));
        if(player!=null) {
            if(identities.countActivePlayerOrders(player.getId())>0) throw new BusinessException(409,"关联打手仍有进行中订单或队友任务");
            PlayerWallet pw=playerWallets.getByPlayerId(player.getId());
            if(pw!=null&&(nonzero(pw.getBalance())||nonzero(pw.getFrozenAmount()))) throw new BusinessException(409,"关联打手仍有余额或冻结金额，请先处理资金");
            if(withdraws.count(new LambdaQueryWrapper<Withdraw>().eq(Withdraw::getPlayerId,player.getId()).notIn(Withdraw::getStatus,"COMPLETED","REJECTED","CANCELLED"))>0) throw new BusinessException(409,"关联打手仍有未完成提现");
        }
        if(mapper.countPendingRewards(id,player==null?null:player.getId())>0) throw new BusinessException(409,"仍有待追回的打赏，请先完成冲正");
        if(orders.count(new LambdaQueryWrapper<Order>().and(q->{q.eq(Order::getUserId,id);if(player!=null)q.or().eq(Order::getPlayerId,player.getId());})
                .notIn(Order::getStatus,"CONFIRMED","REVIEWED","CANCELLED","REFUNDED","ARBITRATED"))>0) throw new BusinessException(409,"用户或关联打手仍有未完成订单，请先处理");
        if(payments.count(new LambdaQueryWrapper<Payment>().eq(Payment::getUserId,id).in(Payment::getStatus,"PENDING","PAYING","REFUNDING"))>0) throw new BusinessException(409,"用户仍有未完成支付或退款");
        var before=snapshot(user);user.setStatus(0);user.setAuthVersion((user.getAuthVersion()==null?0:user.getAuthVersion())+1);users.updateById(user);users.removeById(id);
        if(player!=null){Player update=new Player();update.setId(player.getId());update.setStatus("FROZEN");update.setIsOnline(0);players.updateById(update);}
        audit("删除用户（保留业务记录）",id,before,Map.of("deleted",true,"historyRetained",true));
    }
}
