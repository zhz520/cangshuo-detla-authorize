-- Fresh 742 schema. No source customer records.
-- Import only into a new, empty database.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admin` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '管理员ID',
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '用户名',
  `password` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '密码(BCrypt加密)',
  `nickname` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '昵称',
  `avatar` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '头像URL',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '角色: ADMIN-管理员 CS-客服 BOTH-双重角色',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '手机号',
  `phone_unique` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci GENERATED ALWAYS AS (if((`phone` = ''),NULL,`phone`)) STORED COMMENT '非空手机号唯一索引',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-正常 0-禁用',
  `login_fail_count` int NOT NULL DEFAULT '0' COMMENT '连续登录失败次数',
  `lock_time` datetime DEFAULT NULL COMMENT '锁定截止时间(失败5次锁定30分钟)',
  `last_login_at` datetime DEFAULT NULL COMMENT '最后登录时间',
  `last_login_ip` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '最后登录IP',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_username` (`username`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='管理员/客服表';

CREATE TABLE IF NOT EXISTS `banner` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '轮播图ID',
  `image_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '图片URL',
  `link_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'NONE' COMMENT '跳转类型: PRODUCT/CATEGORY/URL/NONE',
  `link_value` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '跳转值(商品ID/分类ID/外链URL)',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-启用 0-禁用',
  `start_time` datetime DEFAULT NULL COMMENT '生效开始时间',
  `end_time` datetime DEFAULT NULL COMMENT '生效结束时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_status_time` (`status`,`start_time`,`end_time`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='轮播图表';

CREATE TABLE IF NOT EXISTS `category` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '分类ID',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分类名称',
  `icon` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '分类图标URL',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序(数字越小越靠前)',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-启用 0-禁用',
  `parent_id` bigint NOT NULL DEFAULT '0' COMMENT '父分类ID(预留，当前均为0)',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='商品分类表';

CREATE TABLE IF NOT EXISTS `category_form_field` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `category_id` bigint NOT NULL COMMENT '父分类ID',
  `field_key` varchar(64) COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段键名(英文,存储用)',
  `field_label` varchar(64) COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段显示名(中文)',
  `field_type` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'TEXT' COMMENT '字段类型: TEXT/SELECT/TEXTAREA',
  `options` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'SELECT类型的选项,逗号分隔,如: 选项1,选项2,选项3',
  `placeholder` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '输入提示',
  `required` tinyint NOT NULL DEFAULT '1' COMMENT '是否必填: 1-是 0-否',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序(越小越靠前)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_category_id` (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='分类动态表单字段';

CREATE TABLE IF NOT EXISTS `chat_message` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  `conversation_id` bigint DEFAULT NULL,
  `session_id` bigint NOT NULL COMMENT '会话ID',
  `sender_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '发送者类型: USER/PLAYER/CS/SYSTEM',
  `sender_id` bigint DEFAULT NULL COMMENT '发送者ID(SYSTEM时为空)',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'TEXT' COMMENT '消息类型: TEXT/IMAGE/SYSTEM',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '消息内容(文本 或 图片URL)',
  `is_read` tinyint NOT NULL DEFAULT '0' COMMENT '是否已读: 1-已读 0-未读',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_session_created` (`session_id`,`created_at`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE,
  KEY `idx_conv_time` (`conversation_id`,`created_at`) USING BTREE,
  KEY `idx_conv_id` (`conversation_id`,`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='聊天消息表';

CREATE TABLE IF NOT EXISTS `chat_session` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `id1` bigint NOT NULL COMMENT '参与者1编码ID(较小)',
  `id2` bigint NOT NULL COMMENT '参与者2编码ID(较大)',
  `status` varchar(20) DEFAULT 'ACTIVE',
  `last_message_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_id1_id2` (`id1`,`id2`),
  KEY `idx_id1` (`id1`),
  KEY `idx_id2` (`id2`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='私聊会话(id1<id2)';

CREATE TABLE IF NOT EXISTS `complaint` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '投诉ID',
  `order_id` bigint NOT NULL COMMENT '订单ID',
  `user_id` bigint NOT NULL COMMENT '投诉用户ID',
  `player_id` bigint NOT NULL COMMENT '被投诉打手ID(主接打手)',
  `type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '投诉类型: SERVICE_QUALITY/TIMEOUT/ACCOUNT_ISSUE/FRAUD/OTHER',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '投诉内容',
  `images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '证据图片URL，多个以逗号分隔',
  `expected_result` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '期望结果: FULL_REFUND/PARTIAL_REFUND/REDO',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING' COMMENT '状态: PENDING/PROCESSING/RESOLVED/APPEALED',
  `result` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '仲裁结果: FULL_REFUND/PARTIAL_REFUND/REJECT/REDO',
  `refund_amount` decimal(10,2) DEFAULT NULL COMMENT '裁定退款金额(部分退款时)',
  `result_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT '仲裁理由',
  `player_penalty` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '打手处罚: WARNING/DEDUCT_RATING/FREEZE/NONE',
  `operator_id` bigint DEFAULT NULL COMMENT '处理客服ID',
  `resolved_at` datetime DEFAULT NULL COMMENT '仲裁时间',
  `appeal_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT '申诉理由',
  `appeal_images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '申诉证据图片，多个以逗号分隔',
  `appeal_result` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '终审结果',
  `appeal_operator_id` bigint DEFAULT NULL COMMENT '终审处理人(管理员ID)',
  `appeal_resolved_at` datetime DEFAULT NULL COMMENT '终审时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `cs_read_at` datetime DEFAULT NULL COMMENT '客服查看时间（未读红点）',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_order_id` (`order_id`) USING BTREE,
  KEY `idx_user_id` (`user_id`) USING BTREE,
  KEY `idx_player_id` (`player_id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='投诉表';

CREATE TABLE IF NOT EXISTS `content_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `config_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '配置键(如:about_us/faq/guide)',
  `config_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '配置值(富文本/JSON)',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '备注说明',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_config_key` (`config_key`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='内容配置表';

CREATE TABLE IF NOT EXISTS `notice` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '公告ID',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '公告标题',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '公告内容',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'SYSTEM' COMMENT '类型: SYSTEM-系统公告 ACTIVITY-活动公告',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-启用 0-禁用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `popup_display` tinyint NOT NULL DEFAULT '0' COMMENT '是否首页弹窗展示: 1-是 0-否',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='公告表';

CREATE TABLE IF NOT EXISTS `operation_log` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `module` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '操作模块',
  `operation` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '操作类型(LOGIN/CREATE/UPDATE/DELETE等)',
  `operator_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '操作者类型: ADMIN/CS',
  `operator_id` bigint NOT NULL COMMENT '操作者ID',
  `operator_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '操作者名称',
  `target_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '操作对象类型(如:ORDER/PLAYER/USER)',
  `target_id` bigint DEFAULT NULL COMMENT '操作对象ID',
  `detail` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT '操作详情',
  `ip` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '操作IP',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_operator` (`operator_type`,`operator_id`) USING BTREE,
  KEY `idx_module` (`module`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='操作日志表';

CREATE TABLE IF NOT EXISTS `order` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '订单号(雪花算法生成)',
  `user_id` bigint NOT NULL COMMENT '下单用户ID',
  `product_id` bigint NOT NULL COMMENT '商品ID',
  `product_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '商品名称(下单快照)',
  `spec_info` json DEFAULT NULL COMMENT '规格快照JSON',
  `amount` decimal(10,2) NOT NULL COMMENT '订单金额',
  `commission_rate` decimal(5,4) DEFAULT NULL COMMENT '下单时快照的抽佣比例(0~1)',
  `game_account` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '游戏账号',
  `contact` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '联系方式',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '用户备注',
  `extra_fields` json DEFAULT NULL COMMENT '动态表单字段JSON',
  `required_player_count` tinyint NOT NULL DEFAULT '1' COMMENT '需要打手数量(下单快照)',
  `designated_player_id` bigint DEFAULT NULL COMMENT '用户指定打手ID(可为空)',
  `player_id` bigint DEFAULT NULL COMMENT '主接打手ID',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING_PAYMENT' COMMENT '订单状态',
  `pay_deadline` datetime DEFAULT NULL COMMENT '支付截止时间(创建时间+30min)',
  `assign_time` datetime DEFAULT NULL COMMENT '指派时间',
  `accept_time` datetime DEFAULT NULL COMMENT '接单时间',
  `teammate_deadline` datetime DEFAULT NULL COMMENT '组队截止时间(仅多人订单)',
  `start_time` datetime DEFAULT NULL COMMENT '服务开始时间',
  `complete_time` datetime DEFAULT NULL COMMENT '服务完成时间',
  `confirm_time` datetime DEFAULT NULL COMMENT '确认完成时间',
  `auto_confirm_deadline` datetime DEFAULT NULL COMMENT '自动确认截止时间(完成+24h)',
  `settled` tinyint NOT NULL DEFAULT '0' COMMENT '是否已结算: 1-是 0-否',
  `settle_amount` decimal(10,2) DEFAULT NULL COMMENT '打手总结算金额(扣除平台抽成)',
  `settle_time` datetime DEFAULT NULL COMMENT '结算时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_order_no` (`order_no`) USING BTREE,
  KEY `idx_user_id_status` (`user_id`,`status`) USING BTREE,
  KEY `idx_player_id_status` (`player_id`,`status`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE,
  KEY `idx_status_pay_deadline` (`status`,`pay_deadline`) USING BTREE,
  KEY `idx_status_auto_confirm` (`status`,`auto_confirm_deadline`) USING BTREE,
  KEY `idx_status_teammate_deadline` (`status`,`teammate_deadline`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='订单表';

CREATE TABLE IF NOT EXISTS `order_player` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `order_id` bigint NOT NULL COMMENT '订单ID',
  `player_id` bigint NOT NULL COMMENT '打手ID',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '角色: PRIMARY-主接 TEAMMATE-队友',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ACCEPTED' COMMENT '状态: INVITED/ACCEPTED/REJECTED/EXPIRED/RELEASED',
  `split_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '分成方式: FIFTY_FIFTY/FORTY_SIXTY/THIRTY_SEVENTY/CUSTOM',
  `split_ratio` decimal(5,2) DEFAULT NULL COMMENT '分成比例(%，如50.00表示50%)',
  `split_amount` decimal(10,2) DEFAULT NULL COMMENT '自定义金额(仅CUSTOM时有值)',
  `invited_by` bigint DEFAULT NULL COMMENT '邀请人ID(队友记录时为主接打手ID)',
  `invited_at` datetime DEFAULT NULL COMMENT '邀请时间',
  `invite_deadline` datetime DEFAULT NULL COMMENT '邀请响应截止时间',
  `accepted_at` datetime DEFAULT NULL COMMENT '接受时间',
  `rejected_at` datetime DEFAULT NULL COMMENT '拒绝时间',
  `settle_amount` decimal(10,2) DEFAULT NULL COMMENT '个人结算金额',
  `settled_at` datetime DEFAULT NULL COMMENT '结算时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_order_id` (`order_id`) USING BTREE,
  KEY `idx_player_id` (`player_id`) USING BTREE,
  KEY `idx_status_role` (`status`,`role`) USING BTREE,
  KEY `idx_invite_deadline` (`status`,`invite_deadline`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='订单参与打手表';

CREATE TABLE IF NOT EXISTS `order_progress` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `order_id` bigint NOT NULL COMMENT '订单ID',
  `type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '类型: STATUS_CHANGE/PROGRESS_UPDATE/TEAMMATE_INVITED/TEAMMATE_ACCEPTED/TEAMMATE_REJECTED/DISPUTE_CREATED/COMPLETED',
  `operator_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '操作者类型: USER/PLAYER/CS/ADMIN/SYSTEM',
  `operator_id` bigint DEFAULT NULL COMMENT '操作者ID(SYSTEM时为空)',
  `from_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '变更前状态',
  `to_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '变更后状态',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '进度说明文字',
  `images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '截图URL，多个以逗号分隔',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_order_id` (`order_id`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='订单进度记录表';

CREATE TABLE IF NOT EXISTS `order_relay_request` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `original_player_id` bigint NOT NULL,
  `split_type` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `split_amount` decimal(10,2) DEFAULT NULL,
  `reason` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(32) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING',
  `new_player_id` bigint DEFAULT NULL,
  `reviewed_by` bigint DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `reject_reason` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='订单接力申请';

CREATE TABLE IF NOT EXISTS `payment` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '支付ID',
  `payment_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '支付单号',
  `order_id` bigint DEFAULT NULL COMMENT '订单ID(押金支付时为空)',
  `user_id` bigint NOT NULL COMMENT '支付用户ID',
  `biz_type` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ORDER' COMMENT '业务类型: ORDER-订单支付 PLAYER_DEPOSIT-打手押金',
  `amount` decimal(10,2) NOT NULL COMMENT '支付金额',
  `recharge_bonus` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '余额充值赠送金额',
  `pay_method` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '支付方式: WECHAT-微信 BALANCE-余额',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PAYING' COMMENT '状态: PAYING/PAID/FAILED/REFUNDING/REFUNDED',
  `wx_transaction_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '微信支付交易号',
  `wx_prepay_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '微信预支付ID',
  `refund_amount` decimal(10,2) DEFAULT NULL COMMENT '退款金额',
  `refund_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '退款单号',
  `refund_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '退款原因',
  `refund_time` datetime DEFAULT NULL COMMENT '退款完成时间',
  `paid_at` datetime DEFAULT NULL COMMENT '支付成功时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_payment_no` (`payment_no`) USING BTREE,
  UNIQUE KEY `uk_wx_transaction_id` (`wx_transaction_id`) USING BTREE,
  UNIQUE KEY `uk_refund_no` (`refund_no`) USING BTREE,
  KEY `idx_order_id` (`order_id`) USING BTREE,
  KEY `idx_user_id` (`user_id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='支付记录表';

CREATE TABLE IF NOT EXISTS `player` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '打手ID',
  `openid` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '微信openid',
  `nickname` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '昵称',
  `avatar` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '头像URL',
  `real_name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '真实姓名',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '联系方式',
  `skill_tags` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `game_level` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '游戏段位/等级',
  `level` int NOT NULL DEFAULT '1' COMMENT '平台打手等级',
  `introduction` varchar(1000) NOT NULL DEFAULT '' COMMENT '公开个人简介',
  `cover_image` varchar(512) NOT NULL DEFAULT '',
  `album_images` text,
  `story` text,
  `voice_url` varchar(512) NOT NULL DEFAULT '',
  `voice_duration` int NOT NULL DEFAULT 0,
  `proof_images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '技能证明截图，多个以逗号分隔',
  `service_types` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `avg_rating` decimal(3,2) NOT NULL DEFAULT '5.00' COMMENT '平均评分(1.00~5.00)',
  `order_count` int NOT NULL DEFAULT '0' COMMENT '累计接单数',
  `complete_rate` decimal(5,2) NOT NULL DEFAULT '100.00' COMMENT '完成率(%)',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING' COMMENT '状态: PENDING-待审核 ACTIVE-正常 REJECTED-已驳回 FROZEN-已冻结',
  `frozen_until` datetime DEFAULT NULL COMMENT '冻结截止时间',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '驳回原因',
  `deposit_payment_no` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '打手入驻押金支付单号(100元)',
  `last_online_at` datetime DEFAULT NULL COMMENT '最后在线时间',
  `is_online` tinyint NOT NULL DEFAULT '0' COMMENT '是否在线: 0-离线 1-在线',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_openid` (`openid`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='打手表';

CREATE TABLE IF NOT EXISTS `player_account` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '账户ID',
  `player_id` bigint NOT NULL COMMENT '打手ID',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '账户类型: WECHAT-微信 ALIPAY-支付宝',
  `account_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '真实姓名',
  `account_no` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '账号',
  `qrcode_url` varchar(512) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '收款码图片URL（支付宝/微信）',
  `is_default` tinyint NOT NULL DEFAULT '0' COMMENT '是否默认: 1-是 0-否',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_player_id` (`player_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='打手提现账户表';

CREATE TABLE IF NOT EXISTS `player_replace_request` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL COMMENT '订单ID',
  `user_id` bigint NOT NULL COMMENT '申请用户ID',
  `old_player_id` bigint DEFAULT NULL COMMENT '被换打手ID',
  `reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '换人原因',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED',
  `operator_id` bigint DEFAULT NULL COMMENT '处理客服ID',
  `operator_remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '客服备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_order_id` (`order_id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='换人申请';

CREATE TABLE IF NOT EXISTS `player_wallet` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '钱包ID',
  `player_id` bigint NOT NULL COMMENT '打手ID',
  `balance` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '可用余额',
  `frozen_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '冻结金额(提现审核中)',
  `total_income` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '累计收入',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_player_id` (`player_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='打手钱包表';

CREATE TABLE IF NOT EXISTS `price_rule` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '规则ID',
  `product_id` bigint NOT NULL COMMENT '商品ID',
  `spec_combination` json NOT NULL COMMENT '规格组合(如:{"当前段位":"青铜","目标段位":"白银"})',
  `price` decimal(10,2) NOT NULL COMMENT '售价',
  `original_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '原价(划线价)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_product_id` (`product_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='价格规则表';

CREATE TABLE IF NOT EXISTS `product` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '商品ID',
  `category_id` bigint NOT NULL COMMENT '所属分类ID',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '商品名称',
  `subtitle` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '商品副标题',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT '商品描述',
  `cover_image` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '封面图URL',
  `images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详情图URL，多个以逗号分隔',
  `required_player_count` tinyint NOT NULL DEFAULT '1' COMMENT '需要打手数量(1-单人 2-双人组队)',
  `status` tinyint NOT NULL DEFAULT '0' COMMENT '状态: 1-上架 0-下架',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `sales_count` int NOT NULL DEFAULT '0' COMMENT '销量',
  `avg_rating` decimal(3,2) NOT NULL DEFAULT '5.00' COMMENT '平均评分',
  `commission_rate` decimal(5,4) DEFAULT NULL COMMENT '商品级抽佣比例(0~1),为NULL则使用系统默认',
  `review_count` int NOT NULL DEFAULT '0' COMMENT '评价数',
  `is_recommend` tinyint NOT NULL DEFAULT '0' COMMENT '是否推荐: 1-是 0-否',
  `recommend_category_id` bigint DEFAULT NULL COMMENT '所属热门推荐分类',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `price` decimal(10,2) DEFAULT NULL COMMENT '商品价格',
  `per_user_limit_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否开启每人限购（0关 1开）',
  `per_user_limit_count` int DEFAULT NULL COMMENT '每个用户最多可购买次数',
  `per_user_limit_type` tinyint NOT NULL DEFAULT '0' COMMENT '每人限购类型: 0-不限购 1-永久限购一次 2-7天限购一次 3-1个月限购一次',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_category_status` (`category_id`,`status`) USING BTREE,
  KEY `idx_status_sort` (`status`,`sort_order`) USING BTREE,
  KEY `idx_status_sales` (`status`,`sales_count`) USING BTREE,
  KEY `idx_product_recommend_category` (`recommend_category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='商品表';

CREATE TABLE IF NOT EXISTS `product_spec` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '规格ID',
  `product_id` bigint NOT NULL COMMENT '商品ID',
  `spec_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '规格名称(如:当前段位、目标段位)',
  `spec_values` json NOT NULL COMMENT '可选值列表(如:["青铜","白银","黄金"])',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_product_id` (`product_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='商品规格表';

CREATE TABLE IF NOT EXISTS `quick_reply` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `category` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分类: ORDER-订单 COMPLAINT-投诉 GENERAL-通用',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '回复内容',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-启用 0-禁用',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_category` (`category`,`status`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='快捷回复表';

CREATE TABLE IF NOT EXISTS `recommend_category` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(32) COLLATE utf8mb4_general_ci NOT NULL COMMENT '编码',
  `name` varchar(64) COLLATE utf8mb4_general_ci NOT NULL COMMENT '展示名称',
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='热门推荐分类';

CREATE TABLE IF NOT EXISTS `review` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '评价ID',
  `order_id` bigint NOT NULL COMMENT '订单ID',
  `user_id` bigint NOT NULL COMMENT '评价用户ID',
  `player_id` bigint NOT NULL COMMENT '被评价打手ID(主接打手)',
  `product_id` bigint NOT NULL COMMENT '商品ID(便于按商品查评价)',
  `rating` tinyint NOT NULL COMMENT '星级评分(1-5)',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '评价文字(最多200字)',
  `images` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '评价图片URL，多个以逗号分隔',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除(管理员可删违规评价)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_order_id` (`order_id`) USING BTREE,
  KEY `idx_player_id` (`player_id`) USING BTREE,
  KEY `idx_product_id` (`product_id`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='评价表';

CREATE TABLE IF NOT EXISTS `sensitive_word` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `word` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '敏感词',
  `category` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '分类: DIRTY/AD/POLITICAL/OTHER',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-启用 0-禁用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='敏感词表';

CREATE TABLE IF NOT EXISTS `statistics_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `stat_date` date NOT NULL COMMENT '统计日期',
  `new_user_count` int NOT NULL DEFAULT '0' COMMENT '新增用户数',
  `active_user_count` int NOT NULL DEFAULT '0' COMMENT '活跃用户数',
  `new_order_count` int NOT NULL DEFAULT '0' COMMENT '新增订单数',
  `completed_order_count` int NOT NULL DEFAULT '0' COMMENT '完成订单数',
  `cancelled_order_count` int NOT NULL DEFAULT '0' COMMENT '取消订单数',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '成交总额',
  `platform_income` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '平台收入',
  `player_income` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '打手总收入',
  `new_player_count` int NOT NULL DEFAULT '0' COMMENT '新增打手数',
  `active_player_count` int NOT NULL DEFAULT '0' COMMENT '活跃打手数',
  `new_complaint_count` int NOT NULL DEFAULT '0' COMMENT '新增投诉数',
  `avg_order_amount` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '平均客单价',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_stat_date` (`stat_date`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='每日统计快照表';

CREATE TABLE IF NOT EXISTS `subscribe_message_log` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '接收者类型: USER/PLAYER',
  `user_id` bigint NOT NULL COMMENT '接收者ID',
  `template_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '消息模板ID',
  `data` json NOT NULL COMMENT '发送数据JSON',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '发送状态: SUCCESS/FAIL',
  `error_msg` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '失败原因',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_user` (`user_type`,`user_id`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='微信订阅消息发送日志表';

CREATE TABLE IF NOT EXISTS `sys_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `config_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '配置键',
  `config_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '配置名称',
  `config_value` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '配置值',
  `value_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'text' COMMENT '值类型: text/number/boolean/textarea',
  `config_group` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '基础配置' COMMENT '配置分组',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '备注说明',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_config_key` (`config_key`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='系统配置表';

CREATE TABLE IF NOT EXISTS `system_notification` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `receiver_type` varchar(20) NOT NULL COMMENT 'USER/PLAYER/CS',
  `receiver_id` bigint NOT NULL DEFAULT '0' COMMENT '接收者ID，CS 时 0 表示全体客服',
  `title` varchar(200) NOT NULL DEFAULT '',
  `content` varchar(1000) DEFAULT NULL,
  `biz_type` varchar(64) DEFAULT NULL COMMENT '业务类型 ORDER_ASSIGNED/ORDER_PAID 等',
  `related_id` bigint DEFAULT NULL,
  `is_read` tinyint NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_receiver` (`receiver_type`,`receiver_id`),
  KEY `idx_receiver_unread` (`receiver_type`,`receiver_id`,`is_read`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统通知';

CREATE TABLE IF NOT EXISTS `transaction` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '交易ID',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '类型: INCOME/CONSUMPTION/REFUND/WITHDRAW/WITHDRAW_REJECT/RECHARGE',
  `user_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '账户类型: USER/PLAYER',
  `user_id` bigint NOT NULL COMMENT '用户/打手ID',
  `amount` decimal(12,2) NOT NULL COMMENT '交易金额(正-入账 负-出账)',
  `balance_before` decimal(12,2) NOT NULL COMMENT '变动前余额',
  `balance_after` decimal(12,2) NOT NULL COMMENT '变动后余额',
  `related_order_id` bigint DEFAULT NULL COMMENT '关联订单ID',
  `related_payment_id` bigint DEFAULT NULL COMMENT '关联支付记录ID',
  `related_withdraw_id` bigint DEFAULT NULL COMMENT '关联提现记录ID',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '备注(如:主接分成/队友分成)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_user` (`user_type`,`user_id`) USING BTREE,
  KEY `idx_type` (`type`) USING BTREE,
  KEY `idx_related_order` (`related_order_id`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='交易流水表';

CREATE TABLE IF NOT EXISTS `user` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `openid` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '微信openid',
  `nickname` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '微信用户' COMMENT '昵称',
  `avatar` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '头像URL',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '手机号',
  `phone_unique` varchar(20) GENERATED ALWAYS AS (NULLIF(`phone`,'')) STORED COMMENT '非空手机号唯一索引',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1-正常 0-封禁',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '逻辑删除: 0-未删除 1-已删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_openid` (`openid`) USING BTREE,
  UNIQUE KEY `uk_phone_unique` (`phone_unique`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='用户表';

CREATE TABLE IF NOT EXISTS `user_game_info` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `category_id` bigint DEFAULT NULL COMMENT '分类ID',
  `game_account` varchar(255) DEFAULT NULL,
  `contact` varchar(255) DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `saved_fields` json DEFAULT NULL COMMENT '动态表单字段JSON',
  `label` varchar(128) DEFAULT NULL COMMENT '保存标签',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_user_category` (`user_id`,`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户保存的游戏信息';

CREATE TABLE IF NOT EXISTS `user_subscribe` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `template_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '消息模板ID',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '授权状态: 1-已授权 0-已取消',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_user_template` (`user_id`,`template_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='用户订阅消息授权表';

CREATE TABLE IF NOT EXISTS `wallet` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '钱包ID',
  `user_id` bigint NOT NULL COMMENT '用户ID',
  `balance` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '可用余额',
  `frozen_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '冻结金额',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_user_id` (`user_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='用户钱包表';

CREATE TABLE IF NOT EXISTS `withdraw` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '提现ID',
  `player_id` bigint NOT NULL COMMENT '打手ID',
  `account_id` bigint NOT NULL COMMENT '提现账户ID',
  `account_type_snapshot` varchar(20) DEFAULT NULL COMMENT '申请时收款账户类型快照',
  `account_name_snapshot` varchar(128) DEFAULT NULL COMMENT '申请时收款人快照',
  `account_no_snapshot` varchar(256) DEFAULT NULL COMMENT '申请时收款账号快照',
  `account_qrcode_snapshot` varchar(512) DEFAULT NULL COMMENT '申请时收款码快照',
  `amount` decimal(10,2) NOT NULL COMMENT '提现金额',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING' COMMENT '状态: PENDING-待处理 COMPLETED-已完成 REJECTED-已拒绝',
  `pay_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '实际打款方式(管理员填写)',
  `proof_image` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '打款凭证图片URL',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '拒绝原因',
  `processed_by` bigint DEFAULT NULL COMMENT '处理人(管理员ID)',
  `processed_at` datetime DEFAULT NULL COMMENT '处理时间',
  `last_notify_at` datetime DEFAULT NULL COMMENT '上次提醒管理员时间(防重复提醒)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_player_id` (`player_id`) USING BTREE,
  KEY `idx_status` (`status`) USING BTREE,
  KEY `idx_created_at` (`created_at`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='提现记录表';

CREATE TABLE IF NOT EXISTS player_level (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(30) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  status tinyint NOT NULL DEFAULT 1,
  deleted tinyint NOT NULL DEFAULT 0,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='player_level' AND column_name='grab_captcha_required')=0,
 'ALTER TABLE player_level ADD COLUMN grab_captcha_required tinyint NOT NULL DEFAULT 1', 'SELECT 1');

PREPARE feature_stmt FROM @sql;

EXECUTE feature_stmt;

DEALLOCATE PREPARE feature_stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='player' AND column_name='grab_captcha_override')=0,
 'ALTER TABLE player ADD COLUMN grab_captcha_override tinyint NOT NULL DEFAULT -1', 'SELECT 1');

PREPARE feature_stmt FROM @sql;

EXECUTE feature_stmt;

DEALLOCATE PREPARE feature_stmt;

CREATE TABLE IF NOT EXISTS player_reward (
 id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
 reward_no varchar(40) NOT NULL,
 request_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id bigint NOT NULL, player_id bigint NOT NULL, order_id bigint NOT NULL,
 order_no varchar(64) NOT NULL,
 amount decimal(12,2) NOT NULL, fee decimal(12,2) NOT NULL, income decimal(12,2) NOT NULL,
 fee_percent decimal(5,2) NOT NULL,
 user_balance_before decimal(12,2) NOT NULL, user_balance_after decimal(12,2) NOT NULL,
 player_balance_before decimal(12,2) NOT NULL, player_balance_after decimal(12,2) NOT NULL,
 reversal_user_balance_before decimal(12,2), reversal_user_balance_after decimal(12,2),
 reversal_player_balance_before decimal(12,2), reversal_player_balance_after decimal(12,2),
 payment_method varchar(16) NOT NULL DEFAULT 'BALANCE',
 remark varchar(200), status varchar(24) NOT NULL,
 pending_recovery decimal(12,2) NOT NULL DEFAULT 0,
 reversal_reason varchar(200), reversal_admin_id bigint, reversed_at datetime,
 created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uk_reward_no(reward_no), UNIQUE KEY uk_order_reward(order_id),
 UNIQUE KEY uk_user_reward_request(user_id,request_id),
 KEY idx_reward_user_date(user_id,created_at), KEY idx_reward_player_date(player_id,created_at),
 KEY idx_reward_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='user' AND column_name='password')=0,
 'ALTER TABLE `user` ADD COLUMN `password` varchar(100) DEFAULT NULL COMMENT ''BCrypt hash''', 'SELECT 1');

PREPARE user_auth_stmt FROM @sql;

EXECUTE user_auth_stmt;

DEALLOCATE PREPARE user_auth_stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='user' AND column_name='auth_version')=0,
 'ALTER TABLE `user` ADD COLUMN auth_version bigint NOT NULL DEFAULT 0', 'SELECT 1');

PREPARE user_auth_stmt FROM @sql;

EXECUTE user_auth_stmt;

DEALLOCATE PREPARE user_auth_stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='player_level' AND column_name='price_increase_rate')=0, 'ALTER TABLE player_level ADD COLUMN price_increase_rate DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT ''等级涨价百分比''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='player' AND column_name='price_increase_rate')=0, 'ALTER TABLE player ADD COLUMN price_increase_rate DECIMAL(5,2) NOT NULL DEFAULT -1 COMMENT ''-1跟随等级，0不涨价，其他为百分比''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order' AND column_name='base_amount')=0, 'ALTER TABLE `order` ADD COLUMN base_amount DECIMAL(10,2) DEFAULT NULL COMMENT ''商品原价快照''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order' AND column_name='price_increase_rate')=0, 'ALTER TABLE `order` ADD COLUMN price_increase_rate DECIMAL(5,2) DEFAULT NULL COMMENT ''下单涨价比例快照''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order' AND column_name='price_increase_amount')=0, 'ALTER TABLE `order` ADD COLUMN price_increase_amount DECIMAL(10,2) DEFAULT NULL COMMENT ''下单涨价金额快照''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order' AND column_name='requested_player_level_id')=0, 'ALTER TABLE `order` ADD COLUMN requested_player_level_id INT DEFAULT NULL COMMENT ''指定接单等级''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order' AND column_name='player_level_name')=0, 'ALTER TABLE `order` ADD COLUMN player_level_name VARCHAR(30) DEFAULT NULL COMMENT ''等级名称快照''', 'SELECT 1');

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;
