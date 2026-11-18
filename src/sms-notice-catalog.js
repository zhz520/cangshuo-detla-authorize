export const noticeRoles = [['user','客户'],['player','打手'],['admin','管理员'],['cs','客服']]
export const noticeGroups = [['new_order','新订单'],['order_status','订单进度'],['refund_status','退款与提现'],['complaint_status','投诉处理'],['staff_review','入驻、素材与人员审核']]
export const noticeVariables = ['orderNo','status','orderStatus','time','eventType','productName','amount','orderAmount','refundAmount','withdrawAmount','payDeadline']
export const noticeCatalog = noticeGroups.flatMap(([group,sceneLabel]) => noticeRoles.map(([role,roleLabel]) =>
  ({key:'notice_'+role+'_'+group,group,role,sceneLabel,roleLabel,name:roleLabel+' · '+sceneLabel})))
