package com.delta.common.chat.handler;

import com.alibaba.fastjson2.JSON;
import com.delta.common.chat.domain.entity.ChatMessage;
import com.delta.common.chat.domain.entity.ChatSession;
import com.delta.common.chat.service.ChatServiceImpl;
import com.delta.common.chat.util.ChatParticipantId;
import com.delta.common.security.service.TokenService;
import com.delta.common.websocket.manager.WebSocketSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class ChatWebSocketHandler extends TextWebSocketHandler {
    private final WebSocketSessionManager sessionManager;
    private final ChatServiceImpl chatService;
    private final TokenService tokenService;

    /** session -> userKey 映射，用于断开时清理 */
    private final ConcurrentHashMap<String, String> sessionUserMap = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> unauthenticated = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.setTextMessageSizeLimit(16384);
        unauthenticated.put(session.getId(),System.currentTimeMillis());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Map<String, Object> data = JSON.parseObject(message.getPayload());
        if(data==null){closeQuietly(session);return;}
        if(!sessionUserMap.containsKey(session.getId())){
            if(!"auth".equalsIgnoreCase(String.valueOf(data.get("type")))){closeQuietly(session);return;}
            String token=String.valueOf(data.get("token"));
            Map<String,Object> principal=tokenService.authenticate(token);
            if(principal==null){closeQuietly(session);return;}
            String chatRole=data.get("chatRole")==null?null:String.valueOf(data.get("chatRole"));
            String userType;
            try {userType=com.delta.common.chat.util.ChatIdentity.role((String)principal.get("userType"),chatRole);}
            catch(com.delta.common.exception.BusinessException e){closeQuietly(session);return;}
            Long userId=((Number)principal.get("userId")).longValue();
            String userKey=WebSocketSessionManager.buildKey(userType,userId);
            sessionManager.add(userKey,session);sessionUserMap.put(session.getId(),userKey);
            session.getAttributes().put("authenticatedToken",token);unauthenticated.remove(session.getId());
            session.sendMessage(new TextMessage("{\"type\":\"auth\",\"success\":true}"));
            log.info("WebSocket authenticated: {} -> {}",session.getId(),userKey);return;
        }
        Object authenticatedToken=session.getAttributes().get("authenticatedToken");
        if(!(authenticatedToken instanceof String token) || tokenService.authenticate(token)==null){closeQuietly(session);return;}
        String msgType = (String) data.get("type");

        // 心跳消息：只做应答，不落库、不推送
        if ("ping".equalsIgnoreCase(msgType)) {
            try {
                session.sendMessage(new TextMessage("{\"type\":\"pong\"}"));
            } catch (Exception e) {
                log.warn("发送pong心跳失败", e);
            }
            return;
        }

        String action = (String) data.getOrDefault("action", "send");

        if ("markRead".equals(action)) {
            // 标记已读
            Long sessionId = Long.parseLong(data.get("sessionId").toString());
            String userKey = sessionUserMap.get(session.getId());
            if (userKey != null) {
                String[] identity=userKey.split(":",2);
                com.delta.common.chat.util.ChatIdentity.requireMember(chatService.getById(sessionId),
                        com.delta.common.chat.util.ChatIdentity.encoded(identity[0],Long.parseLong(identity[1])));
                chatService.markRead(sessionId, userKey);
            }
            return;
        }

        // 发送消息
        Long sid = Long.parseLong(data.get("sessionId").toString());
        ChatSession chatSession = chatService.getById(sid);
        if (chatSession == null || chatSession.getId1() == null || chatSession.getId2() == null) {
            log.warn("WebSocket发送: 会话不存在或无效, sessionId={}", sid);
            return;
        }

        String userKey = sessionUserMap.get(session.getId());
        if (userKey == null) {
            log.warn("WebSocket会话未绑定用户, 丢弃消息");
            closeQuietly(session);
            return;
        }
        String[] parts = userKey.split(":", 2);
        if (parts.length != 2) {
            log.warn("非法的userKey格式: {}", userKey);
            closeQuietly(session);
            return;
        }
        String senderType = parts[0];
        long rawSenderId;
        try {
            rawSenderId = Long.parseLong(parts[1]);
        } catch (NumberFormatException e) {
            log.warn("userKey中的用户ID解析失败: {}", userKey);
            closeQuietly(session);
            return;
        }
        String chatRole = (String) data.get("chatRole");
        senderType=com.delta.common.chat.util.ChatIdentity.role(senderType,chatRole);
        long encodedSenderId = ChatParticipantId.encode(senderType, rawSenderId);
        if (!isSessionMember(chatSession, encodedSenderId)) {
            log.warn("WebSocket发送: 非会话成员禁止发消息, encodedId={}, sessionId={}", encodedSenderId, sid);
            return;
        }

        ChatMessage msg = new ChatMessage();
        msg.setSessionId(sid);
        msg.setSenderType(senderType);
        msg.setSenderId(rawSenderId);
        msg.setType(msgType != null ? msgType : "TEXT");

        String content = (String) data.get("content");
        com.delta.common.chat.util.ChatIdentity.validateMessage(msg.getType(),content);
        msg.setContent(filterSensitiveWords(content));
        msg.setIsRead(0);
        chatService.saveMessage(msg);

        pushToSessionMembers(msg);
    }

    private boolean isSessionMember(ChatSession s, long myEncodedId) {
        if (s == null) return false;
        return (s.getId1() != null && s.getId1().equals(myEncodedId)) || (s.getId2() != null && s.getId2().equals(myEncodedId));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        unauthenticated.remove(session.getId());
        String userKey = sessionUserMap.remove(session.getId());
        if (userKey != null) {
            sessionManager.remove(userKey);
        }
        log.info("WebSocket disconnected: {} -> {}", session.getId(), userKey);
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay=30000)
    public void closeStaleUnauthenticated() {
        long cutoff=System.currentTimeMillis()-30000;
        unauthenticated.forEach((id,started)->{
            if(started<cutoff && !sessionUserMap.containsKey(id)){
                unauthenticated.remove(id);
                sessionManager.getAll().stream().filter(s->id.equals(s.getId())).findFirst().ifPresent(this::closeQuietly);
            }
        });
    }

    /** 推送消息给会话中另一参与者（排除发送者） */
    private void pushToSessionMembers(ChatMessage msg) {
        ChatSession s = chatService.getById(msg.getSessionId());
        if (s == null || s.getId1() == null || s.getId2() == null) return;
        String senderKey = msg.getSenderType() + ":" + msg.getSenderId();
        long senderEncoded = ChatParticipantId.encode(msg.getSenderType(), msg.getSenderId());
        String msgJson = JSON.toJSONString(msg);
        // 对方 id1 或 id2（编码ID）→ userType:rawId
        long otherEncoded = s.getId1().equals(senderEncoded) ? s.getId2() : s.getId1();
        String otherType = ChatParticipantId.getEntityType(otherEncoded) == 1 ? "USER" :
                ChatParticipantId.getEntityType(otherEncoded) == 2 ? "PLAYER" : "CS";
        long rawOther = ChatParticipantId.getRawId(otherEncoded);
        pushToMember(otherType, String.valueOf(rawOther), senderKey, msgJson);
        if ("CS".equals(otherType)) pushToMember("ADMIN", String.valueOf(rawOther), senderKey, msgJson);
    }

    private void pushToMember(String userType, String memberId, String senderKey, String msgJson) {
        String key = userType + ":" + memberId;
        if (key.equals(senderKey)) return; // 不推送给发送者
        WebSocketSession memberSession = sessionManager.get(key);
        if (memberSession != null && memberSession.isOpen()) {
            try {
                memberSession.sendMessage(new TextMessage(msgJson));
            } catch (IOException e) {
                log.warn("推送消息到{}失败", key);
            }
        }
    }

    private String filterSensitiveWords(String content) {
        if (content == null) return null;
        String[] words = {"开挂", "外挂", "代练骗子"};
        for (String w : words) content = content.replace(w, "***");
        return content;
    }

    private void closeQuietly(WebSocketSession session) {
        try { session.close(); } catch (IOException ignored) {}
    }
}
