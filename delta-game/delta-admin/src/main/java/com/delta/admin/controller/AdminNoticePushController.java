package com.delta.admin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.R;
import com.delta.common.exception.BusinessException;
import com.delta.system.entity.Notice;
import com.delta.system.service.NoticeService;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/system/notice")
@RequiredArgsConstructor
public class AdminNoticePushController {
    private final NoticeService notices;
    private final JdbcTemplate jdbc;

    @OpLog(module="system",operation="推送公告")
    @PostMapping("/{id}/push")
    @Transactional(rollbackFor=Exception.class)
    public R<Map<String,Integer>> push(@PathVariable Long id) {
        Notice notice=notices.getOne(new LambdaQueryWrapper<Notice>().eq(Notice::getId,id).last("FOR UPDATE"));
        if(notice==null || Integer.valueOf(1).equals(notice.getDeleted())) throw new BusinessException(404,"公告不存在");
        if(notice.getTitle()==null || notice.getTitle().length()>200 || notice.getContent()==null || notice.getContent().length()>1000)
            throw new BusinessException(400,"公告标题或内容长度不符合要求");
        String sql="INSERT INTO system_notification(receiver_type,receiver_id,title,content,biz_type,related_id,is_read,created_at) "
            +"SELECT ?,t.id,?,?, 'NOTICE', ?,0,NOW() FROM %s t WHERE t.deleted=0 AND %s "
            +"AND NOT EXISTS (SELECT 1 FROM system_notification n WHERE n.receiver_type=? AND n.receiver_id=t.id AND n.biz_type='NOTICE' AND n.related_id=?)";
        int users=jdbc.update(sql.formatted("`user`","t.status=1"),"USER",notice.getTitle(),notice.getContent(),id,"USER",id);
        int players=jdbc.update(sql.formatted("player","t.status='ACTIVE'"),"PLAYER",notice.getTitle(),notice.getContent(),id,"PLAYER",id);
        return R.ok(Map.of("users",users,"players",players,"total",users+players));
    }
}
