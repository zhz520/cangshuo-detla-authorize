package com.delta.common.config;

import com.delta.common.security.filter.JwtAuthenticationFilter;
import com.delta.common.security.handler.AccessDeniedHandlerImpl;
import com.delta.common.security.handler.AuthenticationEntryPointImpl;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityCustomizer;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {
    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final AuthenticationEntryPointImpl authenticationEntryPoint;
    private final AccessDeniedHandlerImpl accessDeniedHandler;

    @Bean
    public WebSecurityCustomizer webSecurityCustomizer() {
        return web -> { };
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.cors(org.springframework.security.config.Customizer.withDefaults())
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(e -> e.authenticationEntryPoint(authenticationEntryPoint)
                                     .accessDeniedHandler(accessDeniedHandler))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET,"/user/auth/captcha").permitAll()
                .requestMatchers(HttpMethod.POST, "/user/auth/login", "/user/auth/h5-login", "/user/auth/set-password", "/user/auth/password-login", "/user/auth/sms-code", "/player/auth/login", "/player/auth/register", "/cs/auth/login").permitAll()
                .requestMatchers(HttpMethod.POST, "/pay/wx/notify", "/pay/wx/refund-notify").permitAll()
                .requestMatchers("/maintenance/**").hasRole("ADMIN")
                .requestMatchers("/ws/**").permitAll()
                .requestMatchers("/file/wxpay/**").denyAll()
                .requestMatchers(HttpMethod.GET, "/file/**").permitAll()
                .requestMatchers("/common/file/**").hasAnyRole("ADMIN", "CS", "USER", "PLAYER")
                .requestMatchers(HttpMethod.GET, "/product/list", "/product/recommend", "/product/recommend/categories", "/product/{id}", "/product/category/list", "/product/category/all", "/product/category/tree", "/product/category/*/form-fields").permitAll()
                // 以上 product 接口供匿名访问（含首页热门推荐、热门分类 Tab）
                .requestMatchers(HttpMethod.GET, "/app/product/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/app/players/*/reviewable-orders").hasRole("USER")
                .requestMatchers(HttpMethod.GET, "/app/players", "/app/players/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/order/review/product/**", "/order/review/player/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/system/banner/active", "/system/notice/active", "/system/content/key/**", "/system/config/site", "/system/recharge-packages").permitAll()
                .requestMatchers("/doc.html", "/webjars/**", "/v3/api-docs/**", "/swagger-resources/**").hasRole("ADMIN")
                // 下单选打手：普通用户、打手、客服、管理员均可访问（复用客服指派打手接口）
                .requestMatchers("/cs/player/assign-list").hasAnyRole("ADMIN", "CS", "USER")
                // 聊天：普通用户、打手、客服、管理员均可访问
                .requestMatchers("/common/chat/**").hasAnyRole("ADMIN", "CS", "USER", "PLAYER")
                .requestMatchers(HttpMethod.GET, "/player/apply/status").hasRole("USER")
                .requestMatchers(HttpMethod.POST, "/player/apply").hasRole("USER")
                .requestMatchers("/player/**").hasRole("PLAYER")
                .requestMatchers("/user/**", "/order/**", "/pay/recharge/**", "/pay/balance/**", "/pay/h5/**", "/pay/wx/**", "/pay/player-deposit").hasRole("USER")
                .requestMatchers("/product/**", "/app/product/**").hasRole("ADMIN")
                // 聊天记录: 管理员和客服均可查看
                .requestMatchers("/admin/chat/**").hasAnyRole("ADMIN", "CS")
                // 角色权限控制: /admin/** 和 /system/** 仅管理员可访问
                .requestMatchers("/admin/**").hasRole("ADMIN")
                // 快捷回复: 管理员和客服均可访问
                .requestMatchers("/system/quick-reply/**").hasAnyRole("ADMIN", "CS")
                .requestMatchers("/system/admin/**", "/system/sensitive-word/**",
                        "/system/notice/**", "/system/banner/**",
                        "/system/config/**", "/system/content/**", "/system/operation-log/**",
                        "/system/statistics/**").hasRole("ADMIN")
                // /cs/** (auth已permitAll) 管理员和客服均可访问
                .requestMatchers("/cs/**").hasAnyRole("ADMIN", "CS")
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
