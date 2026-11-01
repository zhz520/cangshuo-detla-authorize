package com.delta.system.service;

import com.alibaba.fastjson2.JSON;
import com.delta.common.security.utils.SecurityUtils;
import com.delta.system.entity.OperationLog;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FeatureAuditService {
    private final OperationLogService logs;
    public void record(String operation, Long target, Object before, Object after) {
        OperationLog log=new OperationLog(); log.setModule("reward-grab"); log.setOperation(operation);
        log.setOperatorType("ADMIN"); log.setOperatorId(SecurityUtils.getUserId());
        log.setTargetType("reward-grab"); log.setTargetId(target);
        log.setDetail(JSON.toJSONString(Map.of("before",before==null?"":before,"after",after==null?"":after)));
        log.setCreatedAt(LocalDateTime.now()); logs.save(log);
    }
}
