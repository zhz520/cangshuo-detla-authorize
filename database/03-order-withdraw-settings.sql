-- Idempotent repair for deployments created before the order/withdraw
-- settings were included in the clean seed. Existing edited values are kept.
SET NAMES utf8mb4;

INSERT INTO sys_config (config_key,config_name,config_value,value_type,config_group)
VALUES ('withdraw.min_amount','最低提现金额','20','number','提现配置'),
       ('withdraw.max_daily_count','每日提现次数上限','1','number','提现配置'),
       ('order.auto_confirm_hours','自动确认收货时间','48','number','订单配置'),
       ('order.pay_deadline_minutes','支付超时时间','15','number','订单配置'),
       ('order.max_active_per_player','打手最大接单数','1','number','订单配置')
ON DUPLICATE KEY UPDATE config_key=VALUES(config_key);
