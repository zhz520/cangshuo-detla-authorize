package com.delta.common.security.service;

import com.delta.common.exception.BusinessException;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.common.sms.service.AliyunSmsService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.*;

@Service
@RequiredArgsConstructor
public class VerificationService {
    private final StringRedisTemplate redis;
    private final RateLimitService limits;
    private final CrossModuleMapper configs;
    private final AliyunSmsService sms;
    @Value("${jwt.secret}") private String secret;
    private static final SecureRandom RANDOM=new SecureRandom();
    private static final DefaultRedisScript<Long> CONSUME=new DefaultRedisScript<>(
            "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; " +
            "local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],300) end; " +
            "if n>5 then redis.call('DEL',KEYS[1]); return 0 end; " +
            "if v~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[1]); redis.call('DEL',KEYS[2]); return 1",Long.class);

    public Map<String,String> captcha(String ip) {
        limits.check("captcha:"+ip,60,60);
        String id=UUID.randomUUID().toString(),code=String.format(Locale.ROOT,"%06d",RANDOM.nextInt(1000000));
        redis.opsForValue().set("captcha:"+id,digest("CAPTCHA",id,"",code),Duration.ofMinutes(3));
        return captchaImage(id,code);
    }

    private Map<String,String> captchaImage(String id,String code) {
        var image=new java.awt.image.BufferedImage(180,60,java.awt.image.BufferedImage.TYPE_INT_RGB);
        var g=image.createGraphics();
        try {
            g.setColor(new java.awt.Color(245,245,245));g.fillRect(0,0,180,60);
            for(int i=0;i<12;i++){g.setColor(new java.awt.Color(RANDOM.nextInt(180),RANDOM.nextInt(180),RANDOM.nextInt(180)));g.drawLine(RANDOM.nextInt(180),RANDOM.nextInt(60),RANDOM.nextInt(180),RANDOM.nextInt(60));}
            g.setFont(new java.awt.Font(java.awt.Font.SANS_SERIF,java.awt.Font.BOLD,32));
            for(int i=0;i<6;i++){g.setColor(new java.awt.Color(RANDOM.nextInt(100),RANDOM.nextInt(100),RANDOM.nextInt(100)));g.drawString(code.substring(i,i+1),12+i*26,38+RANDOM.nextInt(9));}
            var out=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",out);
            return Map.of("captchaId",id,"image","data:image/png;base64,"+Base64.getEncoder().encodeToString(out.toByteArray()));
        } catch(java.io.IOException e){throw new IllegalStateException(e);} finally{g.dispose();}
    }

    private static final DefaultRedisScript<Long> GRAB_CONSUME=new DefaultRedisScript<>(
        "local v=redis.call('HGET',KEYS[1],'answer'); if not v then return 0 end; " +
        "local n=redis.call('HINCRBY',KEYS[1],'attempts',1); local m=tonumber(redis.call('HGET',KEYS[1],'max')); " +
        "if v~=ARGV[1] then if n>=m then redis.call('DEL',KEYS[1]) end; return 0 end; " +
        "redis.call('DEL',KEYS[1]); return 1",Long.class);
    private static final DefaultRedisScript<Long> GRAB_CREATE=new DefaultRedisScript<>(
        "redis.call('DEL',KEYS[1]); redis.call('HSET',KEYS[1],'answer',ARGV[1],'attempts',0,'max',ARGV[2]); " +
        "redis.call('EXPIRE',KEYS[1],ARGV[3]); return 1",Long.class);

    public Map<String,String> grabCaptcha(Long playerId,Long orderId,String device,String agent,String ip,int seconds,int maxAttempts,int refreshSeconds) {
        requireDevice(device);
        limits.check("grab-captcha-ip:"+ip,120,60);
        limits.check("grab-captcha-player:"+playerId,1,refreshSeconds);
        String id=UUID.randomUUID().toString(),code=String.format(Locale.ROOT,"%06d",RANDOM.nextInt(1000000));
        redis.execute(GRAB_CREATE,List.of("grab:captcha:"+playerId),grabDigest(playerId,orderId,device,agent,id,code),String.valueOf(maxAttempts),String.valueOf(seconds));
        metric(playerId,"refreshes");return captchaImage(id,code);
    }
    public void verifyGrab(Long playerId,Long orderId,String device,String agent,String id,String code,String ip) {
        requireDevice(device);
        limits.check("grab-verify-player:"+playerId,30,60);limits.check("grab-verify-ip:"+ip,200,60);
        String safe=safeId(id);
        Long result=redis.execute(GRAB_CONSUME,List.of("grab:captcha:"+playerId),grabDigest(playerId,orderId,device,agent,safe,code));
        if(!Long.valueOf(1).equals(result)) {metric(playerId,"failures");throw new BusinessException(400,"验证码错误或已过期，请刷新后重试");}
        metric(playerId,"verified");
    }
    public Map<Object,Object> grabMetrics(Long playerId) {return redis.opsForHash().entries("grab:metrics:"+playerId);}
    private void metric(Long id,String field) {String key="grab:metrics:"+id;redis.opsForHash().increment(key,field,1);redis.expire(key,Duration.ofDays(30));}
    private void requireDevice(String device) {if(device==null || !device.matches("[a-zA-Z0-9-]{16,80}")) throw new BusinessException(400,"请刷新页面后重试验证");}
    private String grabDigest(Long player,Long order,String device,String agent,String id,String code) {return digest("GRAB",player+":"+order+":"+device+":"+Objects.toString(agent,"")+":"+id,"",code);}

    public Map<String,Object> send(String phone,String purpose,String subject,String captchaId,String captchaCode,String ip) {
        requirePhone(phone);
        if(!Set.of("LOGIN","BIND_OLD","BIND_NEW").contains(purpose)) throw new BusinessException(400,"验证码用途无效");
        if(!"true".equalsIgnoreCase(configs.selectConfigValue("sms.aliyun.enabled"))
                || !"true".equalsIgnoreCase(configs.selectConfigValue("sms.aliyun.otp_enabled")))
            throw new BusinessException(503,"短信登录暂未开放，请联系平台客服");
        String template=value("sms.aliyun.template_code.verification");
        String access=value("sms.aliyun.access_key_id"),key=value("sms.aliyun.access_key_secret"),sign=value("sms.aliyun.sign_name");
        if(template.isBlank() || access.isBlank() || key.isBlank() || sign.isBlank()
                || access.startsWith("YOUR_") || key.startsWith("YOUR_")) throw new BusinessException(503,"短信验证码服务暂不可用");
        limits.check("otp-ip:"+ip,120,3600);
        consume("captcha:"+safeId(captchaId),digest("CAPTCHA",captchaId,"",captchaCode));
        limits.check("otp-minute:"+phone,1,60);limits.check("otp-hour:"+phone,5,3600);limits.check("otp-day:"+phone,10,86400);
        limits.check("otp-global",1000,86400);
        String id=UUID.randomUUID().toString(),code=String.format(Locale.ROOT,"%06d",RANDOM.nextInt(1000000));
        String redisKey="otp:"+purpose+":"+id;
        redis.opsForValue().set(redisKey,digest(purpose,subject,phone,code),Duration.ofMinutes(5));
        try {sms.sendTemplate("dysmsapi.aliyuncs.com",access,key,sign,template,phone,Map.of("code",code));}
        catch(RuntimeException e){redis.delete(redisKey);throw new BusinessException(503,"验证码发送失败，请稍后重试");}
        return Map.of("requestId",id,"expiresIn",300,"retryAfter",60);
    }

    public void verify(String phone,String purpose,String subject,String id,String code) {
        requirePhone(phone);
        if(code==null || !code.matches("[0-9]{6}")) throw new BusinessException(400,"验证码错误或已过期");
        limits.check("otp-verify:"+purpose+":"+phone,20,600);
        consume("otp:"+purpose+":"+safeId(id),digest(purpose,subject,phone,code));
    }
    public void verifyLoginCaptcha(String id,String code,String ip) {
        limits.check("password-captcha:"+ip,60,600);
        consume("captcha:"+safeId(id),digest("CAPTCHA",id,"",code));
    }
    private void consume(String key,String expected) {
        Long result=redis.execute(CONSUME,List.of(key,key+":attempts"),expected);
        if(!Long.valueOf(1).equals(result)) throw new BusinessException(400,"验证码错误或已过期");
    }
    private String value(String key){return Objects.toString(configs.selectConfigValue(key),"").trim();}
    private String safeId(String id){if(id==null || !id.matches("[a-f0-9-]{36}")) throw new BusinessException(400,"验证码错误或已过期");return id;}
    public static void requirePhone(String phone){if(phone==null || !phone.matches("1[0-9]{10}")) throw new BusinessException(400,"请输入正确的手机号");}
    private String digest(String purpose,String subject,String phone,String code) {
        try {var mac=javax.crypto.Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((purpose+":"+subject+":"+phone+":"+Objects.toString(code,"")).getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.GeneralSecurityException e){throw new IllegalStateException(e);}
    }
}
