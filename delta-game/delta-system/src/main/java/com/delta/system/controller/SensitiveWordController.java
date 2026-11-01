package com.delta.system.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.delta.common.annotation.OpLog;
import com.delta.common.domain.PageQuery;
import com.delta.common.domain.R;
import com.delta.system.entity.SensitiveWord;
import com.delta.system.service.SensitiveWordService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/system/sensitive-word")
@RequiredArgsConstructor
public class SensitiveWordController {
    private final SensitiveWordService sensitiveWordService;

    @GetMapping("/list")
    public R<Page<SensitiveWord>> list(PageQuery query, @RequestParam(value = "category", required = false) String category) {
        LambdaQueryWrapper<SensitiveWord> wrapper = new LambdaQueryWrapper<SensitiveWord>()
                .eq(category != null, SensitiveWord::getCategory, category)
                .orderByDesc(SensitiveWord::getCreatedAt);
        return R.ok(sensitiveWordService.page(new Page<>(query.getPageNum(), query.getPageSize()), wrapper));
    }

    @OpLog(module = "system", operation = "新增敏感词")
    @PostMapping
    public R<Void> add(@RequestBody SensitiveWord word) { sensitiveWordService.save(word); return R.ok(); }

    @OpLog(module = "system", operation = "编辑敏感词")
    @PutMapping
    public R<Void> update(@RequestBody SensitiveWord word) { sensitiveWordService.updateById(word); return R.ok(); }

    @OpLog(module = "system", operation = "删除敏感词")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) { sensitiveWordService.removeById(id); return R.ok(); }
}
