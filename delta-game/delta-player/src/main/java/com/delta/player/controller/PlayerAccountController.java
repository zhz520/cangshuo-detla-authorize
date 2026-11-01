package com.delta.player.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.domain.R;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.player.entity.PlayerAccount;
import com.delta.player.service.PlayerAccountService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/player/account")
@RequiredArgsConstructor
public class PlayerAccountController {
    private final PlayerAccountService playerAccountService;

    @GetMapping({"" , "/list"})
    public R<List<PlayerAccount>> list() {
        return R.ok(playerAccountService.list(
                new LambdaQueryWrapper<PlayerAccount>().eq(PlayerAccount::getPlayerId, SecurityUtils.getUserId())));
    }

    @PostMapping
    public R<Void> add(@RequestBody PlayerAccount account) {
        playerAccountService.save(clean(account,null));
        return R.ok();
    }

    @PutMapping
    public R<Void> update(@RequestBody PlayerAccount account) {
        requireOwned(account.getId());
        playerAccountService.updateById(clean(account,account.getId()));
        return R.ok();
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        requireOwned(id);
        playerAccountService.removeById(id);
        return R.ok();
    }

    private void requireOwned(Long id) {
        PlayerAccount existing=id==null?null:playerAccountService.getById(id);
        if(existing==null || !SecurityUtils.getUserId().equals(existing.getPlayerId()))
            throw new com.delta.common.exception.BusinessException(404,"收款账户不存在");
    }
    private PlayerAccount clean(PlayerAccount input,Long id) {
        if(input.getType()==null || !java.util.Set.of("ALIPAY","WECHAT","BANK").contains(input.getType())
                || input.getAccountName()==null || input.getAccountName().isBlank() || input.getAccountName().length()>128
                || input.getAccountNo()==null || input.getAccountNo().isBlank() || input.getAccountNo().length()>256)
            throw new com.delta.common.exception.BusinessException(400,"收款账户信息不完整");
        if(input.getQrcodeUrl()!=null && !(input.getQrcodeUrl().isBlank() || input.getQrcodeUrl().startsWith("/file/") || input.getQrcodeUrl().startsWith("https://")))
            throw new com.delta.common.exception.BusinessException(400,"收款码地址无效");
        PlayerAccount result=new PlayerAccount();result.setId(id);result.setPlayerId(SecurityUtils.getUserId());
        result.setType(input.getType());result.setAccountName(input.getAccountName());result.setAccountNo(input.getAccountNo());result.setQrcodeUrl(input.getQrcodeUrl());
        result.setIsDefault(Integer.valueOf(1).equals(input.getIsDefault())?1:0);return result;
    }
}
