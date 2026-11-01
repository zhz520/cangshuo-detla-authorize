package com.delta.common.domain;

import lombok.Data;

@Data
public class PageQuery {
    private Integer pageNum = 1;
    private Integer pageSize = 10;
    public Integer getPageNum() { return pageNum == null ? 1 : Math.max(1, Math.min(pageNum, 100000)); }
    public Integer getPageSize() { return pageSize == null ? 10 : Math.max(1, Math.min(pageSize, 100)); }
}
