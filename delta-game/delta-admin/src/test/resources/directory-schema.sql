DROP TABLE IF EXISTS review;
DROP TABLE IF EXISTS player;
DROP TABLE IF EXISTS player_level;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS `user`;
DROP TABLE IF EXISTS `order`;
CREATE TABLE player_level(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(30),sort_order INT DEFAULT 0,status INT DEFAULT 1,grab_captcha_required INT DEFAULT 1,price_increase_rate DECIMAL(5,2) DEFAULT 0,deleted INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
INSERT INTO player_level(id,name,sort_order,status) VALUES(1,'高级打手',20,1),(2,'金牌打手',10,1),(3,'停用分类',30,0);
CREATE TABLE player (
 id BIGINT PRIMARY KEY, openid VARCHAR(64), nickname VARCHAR(64), avatar VARCHAR(512),
 real_name VARCHAR(32), phone VARCHAR(20), skill_tags VARCHAR(500), game_level VARCHAR(64),
 cover_image VARCHAR(512) DEFAULT '',album_images CLOB,story CLOB,voice_url VARCHAR(512) DEFAULT '',voice_duration INT DEFAULT 0,
 level INT DEFAULT 1, grab_captcha_override INT DEFAULT -1,price_increase_rate DECIMAL(5,2) DEFAULT -1, introduction VARCHAR(1000) DEFAULT '', proof_images VARCHAR(4096),
 service_types VARCHAR(500), avg_rating DECIMAL(3,2) DEFAULT 0, order_count INT DEFAULT 0,
 complete_rate DECIMAL(5,2) DEFAULT 100, status VARCHAR(20), reject_reason VARCHAR(255),
 deposit_payment_no VARCHAR(64), frozen_until TIMESTAMP, last_online_at TIMESTAMP,
 is_online INT DEFAULT 0, deleted INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE review (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, order_id BIGINT, user_id BIGINT, player_id BIGINT,
 product_id BIGINT, rating INT, content VARCHAR(500), images VARCHAR(4096), deleted INT DEFAULT 0,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE product (id BIGINT PRIMARY KEY, avg_rating DECIMAL(3,2) DEFAULT 0, review_count INT DEFAULT 0);
CREATE TABLE `user` (id BIGINT PRIMARY KEY, nickname VARCHAR(64), avatar VARCHAR(512), password VARCHAR(100), auth_version BIGINT DEFAULT 0, deleted INT DEFAULT 0);
CREATE TABLE `order` (id BIGINT PRIMARY KEY, order_no VARCHAR(64),user_id BIGINT,player_id BIGINT,
 product_id BIGINT,product_name VARCHAR(128),status VARCHAR(32),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
INSERT INTO player(id,nickname,level,status,real_name,phone,openid,introduction,avg_rating) VALUES
 (1,'测试打手',2,'ACTIVE','私密姓名','13900000000','private-openid','擅长团队协作',4),
 (2,'冻结打手',2,'FROZEN','','','','',0),
 (3,'一级打手',1,'ACTIVE','','','','',0);
INSERT INTO product(id,avg_rating,review_count) VALUES (11,4,1);
INSERT INTO `user`(id,nickname,avatar) VALUES(7,'张同学','/avatar.png');
INSERT INTO `order`(id,order_no,user_id,player_id,product_id,product_name,status)
 VALUES(100,'ORDER100',7,1,11,'体验单','CONFIRMED');
INSERT INTO review(id,order_id,user_id,player_id,product_id,rating,content,deleted)
 VALUES(9,99,7,1,11,4,'服务认真',0),(10,98,7,1,11,1,'旧评价',1);

CREATE TABLE IF NOT EXISTS sys_config(id BIGINT AUTO_INCREMENT PRIMARY KEY,config_key VARCHAR(128),config_value VARCHAR(512));
