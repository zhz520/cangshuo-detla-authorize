package com.delta.common.websocket;

import com.delta.common.security.service.RateLimitService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class ChatHandshakeInterceptor implements HandshakeInterceptor {
    private final RateLimitService limits;
    @Override
    public boolean beforeHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler handler,Map<String,Object> attributes) {
        String forwarded=request.getHeaders().getFirst("X-Real-IP");
        String remote=forwarded!=null && forwarded.matches("[0-9a-fA-F:.]{2,64}") ? forwarded
                : request.getRemoteAddress()==null ? "unknown" : request.getRemoteAddress().getAddress().getHostAddress();
        try {limits.check("ws-handshake:"+remote,30,60);} catch(Exception e){return false;}
        attributes.put("remoteIp",remote);
        return true;
    }
    @Override public void afterHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler handler,Exception exception) {}
}
