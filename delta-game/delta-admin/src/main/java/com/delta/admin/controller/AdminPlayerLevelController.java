package com.delta.admin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.R;
import com.delta.player.entity.*;
import com.delta.player.service.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/admin/player-level")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminPlayerLevelController {
    private final PlayerLevelService levels;
    private final PlayerService players;
    private final com.delta.system.service.FeatureAuditService featureAudit;
    public record LevelRequest(@NotBlank @Size(max=30) String name,
            @NotNull @Min(0) @Max(99999) Integer sortOrder, @NotNull @Min(0) @Max(1) Integer status,
            @Min(0) @Max(1) Integer grabCaptchaRequired,
            @DecimalMin("0") @DecimalMax("100") @Digits(integer=3,fraction=2) java.math.BigDecimal priceIncreaseRate) {}
    @GetMapping("/list")
    public R<List<PlayerLevel>> list() { return R.ok(levels.ordered(false)); }
    @PostMapping
    @OpLog(module="player-level",operation="新增打手等级分类")
    @org.springframework.transaction.annotation.Transactional(rollbackFor=Exception.class)
    public R<PlayerLevel> create(@Valid @RequestBody LevelRequest body) { return save(null,body); }
    @PutMapping("/{id}")
    @OpLog(module="player-level",operation="更新打手等级分类")
    @org.springframework.transaction.annotation.Transactional(rollbackFor=Exception.class)
    public R<PlayerLevel> update(@PathVariable Integer id,@Valid @RequestBody LevelRequest body) { return save(id,body); }
    private R<PlayerLevel> save(Integer id,LevelRequest body) {
        if(id!=null&&levels.getById(id)==null) return R.fail(404,"分类不存在");
        if(id==null&&levels.count()>=50) return R.fail(400,"最多设置50个等级分类");
        String name=body.name().trim();
        if(levels.count(new LambdaQueryWrapper<PlayerLevel>().eq(PlayerLevel::getName,name).ne(id!=null,PlayerLevel::getId,id))>0) return R.fail(400,"分类名称已存在");
        PlayerLevel level=new PlayerLevel();level.setId(id);level.setName(name);level.setSortOrder(body.sortOrder());level.setStatus(body.status());
        level.setGrabCaptchaRequired(body.grabCaptchaRequired()==null?(id==null?1:levels.getById(id).getGrabCaptchaRequired()):body.grabCaptchaRequired());
        PlayerLevel before=id==null?null:levels.getById(id);
        level.setPriceIncreaseRate(body.priceIncreaseRate()!=null?body.priceIncreaseRate():
                before==null?java.math.BigDecimal.ZERO:before.getPriceIncreaseRate());
        levels.saveOrUpdate(level);featureAudit.record("修改打手等级验证规则",level.getId().longValue(),before,level);return R.ok(level);
    }
    @DeleteMapping("/{id}")
    @OpLog(module="player-level",operation="删除打手等级分类")
    public R<Void> delete(@PathVariable Integer id) {
        if(id==1) return R.fail(400,"默认分类可改名或停用，不能删除");
        if(players.count(new LambdaQueryWrapper<Player>().eq(Player::getLevel,id))>0) return R.fail(400,"分类下仍有打手，请先调整其分类或停用分类");
        return levels.removeById(id)?R.ok():R.fail(404,"分类不存在");
    }
}
