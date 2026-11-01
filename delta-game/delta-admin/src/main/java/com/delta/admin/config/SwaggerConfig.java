package com.delta.admin.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class SwaggerConfig implements WebMvcConfigurer {

    @Value("${file.upload.path:D:/data/upload}")
    private String uploadPath;

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info().title("斜阳电竞 API").version("1.0").description("Delta Game Boosting Platform"))
                .addSecurityItem(new SecurityRequirement().addList("Authorization"))
                .schemaRequirement("Authorization",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT"));
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Swagger
        registry.addResourceHandler("doc.html")
                .addResourceLocations("classpath:/META-INF/resources/");
        registry.addResourceHandler("/webjars/**")
                .addResourceLocations("classpath:/META-INF/resources/webjars/");
        // 上传文件静态资源映射: /file/** -> 本地磁盘
        String location = "file:" + uploadPath.replace("\\", "/");
        if (!location.endsWith("/")) location += "/";
        registry.addResourceHandler("/file/**")
                .addResourceLocations(location)
                .setCacheControl(org.springframework.http.CacheControl.maxAge(java.time.Duration.ofDays(30)).cachePublic())
                .resourceChain(true).addResolver(new org.springframework.web.servlet.resource.PathResourceResolver() {
                    @Override protected org.springframework.core.io.Resource getResource(String resourcePath,org.springframework.core.io.Resource location) throws java.io.IOException {
                        if(!resourcePath.matches("\\d{4}/\\d{2}/\\d{2}/[a-fA-F0-9-]{32,36}\\.(?i:png|jpg|jpeg|gif|webp|mp3|m4a|wav|aac|ogg|webm)")) return null;
                        return super.getResource(resourcePath,location);
                    }
                });
    }
}
