package com.delta.user.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.delta.user.entity.Wallet;
import com.delta.user.mapper.WalletMapper;
import com.delta.user.service.WalletService;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;

@Service
public class WalletServiceImpl extends ServiceImpl<WalletMapper, Wallet> implements WalletService {

    @Override
    public Wallet getByUserId(Long userId) {
        var query=new LambdaQueryWrapper<Wallet>().eq(Wallet::getUserId, userId);
        if(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()) query.last("FOR UPDATE");
        return getOne(query);
    }

    @Override
    public void initWallet(Long userId) {
        Wallet wallet = new Wallet();
        wallet.setUserId(userId);
        wallet.setBalance(BigDecimal.ZERO);
        wallet.setFrozenAmount(BigDecimal.ZERO);
        save(wallet);
    }
}
