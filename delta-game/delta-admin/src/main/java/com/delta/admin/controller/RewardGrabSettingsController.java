package com.delta.admin.controller;

import com.delta.common.domain.R;
import com.delta.system.service.*;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/admin/reward-grab/settings")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class RewardGrabSettingsController {
    private final RewardGrabRulesService rules;
    private final FeatureAuditService audit;
    @GetMapping public R<RewardGrabRulesService.Rules> get() {return R.ok(rules.get());}
    @PutMapping
    @Transactional(rollbackFor=Exception.class)
    public R<Void> save(@Valid @RequestBody RewardGrabRulesService.Rules value) {
        var before=rules.get(); rules.save(value); audit.record("修改打赏与抢单验证设置",null,before,value); return R.ok();
    }
}
