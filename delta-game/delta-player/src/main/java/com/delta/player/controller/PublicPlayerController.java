package com.delta.player.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.domain.R;
import com.delta.player.dto.PublicPlayerVO;
import com.delta.player.entity.Player;
import com.delta.player.service.PlayerService;
import com.delta.player.service.PlayerLevelService;
import com.delta.player.service.PlayerDirectoryService;
import com.delta.player.entity.PlayerLevel;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/app/players")
@RequiredArgsConstructor
@Validated
public class PublicPlayerController {
    private final PlayerService playerService;
    private final PlayerLevelService levelService;
    private final PlayerDirectoryService directory;

    @GetMapping("/levels")
    public R<List<Integer>> levels() {
        List<Integer> levels = levelService.ordered(true).stream().map(PlayerLevel::getId).toList();
        return R.ok(levels);
    }

    @GetMapping("/categories")
    public R<List<PlayerLevel>> categories() { return R.ok(levelService.ordered(true)); }

    @GetMapping
    public R<Page<PublicPlayerVO>> list(
            @RequestParam(defaultValue = "1") @Min(1) int pageNum,
            @RequestParam(defaultValue = "12") @Min(1) @Max(50) int pageSize,
            @RequestParam(required = false) @Min(1) Integer level,
            @RequestParam(required = false) @Size(max = 50) String keyword) {
        LambdaQueryWrapper<Player> query = directory.visibleQuery().eq(level != null, Player::getLevel, level)
                .like(keyword != null && !keyword.isBlank(), Player::getNickname, keyword)
                .orderByDesc(Player::getIsOnline).orderByDesc(Player::getAvgRating).orderByAsc(Player::getId);
        Page<Player> page = playerService.page(new Page<>(pageNum, pageSize), query);
        Page<PublicPlayerVO> result = new Page<>(pageNum, pageSize, page.getTotal());
        result.setRecords(page.getRecords().stream().map(directory::view).toList());
        return R.ok(result);
    }

    @GetMapping("/{id}")
    public R<PublicPlayerVO> detail(@PathVariable Long id) {
        return R.ok(directory.detail(id));
    }
}
