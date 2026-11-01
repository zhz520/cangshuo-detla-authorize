package com.delta.common.exception;

import com.delta.common.domain.R;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.BindException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public org.springframework.http.ResponseEntity<R<?>> handleResponseStatus(org.springframework.web.server.ResponseStatusException e) {
        return org.springframework.http.ResponseEntity.status(e.getStatusCode()).body(R.fail(e.getStatusCode().value(), "请求的资源不可用"));
    }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public R<?> handleUnreadableBody(org.springframework.http.converter.HttpMessageNotReadableException e) {
        // Do not log parser excerpts: authentication request bodies can contain passwords or setup tickets.
        return R.fail(400,"请求内容格式不正确");
    }
    @ExceptionHandler(jakarta.validation.ConstraintViolationException.class)
    public R<?> handleConstraintViolation(jakarta.validation.ConstraintViolationException e) {
        return R.fail(400, "参数不符合要求");
    }
    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public R<?> handleAccessDenied(org.springframework.security.access.AccessDeniedException e) {
        return R.fail(403, "无权限访问");
    }

    @ExceptionHandler(BusinessException.class)
    public R<?> handleBusiness(BusinessException e, HttpServletRequest req) {
        log.error("业务异常: {} URI: {}", e.getMessage(), req.getRequestURI());
        return R.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public R<?> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldError() != null
                ? e.getBindingResult().getFieldError().getDefaultMessage() : "参数校验失败";
        return R.fail(400, msg);
    }

    @ExceptionHandler(BindException.class)
    public R<?> handleBind(BindException e) {
        String msg = e.getFieldError() != null ? e.getFieldError().getDefaultMessage() : "参数绑定失败";
        return R.fail(400, msg);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public R<?> handleMethod(HttpRequestMethodNotSupportedException e) {
        return R.fail(405, "请求方法不支持: " + e.getMethod());
    }

    @ExceptionHandler(Exception.class)
    public R<?> handleException(Exception e, HttpServletRequest req) {
        log.error("系统异常: {} URI: {}", e.getMessage(), req.getRequestURI(), e);
        return R.fail(500, "服务暂时不可用，请稍后重试");
    }
}
