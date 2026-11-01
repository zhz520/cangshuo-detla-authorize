package com.delta.common.chat.util;

import com.delta.common.exception.BusinessException;
import com.delta.common.chat.domain.entity.ChatSession;

/** Chat identities always come from the authenticated principal, never the client. */
public final class ChatIdentity {
    private ChatIdentity() {}
    public static String role(String actual, String requested) {
        String resolved="ADMIN".equals(actual)?"CS":actual;
        String claimed="ADMIN".equals(requested)?"CS":requested;
        if(resolved==null || !java.util.Set.of("USER","PLAYER","CS").contains(resolved)
                || claimed!=null && !claimed.equals(resolved)) throw new BusinessException(403,"聊天身份不匹配");
        return resolved;
    }
    public static long encoded(String actual, Long id) {
        if(id==null || id<=0 || id>=1_000_000_000L) throw new BusinessException(403,"聊天身份无效");
        return ChatParticipantId.encode(role(actual,null),id);
    }
    public static void requireMember(ChatSession session,long id) {
        if(session==null || !"ACTIVE".equals(session.getStatus())
                || !(Long.valueOf(id).equals(session.getId1()) || Long.valueOf(id).equals(session.getId2())))
            throw new BusinessException(403,"无权限操作该会话");
    }
    public static void validateMessage(String type,String content) {
        if(type==null || !java.util.Set.of("TEXT","IMAGE","PRODUCT","ORDER").contains(type)
                || content==null || content.isBlank() || content.length()>4000)
            throw new BusinessException(400,"消息类型或长度不符合要求");
        if("IMAGE".equals(type) && !(content.startsWith("/file/") || content.startsWith("https://")))
            throw new BusinessException(400,"图片地址无效");
    }
}
