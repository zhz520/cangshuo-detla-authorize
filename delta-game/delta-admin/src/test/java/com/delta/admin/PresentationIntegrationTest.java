package com.delta.admin;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.delta.common.exception.GlobalExceptionHandler;
import com.delta.common.file.controller.ImageThumbnailController;
import com.delta.common.file.service.impl.LocalFileServiceImpl;
import com.delta.common.mapper.CrossModuleMapper;
import com.delta.product.controller.ProductController;
import com.delta.product.enums.ProductLimitTypeEnum;
import com.delta.product.service.CategoryService;
import com.delta.product.service.RecommendCategoryService;
import com.delta.product.service.impl.ProductServiceImpl;
import com.delta.user.controller.AppProductController;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import java.time.LocalDateTime;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes=PresentationIntegrationTest.Config.class, properties={
    "spring.profiles.active=test", "spring.datasource.url=jdbc:h2:mem:presentation;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.datasource.type=com.zaxxer.hikari.HikariDataSource"
})
@AutoConfigureMockMvc(addFilters=false)
class PresentationIntegrationTest {
    @Configuration
    @EnableAutoConfiguration(excludeName={"com.alibaba.druid.spring.boot3.autoconfigure.DruidDataSourceAutoConfigure"})
    @MapperScan({"com.delta.product.mapper","com.delta.common.mapper"})
    @Import({ProductController.class, ProductServiceImpl.class, AppProductController.class, ImageThumbnailController.class, GlobalExceptionHandler.class})
    static class Config {
        @Bean MybatisPlusInterceptor pagination() { var plugin=new MybatisPlusInterceptor(); plugin.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL)); return plugin; }
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired CrossModuleMapper crossModuleMapper;
    @Autowired ImageThumbnailController thumbnails;
    @MockBean CategoryService categories;
    @MockBean RecommendCategoryService recommends;
    @TempDir Path directory;
    private final String imagePath="2026/10/24/0123456789abcdef0123456789abcdef.png";

    @BeforeEach void setup() {
        ReflectionTestUtils.setField(thumbnails,"uploadPath",directory.toString());
        jdbc.execute("DROP TABLE IF EXISTS product");
        jdbc.execute("CREATE TABLE product(id BIGINT PRIMARY KEY, category_id BIGINT, name VARCHAR(80), subtitle VARCHAR(80), description CLOB, cover_image VARCHAR(512), images CLOB, price DECIMAL(10,2),status INT,sort_order INT,sales_count INT,is_recommend INT,recommend_category_id BIGINT,avg_rating DECIMAL(3,2),review_count INT,commission_rate DECIMAL(4,2),per_user_limit_type INT,per_user_limit_enabled INT,per_user_limit_count INT,deleted INT DEFAULT 0,created_at TIMESTAMP,updated_at TIMESTAMP)");
        jdbc.execute("INSERT INTO product(id,category_id,name,price,status,sort_order,sales_count,is_recommend,recommend_category_id,created_at) VALUES (1,7,'first',50,1,2,20,1,3,'2026-10-01'),(2,7,'second',10,1,1,80,1,3,'2026-10-02'),(3,8,'third',100,1,1,80,1,4,'2026-10-03'),(4,7,'hidden',1,0,0,999,1,3,'2026-10-04')");
        jdbc.execute("DROP TABLE IF EXISTS `order`");
        jdbc.execute("CREATE TABLE `order`(id BIGINT PRIMARY KEY,user_id BIGINT,product_id BIGINT,status VARCHAR(32),created_at TIMESTAMP)");
    }
    @Test void allSortsUseActualDatabaseValuesAndStableTies() throws Exception {
        for (String[] item : new String[][]{{"sort","asc","3,2,1"},{"sales","desc","3,2,1"},{"newest","desc","3,2,1"},{"price","asc","2,1,3"},{"price","desc","3,1,2"}}) {
            var result=mvc.perform(get("/product/list").param("orderBy",item[0]).param("orderDir",item[1])).andExpect(status().isOk()).andReturn();
            var json=new com.fasterxml.jackson.databind.ObjectMapper().readTree(result.getResponse().getContentAsString());
            String ids=java.util.stream.StreamSupport.stream(json.path("data").path("records").spliterator(),false).map(row->row.path("id").asText()).collect(java.util.stream.Collectors.joining(","));
            assertThat(ids).isEqualTo(item[2]);
        }
    }
    @Test void sortFiltersPaginationAndPublicStatusComposeCorrectly() throws Exception {
        mvc.perform(get("/product/list").param("categoryId","7").param("orderBy","price").param("orderDir","desc").param("pageSize","1").param("pageNum","2").param("status","0"))
            .andExpect(jsonPath("$.data.total").value(2)).andExpect(jsonPath("$.data.records[0].id").value(2));
        mvc.perform(get("/product/list").param("orderBy","price; DROP TABLE product").param("orderDir","desc; DROP TABLE product"))
            .andExpect(jsonPath("$.data.total").value(3));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM product",Integer.class)).isEqualTo(4);
    }
    @Test void recommendationsAndAlternateAppEndpointShareSorting() throws Exception {
        mvc.perform(get("/product/recommend").param("categoryId","3").param("orderBy","price").param("orderDir","desc"))
            .andExpect(jsonPath("$.data.length()").value(2)).andExpect(jsonPath("$.data[0].id").value(1));
        mvc.perform(get("/app/product/list").param("sort","price_desc"))
            .andExpect(jsonPath("$.data.records[0].id").value(3));
    }
    private byte[] image(boolean transparent,int width,int height) throws Exception {
        var image=new BufferedImage(width,height,transparent?BufferedImage.TYPE_INT_ARGB:BufferedImage.TYPE_INT_RGB);
        for(int y=0;y<height;y++) for(int x=0;x<width;x++) image.setRGB(x,y,(transparent?0x80000000:0xff000000)|(x%256<<16)|(y%256<<8)|120);
        var output=new ByteArrayOutputStream(); ImageIO.write(image,"png",output); return output.toByteArray();
    }
    @Test void thumbnailReducesExistingImagesAndUsesCache() throws Exception {
        Path source=directory.resolve(imagePath); Files.createDirectories(source.getParent()); byte[] original=image(false,1400,900); Files.write(source,original);
        String url="/file/thumbnail/320/"+imagePath;
        var response=mvc.perform(get(url)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg")).andExpect(header().string("Cache-Control",org.hamcrest.Matchers.containsString("max-age="))).andReturn().getResponse();
        var decoded=ImageIO.read(new ByteArrayInputStream(response.getContentAsByteArray()));
        assertThat(decoded.getWidth()).isEqualTo(320); assertThat(decoded.getHeight()).isEqualTo(206);
        assertThat(response.getContentAsByteArray().length).isLessThan(original.length);
        mvc.perform(get(url)).andExpect(content().bytes(response.getContentAsByteArray()));
        mvc.perform(get(url).header("If-None-Match",response.getHeader("ETag"))).andExpect(status().isNotModified());
        assertThat(Files.readAllBytes(source)).isEqualTo(original);
    }
    @Test void thumbnailRejectsUnboundedSizesAndPrivatePaths() throws Exception {
        mvc.perform(get("/file/thumbnail/999/"+imagePath)).andExpect(status().isNotFound());
        mvc.perform(get("/file/thumbnail/320/wxpay/10/24/0123456789abcdef0123456789abcdef.png")).andExpect(status().isNotFound());
        mvc.perform(get("/file/thumbnail/320/2026/10/24/secrets.txt")).andExpect(status().isNotFound());
    }
    @Test void uploadsCompressPhotosAndKeepTransparency() throws Exception {
        var files=new LocalFileServiceImpl(); ReflectionTestUtils.setField(files,"uploadPath",directory.toString()); ReflectionTestUtils.setField(files,"urlPrefix","/file/");
        String photo=files.upload(new MockMultipartFile("file","photo.png","image/png",image(false,2400,1200)));
        assertThat(photo).endsWith(".jpg");
        var decoded=ImageIO.read(directory.resolve(photo.substring(6)).toFile()); assertThat(decoded.getWidth()).isEqualTo(1920); assertThat(decoded.getHeight()).isEqualTo(960);
        String logo=files.upload(new MockMultipartFile("file","logo.png","image/png",image(true,100,100)));
        assertThat(logo).endsWith(".png"); assertThat(ImageIO.read(directory.resolve(logo.substring(6)).toFile()).getColorModel().hasAlpha()).isTrue();
        assertThatThrownBy(()->files.upload(new MockMultipartFile("file","fake.png","image/png","not an image".getBytes()))).isInstanceOf(com.delta.common.exception.BusinessException.class);
    }
    @Test void dailyPurchaseLimitCountsOnlySuccessfulOrdersWithinRolling24Hours() {
        LocalDateTime now=LocalDateTime.of(2026,10,25,12,0);
        jdbc.update("INSERT INTO `order` VALUES (1,71,1,'PAID',?)",now.minusHours(1));
        jdbc.update("INSERT INTO `order` VALUES (2,71,1,'COMPLETED',?)",now.minusHours(25));
        jdbc.update("INSERT INTO `order` VALUES (3,71,1,'PENDING_PAYMENT',?)",now.minusHours(1));
        ProductLimitTypeEnum daily=ProductLimitTypeEnum.fromCode(4);
        assertThat(daily).isEqualTo(ProductLimitTypeEnum.DAILY);
        assertThat(daily.getLabel()).isEqualTo("一日限购一次");
        assertThat(daily.resolveWindowStart(now)).isEqualTo(now.minusDays(1));
        assertThat(daily.getExceededMessage()).contains("24小时");
        assertThat(crossModuleMapper.countUserProductOrdersSince(71L,1L,daily.resolveWindowStart(now))).isEqualTo(1);
    }
}
