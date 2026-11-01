package com.delta.admin.controller;

import com.delta.common.domain.R;
import com.delta.common.annotation.OpLog;
import com.delta.product.entity.RecommendCategory;
import com.delta.product.service.RecommendCategoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 热门推荐分类管理（PC 后台）
 */
@RestController
@RequestMapping("/admin/recommend-category")
@RequiredArgsConstructor
public class AdminRecommendCategoryController {
    private final RecommendCategoryService recommendCategoryService;

    @GetMapping("/list")
    public R<List<RecommendCategory>> list() {
        return R.ok(recommendCategoryService.listAll());
    }

    @OpLog(module = "product", operation = "新增热门分类")
    @PostMapping
    public R<Void> add(@RequestBody RecommendCategory body) {
        recommendCategoryService.save(body);
        return R.ok();
    }

    @OpLog(module = "product", operation = "编辑热门分类")
    @PutMapping
    public R<Void> update(@RequestBody RecommendCategory body) {
        recommendCategoryService.updateById(body);
        return R.ok();
    }

    @OpLog(module = "product", operation = "删除热门分类")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        recommendCategoryService.removeById(id);
        return R.ok();
    }
}
