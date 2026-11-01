package com.delta.admin.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.R;
import com.delta.order.dto.ReviewView;
import com.delta.order.mapper.ReviewMapper;
import com.delta.order.service.ReviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/admin/review")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminReviewController {
    private final ReviewMapper reviewMapper;
    private final ReviewService reviewService;

    @GetMapping("/list")
    public R<Page<ReviewView>> list(@RequestParam(defaultValue="1") int pageNum,
                                  @RequestParam(defaultValue="10") int pageSize,
                                  @RequestParam(required=false) Long playerId) {
        return R.ok(reviewMapper.selectViews(new Page<>(Math.max(1,pageNum),Math.min(50,Math.max(1,pageSize))),playerId));
    }

    @DeleteMapping("/{id}")
    @OpLog(module="review",operation="删除打手评价")
    public R<Void> delete(@PathVariable Long id) {
        return reviewService.deleteAndRefreshRatings(id) ? R.ok() : R.fail(404,"评价不存在或已删除");
    }
}
