package com.delta.system.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import java.util.Arrays;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.R;
import com.delta.system.entity.SysConfig;
import com.delta.system.dto.RechargePackage;
import com.delta.system.service.SysConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/system/config")
@RequiredArgsConstructor
public class SysConfigController {
    private final SysConfigService sysConfigService;

    /** 兼容旧版 application.yml：首次生成后台配置项时沿用原有开关值。 */
    @Value("${wx.pay.enabled:false}")
    private boolean wxPayEnabledFallback;

    @GetMapping("/list")
    public R<List<SysConfig>> list() {
        ensureBuiltinConfigs();
        List<SysConfig> list=sysConfigService.list(new LambdaQueryWrapper<SysConfig>().orderByAsc(SysConfig::getId));
        list.forEach(c -> {if(secret(c.getConfigKey()) && c.getConfigValue()!=null && !c.getConfigValue().isBlank()) c.setConfigValue("********");});
        return R.ok(list);
    }

    @PutMapping
    public R<Void> update(@RequestBody SysConfig config) {
        updateValue(config);
        return R.ok();
    }

    @OpLog(module = "system", operation = "修改系统配置")
    @PutMapping("/batch")
    @org.springframework.transaction.annotation.Transactional(rollbackFor=Exception.class)
    public R<Void> batchUpdate(@RequestBody List<SysConfig> configs) {
        if(configs==null || configs.size()>200) return R.fail(400,"配置数量无效");
        configs.forEach(this::updateValue);
        return R.ok();
    }

    @GetMapping("/recharge-packages")
    public R<List<RechargePackage>> rechargePackages() {
        ensureBuiltinConfigs();
        return R.ok(sysConfigService.getRechargePackages(false));
    }

    @PutMapping("/recharge-packages")
    @OpLog(module = "system", operation = "修改余额充值套餐")
    public R<Void> updateRechargePackages(@RequestBody List<RechargePackage> packages) {
        try {
            sysConfigService.saveRechargePackages(packages);
            return R.ok();
        } catch (IllegalArgumentException e) {
            return R.fail(e.getMessage());
        }
    }

    /** 公开接口：获取站点配置（无需登录） */
    @GetMapping("/site")
    public R<Map<String, String>> getSiteConfig() {
        List<SysConfig> list = sysConfigService.list(
                new LambdaQueryWrapper<SysConfig>().in(SysConfig::getConfigKey,java.util.List.of("site_name","site_subtitle","site_logo","site_admin_title")));
        Map<String, String> map = list.stream()
                .collect(Collectors.toMap(SysConfig::getConfigKey, SysConfig::getConfigValue, (a, b) -> b));
        // 打手端抽佣比例（百分比）：从结算配置 settlement.commission_rate 转换，0.1 -> 10
        String commissionRateStr = sysConfigService.getConfigValue("settlement.commission_rate", "0.1");
        try {
            int percent = (int) Math.round(Double.parseDouble(commissionRateStr) * 100);
            map.put("player_commission_rate", String.valueOf(percent));
        } catch (NumberFormatException ignored) {
            map.put("player_commission_rate", "10");
        }
        // 打手押金开关
        map.put("player_deposit_required", sysConfigService.getConfigValue("player.deposit_required", "true"));
        // 打手押金金额（元）
        map.put("player_deposit_amount", sysConfigService.getConfigValue("player.deposit_amount", "100"));
        // 微信支付总开关（支付模块运行时动态读取）
        map.put("wx_pay_enabled", sysConfigService.getConfigValue("wx.pay.enabled", "false"));
        map.put("notice_popup_every_visit", sysConfigService.getConfigValue("notice.popup_every_visit", "true"));
        map.put("tech_support_text", sysConfigService.getConfigValue("site.tech_support_text", "斜阳电竞提供技术支持"));
        map.put("tech_support_url", sysConfigService.getConfigValue("site.tech_support_url", ""));
        return R.ok(map);
    }

    private void ensureBuiltinConfigs() {
        ensureConfig("site.tech_support_text", "技术支持文字", "斜阳电竞提供技术支持", "text", "站点配置",
                "显示在用户、打手和客服“我的”页面底部，最多80个字符");
        ensureConfig("site.tech_support_url", "技术支持链接", "", "text", "站点配置",
                "可填写 http:// 或 https:// 开头的链接；留空时底部文字不可点击");
        ensureConfig("notice.popup_every_visit", "首页公告每次刷新都弹窗", "true", "boolean", "公告配置",
                "开启后浏览器刷新会展示已发布的首页公告，切换页面不会重复弹出；关闭后仅在新版本公告首次出现时提醒");
        ensureConfig("sms.aliyun.otp_enabled","启用短信验证码登录","false","boolean","短信配置","仅在验证码模板和短信风控验收后开启");
        ensureConfig("sms.aliyun.template_code.verification","短信验证码模板 Code","","text","短信配置","已审核模板，使用code作为验证码参数名");
        ensureConfig("player.deposit_amount", "打手入驻押金金额", "100", "number", "打手配置",
                "开启打手押金时的应支付金额，单位：元");
        ensureConfig("wallet.recharge.packages", "余额充值套餐",
                "[{\"id\":\"100\",\"name\":\"基础套餐\",\"amount\":100,\"bonus\":10,\"enabled\":true,\"sort\":1},{\"id\":\"300\",\"name\":\"进阶套餐\",\"amount\":300,\"bonus\":40,\"enabled\":true,\"sort\":2},{\"id\":\"500\",\"name\":\"畅玩套餐\",\"amount\":500,\"bonus\":100,\"enabled\":true,\"sort\":3}]",
                "json", "余额配置", "配置用户充值金额及赠送余额，单位：元");
        ensureConfig("wx.pay.enabled", "启用微信支付", String.valueOf(wxPayEnabledFallback), "boolean", "微信支付配置",
                "关闭后小程序和 H5 均不可发起微信支付，但余额支付不受影响");
        ensureConfig("wx.pay.appid", "微信支付 AppID", "", "text", "微信支付配置",
                "支付所属 AppID；小程序支付填写小程序 AppID，H5 支付通常填写公众号 AppID");
        ensureConfig("wx.pay.mch-id", "微信支付商户号", "", "text", "微信支付配置",
                "微信支付商户平台的商户号");
        ensureConfig("wx.pay.notify-url", "支付回调地址", "", "text", "微信支付配置",
                "例如：https://你的域名/api/pay/wx/notify，必须是微信可访问的 HTTPS 地址");
        ensureConfig("wx.pay.refund-notify-url", "退款回调地址", "", "text", "微信支付配置",
                "可选；留空时由支付回调地址自动推导为 /api/pay/wx/refund-notify");
        ensureConfig("wx.pay.api-v3-key", "微信支付 API v3 密钥", "", "text", "微信支付配置",
                "微信商户平台 API 安全中设置的 API v3 密钥");
        ensureConfig("wx.pay.private-key-path", "商户私钥文件", "", "file", "微信支付配置",
                "上传 apiclient_key.pem 或 .key 文件，保存后立即生效");
        ensureConfig("wx.pay.cert-serial-no", "商户证书序列号", "", "text", "微信支付配置",
                "微信支付商户证书序列号");
        ensureConfig("wx.pay.public-key-path", "微信支付公钥文件", "", "file", "微信支付配置",
                "上传微信支付公钥 pub_key.pem，保存后立即生效");
        ensureConfig("wx.pay.public-key-id", "微信支付公钥 ID", "", "text", "微信支付配置",
                "微信支付平台展示的微信支付公钥 ID");
        ensureConfig("wx.pay.h5-type", "H5 客户端类型", "WAP", "text", "微信支付配置",
                "填写 WAP、IOS 或 ANDROID；普通手机浏览器使用 WAP");
        ensureConfig("wx.pay.h5-app-name", "H5 应用名称", "斜阳电竞服务", "text", "微信支付配置",
                "微信 H5 支付场景中的应用名称");
        ensureConfig("sms.aliyun.enabled", "启用阿里云短信提醒", "false", "boolean", "短信配置",
                "开启后聊天页和后台业务事件均可发送短信提醒");
        ensureConfig("sms.aliyun.access_key_id", "阿里云 AccessKey ID", "", "text", "短信配置",
                "阿里云 RAM 用户的 AccessKey ID");
        ensureConfig("sms.aliyun.access_key_secret", "阿里云 AccessKey Secret", "", "text", "短信配置",
                "阿里云 RAM 用户的 AccessKey Secret");
        ensureConfig("sms.aliyun.endpoint", "阿里云短信 Endpoint", "dysmsapi.aliyuncs.com", "text", "短信配置",
                "短信服务默认 Endpoint，一般无需修改");
        ensureConfig("sms.aliyun.sign_name", "阿里云短信签名", "", "text", "短信配置",
                "已审核通过的短信签名");
        ensureConfig("sms.aliyun.template_code.cs_message_reminder", "消息提醒模板 Code", "", "text", "短信配置",
                "用户、打手、客服端通用的消息提醒短信模板");
        ensureConfig("sms.aliyun.template_code.player_finish_order", "通知老板结单模板 Code", "", "text", "短信配置",
                "打手端通知老板结单使用的固定内容短信模板");
        ensureConfig("sms.aliyun.template_code.player_order_assigned", "打手被指派模板 Code", "", "text", "短信配置",
                "后台自动发送给被指派打手的固定内容短信模板");
        ensureConfig("sms.aliyun.template_code.player_teammate_invited", "打手被邀请模板 Code", "", "text", "短信配置",
                "后台自动发送给被邀请打手的固定内容短信模板");
        ensureConfig("sms.aliyun.cooldown_seconds", "客服短信提醒冷却秒数", "60", "number", "短信配置",
                "客服发送短信提醒的冷却时间");
        ensureConfig("sms.aliyun.user_player_cooldown_seconds", "用户/打手短信冷却秒数", "600", "number", "短信配置",
                "用户端和打手端全局发送短信提醒冷却时间");
        ensureConfig("sms.aliyun.player_fee", "打手短信提醒扣费金额", "0.05", "number", "短信配置",
                "打手每次成功发送短信提醒时从余额中扣除的金额");

        // 删除已废弃的配置项
        sysConfigService.remove(new LambdaQueryWrapper<SysConfig>()
                .in(SysConfig::getConfigKey, Arrays.asList(
                        "sms.aliyun.template_code.player_invite_login",
                        "sms.aliyun.template_code.user_allow_login",
                        "sms.aliyun.template_code.user_notify_player"
                )));
        // 将旧名称“客服消息提醒模板 Code”更新为“消息提醒模板 Code”
        SysConfig msgTpl = sysConfigService.getOne(new LambdaQueryWrapper<SysConfig>()
                .eq(SysConfig::getConfigKey, "sms.aliyun.template_code.cs_message_reminder"));
        if (msgTpl != null && !"消息提醒模板 Code".equals(msgTpl.getConfigName())) {
            msgTpl.setConfigName("消息提醒模板 Code");
            msgTpl.setRemark("用户、打手、客服端通用的消息提醒短信模板");
            sysConfigService.updateById(msgTpl);
        }
    }

    private boolean secret(String key) {return java.util.Set.of("wx.pay.api-v3-key","sms.aliyun.access_key_secret").contains(key==null?"":key);}
    private void updateValue(SysConfig submitted) {
        SysConfig old=submitted.getId()==null?null:sysConfigService.getById(submitted.getId());
        if(old==null) throw new com.delta.common.exception.BusinessException(404,"配置项不存在");
        String key=old.getConfigKey(),value=submitted.getConfigValue();
        if(com.delta.system.service.RewardGrabRulesService.KEY.equals(key)) return; // Edited through validated dedicated settings only.
        if(value==null || secret(key) && "********".equals(value)) return;
        if(value.length()>10000) throw new com.delta.common.exception.BusinessException(400,"配置内容过长");
        if("sms.aliyun.endpoint".equals(key) && !"dysmsapi.aliyuncs.com".equals(value)) throw new com.delta.common.exception.BusinessException(400,"短信服务地址无效");
        if("wx.pay.api-v3-key".equals(key) && !value.isEmpty() && value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length!=32)
            throw new com.delta.common.exception.BusinessException(400,"微信API v3密钥须为32字节");
        if("settlement.commission_rate".equals(key)) {
            try {var n=new java.math.BigDecimal(value);if(n.signum()<0 || n.compareTo(java.math.BigDecimal.ONE)>0) throw new IllegalArgumentException();}
            catch(Exception e){throw new com.delta.common.exception.BusinessException(400,"抽佣比例须在0至1之间");}
        }
        if("site.tech_support_text".equals(key)) {
            value = value.trim();
            if(value.isEmpty() || value.length()>80) throw new com.delta.common.exception.BusinessException(400,"技术支持文字须为1至80个字符");
        }
        if("site.tech_support_url".equals(key)) {
            value = value.trim();
            if(!value.isEmpty()) {
                try {
                    java.net.URI uri = java.net.URI.create(value);
                    if(uri.getHost()==null || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())))
                        throw new IllegalArgumentException();
                } catch(Exception e) {
                    throw new com.delta.common.exception.BusinessException(400,"技术支持链接须为有效的 http 或 https 地址");
                }
            }
        }
        if(java.util.Set.of("withdraw.min_amount","player.deposit_amount","sms.aliyun.player_fee").contains(key)) {
            try{var n=new java.math.BigDecimal(value);if(n.signum()<0 || n.stripTrailingZeros().scale()>2 || n.compareTo(new java.math.BigDecimal("1000000"))>0)throw new IllegalArgumentException();}
            catch(Exception e){throw new com.delta.common.exception.BusinessException(400,"金额配置无效");}
        }
        if(java.util.Set.of("withdraw.max_daily_count","order.auto_confirm_hours",
                "order.pay_deadline_minutes","order.max_active_per_player").contains(key)) {
            try {
                int n = Integer.parseInt(value);
                if (n < 1 || n > 1000) throw new IllegalArgumentException();
            } catch (Exception e) {
                throw new com.delta.common.exception.BusinessException(400,"次数与时长须为1至1000之间的整数");
            }
        }
        SysConfig update=new SysConfig();update.setId(old.getId());update.setConfigValue(value);sysConfigService.updateById(update);
    }

    private void ensureConfig(String key, String name, String value, String valueType, String group, String remark) {
        boolean exists = sysConfigService.exists(new LambdaQueryWrapper<SysConfig>()
                .eq(SysConfig::getConfigKey, key));
        if (exists) return;
        SysConfig config = new SysConfig();
        config.setConfigKey(key);
        config.setConfigName(name);
        config.setConfigValue(value);
        config.setValueType(valueType);
        config.setConfigGroup(group);
        config.setRemark(remark);
        config.setCreatedAt(LocalDateTime.now());
        config.setUpdatedAt(LocalDateTime.now());
        sysConfigService.save(config);
    }
}
