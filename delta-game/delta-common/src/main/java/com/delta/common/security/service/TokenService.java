package com.delta.common.security.service;

import com.delta.common.constant.CacheConstants;
import com.delta.common.redis.service.RedisService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class TokenService {
    @Value("${jwt.secret}")
    private String secret;
    @Value("${jwt.expiration:86400000}")
    private long expiration;
    @Autowired
    private RedisService redisService;
    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    public String createToken(Long userId, com.delta.common.enums.UserTypeEnum userTypeEnum) {
        return createToken(userId, userTypeEnum.getCode());
    }

    public String createToken(Long userId, String userType) {
        String stamp = accountStamp(userId, userType);
        if (stamp == null) throw new com.delta.common.exception.BusinessException(401, "账号不可用");
        String uuid = UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", userId);
        claims.put("userType", userType);
        claims.put("uuid", uuid);

        String token = Jwts.builder()
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(getKey())
                .compact();

        // 存入Redis
        Map<String, Object> userContext = new HashMap<>();
        userContext.put("userId", userId);
        userContext.put("userType", userType);
        userContext.put("accountStamp", stamp);
        redisService.set(CacheConstants.LOGIN_TOKEN_KEY + uuid, userContext,
                CacheConstants.TOKEN_EXPIRE, TimeUnit.MINUTES);
        return token;
    }

    public Claims parseToken(String token) {
        try {
            return Jwts.parser().verifyWith(getKey()).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            log.debug("Token解析失败: {}", e.getMessage());
            return null;
        }
    }

    public String getToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getUserContext(String uuid) {
        Object obj = redisService.get(CacheConstants.LOGIN_TOKEN_KEY + uuid);
        if (obj instanceof Map<?, ?> context && context.get("userId") instanceof Number id
                && context.get("userType") instanceof String type) {
            String current = accountStamp(id.longValue(), type);
            if (current != null && current.equals(context.get("accountStamp"))) return (Map<String, Object>) obj;
            removeToken(uuid);
        }
        return null;
    }

    public void removeToken(String uuid) {
        redisService.delete(CacheConstants.LOGIN_TOKEN_KEY + uuid);
    }

    public Map<String, Object> authenticate(String token) {
        Claims claims=parseToken(token);
        if(claims==null) return null;
        Map<String,Object> context=getUserContext(claims.get("uuid",String.class));
        if(context==null || !String.valueOf(context.get("userId")).equals(String.valueOf(claims.get("userId")))
                || !context.get("userType").equals(claims.get("userType"))) return null;
        return context;
    }

    private String accountStamp(Long id, String type) {
        if(id==null || type==null) return null;
        String table=switch(type) {case "USER" -> "`user`";case "PLAYER" -> "player";case "ADMIN","CS" -> "admin";default -> null;};
        if(table==null) return null;
        var rows=jdbc.queryForList("SELECT * FROM "+table+" WHERE id=? AND deleted=0",id);
        if(rows.size()!=1) return null;
        var row=rows.get(0);
        if("PLAYER".equals(type) ? !"ACTIVE".equals(row.get("status")) : !"1".equals(String.valueOf(row.get("status")))) return null;
        if("ADMIN".equals(type) || "CS".equals(type)) {
            String role;
            try {
                role=com.delta.common.security.utils.AdminRolePolicy.normalize(String.valueOf(row.get("role")));
            } catch (com.delta.common.exception.BusinessException invalidRole) {
                return null;
            }
            if("ADMIN".equals(type) && "CS".equals(role)) return null;
        }
        String ownerStamp="";
        if("PLAYER".equals(type) && row.get("openid")!=null) {
            var owners=jdbc.queryForList("SELECT status,deleted,password,auth_version FROM `user` WHERE openid=?",row.get("openid"));
            if(owners.size()>1) return null;
            if(owners.size()==1) {
                var owner=owners.get(0);
                if(!"1".equals(String.valueOf(owner.get("status"))) || !"0".equals(String.valueOf(owner.get("deleted")))) return null;
                ownerStamp=":"+owner.get("auth_version")+":"+owner.get("password");
            }
        }
        String input=type+":"+id+":"+row.get("status")+":"+row.get("role")+":"+row.get("password")+":"+row.get("phone")+":"+row.get("openid")+":"+row.get("auth_version")+ownerStamp;
        try {return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }

    private SecretKey getKey() {
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }
}
