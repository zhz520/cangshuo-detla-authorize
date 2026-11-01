package com.delta.common.security.service;

import com.delta.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
@RequiredArgsConstructor
public class RateLimitService {
    private final StringRedisTemplate redis;
    private static final DefaultRedisScript<Long> COUNTER=new DefaultRedisScript<>(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",Long.class);
    public void check(String key,int limit,int seconds) {
        Long count=redis.execute(COUNTER,List.of("rate:"+key),String.valueOf(seconds));
        if(count==null || count>limit) throw new BusinessException(429,"操作过于频繁，请稍后重试");
    }
}
