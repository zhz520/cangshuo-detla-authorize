package com.delta.user.controller;

import com.delta.common.domain.R;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.user.dto.UserProfileVO;
import com.delta.user.entity.User;
import com.delta.user.entity.Wallet;
import com.delta.user.service.UserService;
import com.delta.user.service.WalletService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/user")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;
    private final WalletService walletService;
    private final com.delta.common.security.service.VerificationService verification;
    private final com.delta.common.mapper.CrossModuleMapper crossModuleMapper;

    @GetMapping("/profile")
    public R<UserProfileVO> profile() {
        Long userId = SecurityUtils.getUserId();
        User user = userService.getById(userId);
        Wallet wallet = walletService.getByUserId(userId);
        UserProfileVO vo = new UserProfileVO();
        vo.setId(user.getId());
        vo.setNickname(user.getNickname());
        vo.setAvatar(user.getAvatar());
        vo.setPhone(user.getPhone());
        vo.setBalance(wallet != null ? wallet.getBalance() : java.math.BigDecimal.ZERO);
        return R.ok(vo);
    }

    @PutMapping("/profile")
    public R<Void> updateProfile(@RequestBody User user) {
        if(user.getNickname()!=null && (user.getNickname().isBlank() || user.getNickname().length()>64)) return R.fail(400,"昵称长度不符合要求");
        if(user.getAvatar()!=null && !(user.getAvatar().isEmpty() || user.getAvatar().startsWith("/file/") || user.getAvatar().startsWith("https://"))) return R.fail(400,"头像地址无效");
        User update=new User();update.setId(SecurityUtils.getUserId());update.setNickname(user.getNickname());update.setAvatar(user.getAvatar());
        userService.updateById(update);
        userService.syncUserProfileToPlayerIfSameOpenid(update.getId());
        return R.ok();
    }

    @PostMapping("/phone/code")
    public R<java.util.Map<String,Object>> phoneCode(@RequestBody java.util.Map<String,String> body,jakarta.servlet.http.HttpServletRequest request) {
        User user=userService.getById(SecurityUtils.getUserId());String purpose=body.get("purpose");
        if(!java.util.Set.of("BIND_OLD","BIND_NEW").contains(purpose==null?"":purpose)) return R.fail(400,"验证码用途无效");
        String phone="BIND_OLD".equals(purpose)?user.getPhone():body.get("phone");
        return R.ok(verification.send(phone,purpose,String.valueOf(user.getId()),body.get("captchaId"),body.get("captchaCode"),request.getRemoteAddr()));
    }

    @PutMapping("/phone")
    @org.springframework.transaction.annotation.Transactional(rollbackFor=Exception.class)
    public R<Void> bindPhone(@RequestBody java.util.Map<String, String> body) {
        String phone = body != null ? body.getOrDefault("phone", "") : "";
        com.delta.common.security.service.VerificationService.requirePhone(phone);
        User current=userService.getOne(new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<User>().eq(User::getId,SecurityUtils.getUserId()).last("FOR UPDATE"));
        if(current.getPhone()!=null && !current.getPhone().isBlank())
            verification.verify(current.getPhone(),"BIND_OLD",String.valueOf(current.getId()),body.get("oldRequestId"),body.get("oldCode"));
        verification.verify(phone,"BIND_NEW",String.valueOf(current.getId()),body.get("requestId"),body.get("code"));
        User existing=userService.getByPhone(phone);
        if(existing!=null && !existing.getId().equals(current.getId())) return R.fail(409,"该手机号暂不可绑定，请联系客服");
        User user = new User();
        user.setId(SecurityUtils.getUserId());
        user.setPhone(phone);
        user.setAuthVersion((current.getAuthVersion()==null?0:current.getAuthVersion())+1);
        String newOpenid=current.getOpenid()!=null && current.getOpenid().startsWith("h5:")?"h5:"+phone:current.getOpenid();
        user.setOpenid(newOpenid);
        crossModuleMapper.syncVerifiedIdentity(current.getOpenid(),newOpenid,phone);
        userService.updateById(user);
        return R.ok();
    }
}
