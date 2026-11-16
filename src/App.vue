<template>
  <div v-if="!ready" class="boot" role="status"><template v-if="bootError"><p role="alert">{{ bootError }}</p><el-button type="primary" @click="connect">重新连接</el-button></template><template v-else>正在连接运营中心…</template></div>
  <main v-else-if="!loggedIn" class="login-page">
    <section class="login-card"><div class="brand-mark">C</div><p class="eyebrow">CANGSHUO · CONTROL CENTER</p><h1>授权运营中心</h1><p class="muted">管理客户、模块、授权与版本发布</p>
      <el-form label-position="top" @submit.prevent="login"><el-form-item label="运营账号"><el-input v-model="credentials.username" autocomplete="username" /></el-form-item><el-form-item label="密码"><el-input v-model="credentials.password" type="password" autocomplete="current-password" show-password /></el-form-item><el-button native-type="submit" type="primary" :loading="loginBusy" class="login-submit">登录运营后台</el-button></el-form>
    </section>
  </main>
  <div v-else class="shell" :class="{ 'is-collapsed': sidebarCollapsed }">
    <button v-if="menuOpen" class="nav-backdrop" aria-label="关闭菜单" @click="menuOpen=false"/><aside :class="{'is-open':menuOpen}"><div class="brand"><div class="brand-mark">C</div><div class="brand-copy"><strong>沧烁授权中心</strong><small>系统运营工作台</small></div></div><nav class="nav-scroll" aria-label="运营菜单"><section v-for="group in navigationGroups" :key="group.name" class="nav-section"><div class="nav-label">{{ group.name }}</div><button v-for="item in group.items" :key="item.id" :class="{selected:page===item.id}" :aria-current="page===item.id?'page':undefined" :title="item.name" @click="page=item.id;menuOpen=false"><component :is="item.icon"/><span>{{ item.name }}</span></button></section></nav><div class="aside-bottom">独立运营后台<br/>客户业务系统单独维护</div></aside>
    <div class="workspace"><header>
      <div class="header-title">
        <button class="menu-toggle" aria-label="打开菜单" :aria-expanded="menuOpen" @click="menuOpen=!menuOpen">☰</button>
        <button class="collapse-toggle" aria-label="折叠侧栏" :aria-expanded="!sidebarCollapsed" @click="sidebarCollapsed=!sidebarCollapsed">☰</button>
        <span class="breadcrumb">平台运营 / 授权中心 / </span><strong>{{ title }}</strong>
      </div>
      <div class="header-actions" @pointerdown.stop>
        <div class="global-search" :class="{ active: searchOpen }" @click="activateGlobalSearch">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input ref="globalSearchInput" v-model="globalQuery" aria-label="全局搜索" placeholder="搜索客户、项目、授权号…" autocomplete="off" @focus="openHeaderPanel('search')" @keydown.enter="selectFirstSearchResult" @keydown.esc="closeHeaderPanels">
          <div v-if="searchOpen && globalQuery.trim()" class="header-panel search-results-panel">
            <button v-for="result in searchResults" :key="result.key" type="button" class="search-result" @click.stop="selectSearchResult(result)">
              <span><strong>{{ result.title }}</strong><small>{{ result.meta }}</small></span>
              <span aria-hidden="true">›</span>
            </button>
            <p v-if="!searchResults.length" class="header-panel-empty">没有匹配的客户、项目或授权记录</p>
          </div>
        </div>
        <div class="header-popover notification-wrap">
          <button type="button" class="header-icon-button" aria-label="最近操作通知" :aria-expanded="notificationsOpen" @click.stop="toggleHeaderPanel('notifications')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
            <i v-if="data.audit.length" class="notification-dot"></i>
          </button>
          <section v-if="notificationsOpen" class="header-panel notifications-panel">
            <header><strong>最近操作</strong><button type="button" @click="go('audit');notificationsOpen=false">查看全部</button></header>
            <button v-for="row in recentAudit" :key="row.id || row.created_at" type="button" class="notification-item" @click="go('audit');notificationsOpen=false">
              <span class="notification-item-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="m9 12 2 2 5-5"/></svg></span>
              <span><strong>{{ actionLabels[row.action] || row.action }}</strong><small>{{ row.actor }} · {{ time(row.created_at) }}</small></span>
            </button>
            <p v-if="!recentAudit.length" class="header-panel-empty">暂无最近操作</p>
          </section>
        </div>
        <div class="header-popover account-wrap">
          <button type="button" class="user-chip" :aria-expanded="accountOpen" @click.stop="toggleHeaderPanel('account')">
            <span class="user-avatar">{{ username.slice(0, 1) }}</span><span class="user-name">{{ username }}</span><svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <section v-if="accountOpen" class="header-panel account-panel">
            <div class="account-summary"><span class="user-avatar">{{ username.slice(0, 1) }}</span><span><strong>{{ username }}</strong><small>运营账号</small></span></div>
            <button type="button" class="account-action" :disabled="logoutBusy" @click="logout">{{ logoutBusy ? '正在退出…' : '退出登录' }}</button>
          </section>
        </div>
      </div>
    </header>
      <section class="content" :aria-busy="busy">
        <div class="page-heading"><div><p class="eyebrow">{{ page==='overview'?'CONTROL CENTER':'PLATFORM MANAGEMENT' }}</p><h1 ref="heading" tabindex="-1">{{ title }}</h1><p class="muted">{{ descriptions[page] }}</p></div><div class="actions"><el-button :loading="busy" @click="refresh">{{ busy?'加载中':'刷新' }}</el-button><el-button v-if="createActions[page]" type="primary" @click="open(createActions[page])">{{ createLabels[page] }}</el-button><el-button v-if="page==='licenses'" type="primary" @click="showPublicKey">查看验证公钥</el-button></div></div>
        <el-alert v-if="dataError" class="data-error" :title="(loaded?'刷新失败，当前显示上次加载的数据：':'数据加载失败：')+dataError" type="error" :closable="false" show-icon/><div v-if="busy&&!loaded" class="page-loading" role="status">正在加载运营数据…</div>
        <template v-if="loaded&&page==='overview'">
          <section class="overview-hero">
            <div class="hero-copy">
              <span class="hero-line"></span>
              <p class="hero-eyebrow">CONTROL CENTER</p>
              <h2>沧烁授权中心</h2>
              <p>统一管理客户授权、开通流程与交付状态。</p>
            </div>
            <div class="hero-visual" aria-hidden="true"><span class="hero-shape shape-a"></span><span class="hero-shape shape-b"></span><span class="hero-shape shape-c"></span></div>
          </section>
          <div class="stats">
            <article v-for="item in stats" :key="item.name" class="stat-card" @click="go(item.target)">
              <div class="stat-head"><span class="stat-icon"><component :is="item.icon" /></span><span class="stat-name">{{ item.name }}</span><span class="stat-arrow">›</span></div>
              <strong>{{ item.value }}</strong>
              <small>{{ item.detail }}</small>
            </article>
          </div>
          <el-card shadow="never" class="overview-card process-card">
            <template #header><div class="section-title"><span>开通流程</span><el-button type="primary" @click="open('project')">立即开通 <span class="button-arrow">›</span></el-button></div></template>
            <div class="process-track">
              <div v-for="(step,index) in processSteps" :key="step.title" class="process-step" :class="{ done: step.done, active: step.active }">
                <span class="process-node">{{ index + 1 }}</span>
                <div class="process-copy"><strong>{{ step.title }}</strong><small>{{ step.subtitle }}</small></div>
              </div>
            </div>
            <p class="process-note">在线支付由微信回调验签后确认，人工订单由运营人员核对收款。客户系统只使用验证公钥，签发私钥保留在本运营中心。</p>
          </el-card>
          <el-card shadow="never" class="overview-card recent-card">
            <template #header><div class="section-title"><span>最近操作</span><el-button text @click="page='audit'">查看更多 <span class="button-arrow">›</span></el-button></div></template>
            <el-table :data="data.audit.slice(0,6)" class="recent-table">
              <el-table-column label="时间" min-width="180"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column>
              <el-table-column prop="actor" label="运营账号" min-width="120"/>
              <el-table-column label="操作" min-width="180"><template #default="{row}">{{ actionLabels[row.action] || row.action }}</template></el-table-column>
              <el-table-column prop="target" label="关联编号" min-width="240" show-overflow-tooltip/>
              <el-table-column label="状态" width="110"><template #default><el-tag size="small" type="success">已完成</el-tag></template></el-table-column>
            </el-table>
            <el-empty v-if="!data.audit.length" description="暂无操作记录" />
          </el-card>
        </template>
                <SupportAdmin v-if="loaded&&page==='support'" :api="api" :customers="data.customers"/>
        <UsageAccounts v-if="loaded&&page==='usage'" :api="api"/>
        <KeepAlive><Operations v-if="loaded&&operationsPages.includes(page)" :page="page" :data="data" :api="api" :refresh="refreshAfterWrite" @publish="publish"/></KeepAlive>
        <KeepAlive><ServiceGroups v-if="loaded&&page==='serviceGroups'" :data="data" :api="api" :refresh="refreshAfterWrite"/></KeepAlive>
        <el-card v-if="loaded&&page!=='overview'&&page!=='support'&&page!=='usage'&&page!=='serviceGroups'&&!operationsPages.includes(page)" shadow="never"><div class="table-toolbar"><strong>{{ title }}列表</strong><el-input v-model="search" placeholder="搜索编号、名称或状态" clearable aria-label="搜索当前列表" class="search"/></div>
          <el-table v-if="page==='customers'" :data="records" stripe><el-table-column prop="id" label="客户编号" min-width="130"/><el-table-column prop="name" label="客户名称" min-width="180"/><el-table-column label="状态"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'info'">{{ status(row.status) }}</el-tag></template></el-table-column><el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip/><el-table-column label="登记时间" min-width="180"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column><el-table-column label="操作" min-width="130"><template #default="{row}"><el-button link type="primary" @click="open('customer',row)">编辑</el-button><el-button link type="danger" @click="removeCustomer(row)">删除</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='instances'" :data="records" stripe><el-table-column prop="name" label="实例名称" min-width="140"/><el-table-column prop="customer_name" label="所属客户" min-width="140"/><el-table-column prop="id" label="实例编号" min-width="300"/><el-table-column label="运行时租户" min-width="130"><template #default="{row}"><code v-if="row.runtime_tenant_id">{{ row.runtime_tenant_id }}</code><span v-else class="muted">未登记</span></template></el-table-column><el-table-column label="域名授权" min-width="220"><template #default="{row}">{{ (row.domains||[]).join('、') }}</template></el-table-column><el-table-column label="维护期至" min-width="180"><template #default="{row}">{{ time(row.maintenance_until) }}</template></el-table-column><el-table-column label="客户端版本" min-width="210"><template #default="{row}"><span>{{ row.client_version || '待客户端上报' }}</span> <el-tag v-if="row.update_available" type="warning" size="small">可更新 {{ row.latest_version }}</el-tag> <el-tag v-else-if="row.client_version" type="success" size="small">最新</el-tag><br/><small class="muted">自动上报：{{ row.last_seen_at ? time(row.last_seen_at) : '—' }}</small></template></el-table-column><el-table-column label="操作"><template #default="{row}"><el-button link type="primary" @click="open('instance',row)">编辑</el-button><el-button link @click="exportIdentity(row)">接入凭据</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='modules'" :data="records" stripe><el-table-column prop="name" label="模块名称" min-width="150"/><el-table-column prop="id" label="模块编号" min-width="210"/><el-table-column label="所属平台" min-width="130"><template #default="{row}">{{ productName(row.product_id) }}</template></el-table-column><el-table-column prop="description" label="功能说明" min-width="240" show-overflow-tooltip/><el-table-column prop="min_version" label="最低版本" min-width="100"/><el-table-column label="价格"><template #default="{row}">{{ row.price_cents==null?'尚未定价':money(row.price_cents) }}</template></el-table-column><el-table-column label="状态"><template #default="{row}"><el-tag :type="row.status==='ACTIVE'?'success':'info'">{{ status(row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" min-width="150"><template #default="{row}"><el-button link type="primary" @click="open('module',row)">编辑</el-button><el-button link type="danger" @click="removeModule(row)">删除</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='entitlements'" :data="records" stripe><el-table-column prop="customer_name" label="客户" min-width="130"/><el-table-column prop="instance_name" label="实例" min-width="140"><template #default="{row}">{{ row.instance_name }}<br/><small class="muted">{{ row.instance_id }}</small></template></el-table-column><el-table-column prop="module_name" label="功能" min-width="150"><template #default="{row}">{{ row.module_name }}<br/><small class="muted">{{ row.module_id }}</small></template></el-table-column><el-table-column label="授权状态" min-width="130"><template #default="{row}"><el-switch v-model="row.enabled" :loading="entitlementBusy===row.instance_id+':'+row.module_id" :disabled="!!entitlementBusy" :aria-label="'切换 '+row.module_name" @change="toggleEntitlement(row,$event)"/><el-tag class="status-tag" :type="entitlementTag(row.status)" size="small">{{ entitlementStatus(row.status) }}</el-tag></template></el-table-column><el-table-column label="开始 / 到期" min-width="210"><template #default="{row}"><span>{{ time(row.valid_from) }}</span><br/><span>{{ time(row.valid_until) }}</span></template></el-table-column><el-table-column label="剩余天数" width="105"><template #default="{row}"><strong>{{ row.remaining_days }}</strong> 天</template></el-table-column><el-table-column label="价格周期" min-width="150"><template #default="{row}">{{ money(row.price_cents) }} / {{ row.term_days }} 天</template></el-table-column><el-table-column label="操作" min-width="210"><template #default="{row}"><el-button link type="primary" @click="open('entitlement',row)">编辑</el-button><el-button link type="success" @click="startEntitlementRenewal(row)">续费</el-button><el-button link type="danger" @click="removeEntitlement(row)">删除</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='orders'" :data="records" stripe><el-table-column prop="id" label="订单编号" min-width="280"/><el-table-column prop="customer_name" label="客户" min-width="130"/><el-table-column prop="module_name" label="功能模块" min-width="150"/><el-table-column label="订单金额"><template #default="{row}">{{ money(row.amount_cents) }}</template></el-table-column><el-table-column label="授权区间" min-width="230"><template #default="{row}">{{ row.valid_from ? time(row.valid_from)+' 至 '+time(row.valid_until) : '缺少报价快照' }}<br/><small class="muted">实际新增 {{ orderActualDays(row) == null ? '待确认' : orderActualDays(row)+' 天' }}</small></template></el-table-column><el-table-column label="状态" min-width="140"><template #default="{row}"><el-tag :type="row.granted_at?'success':row.status==='PAID'?'warning':'info'">{{ row.granted_at?'已交付授权':status(row.status) }}</el-tag><br/><small v-if="row.refund_reference" class="muted">退款 {{ row.refund_reference }}</small></template></el-table-column><el-table-column label="操作" min-width="260"><template #default="{row}"><el-button v-if="row.status==='UNPAID'" link type="primary" @click="open('payment',row)">确认收款</el-button><el-button v-if="row.status==='UNPAID'" link type="primary" @click="maintenanceGrant(row)">维护期接入</el-button><el-button v-if="!row.granted_at&&['UNPAID','PAID','MAINTENANCE'].includes(row.status)" link type="danger" @click="cancelOrder(row)">{{ row.status==='PAID'?'退款作废':'作废' }}</el-button><el-button v-if="(row.status==='PAID'||row.status==='MAINTENANCE')" link type="primary" @click="issue(row)">{{ row.granted_at?'查看授权':'签发授权' }}</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='licenses'" :data="records" stripe><el-table-column prop="id" label="授权编号" min-width="290"/><el-table-column prop="customer_id" label="客户编号" min-width="120"/><el-table-column prop="instance_id" label="绑定实例" min-width="300"/><el-table-column label="域名授权" min-width="200"><template #default="{row}">{{ (row.domains||[]).join('、') }}</template></el-table-column><el-table-column label="签发时间" min-width="180"><template #default="{row}">{{ time(row.issued_at) }}</template></el-table-column><el-table-column label="维护期/授权到期" min-width="180"><template #default="{row}">{{ time(row.expires_at) }}</template></el-table-column><el-table-column label="操作"><template #default="{row}"><el-button link type="primary" @click="viewLicense(row)">查看交付内容</el-button></template></el-table-column></el-table>
          <el-table v-if="page==='releases'" :data="records" stripe><el-table-column prop="version" label="版本号" min-width="180"/><el-table-column label="通道"><template #default="{row}">{{ row.channel==='stable'?'正式版':'预览版' }}</template></el-table-column><el-table-column prop="notes" label="更新说明" min-width="220" show-overflow-tooltip/><el-table-column label="状态"><template #default="{row}"><el-tag :type="row.status==='PUBLISHED'?'success':'info'">{{ status(row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" min-width="190"><template #default="{row}"><el-button v-if="row.status==='DRAFT'" link type="primary" @click="publish(row)">发布版本信息</el-button><a v-if="row.status==='PUBLISHED'" :href="publicReleaseUrl(row)" target="_blank" rel="noopener noreferrer">查看发布说明</a></template></el-table-column></el-table>
          <el-table v-if="page==='audit'" :data="records" stripe><el-table-column label="时间" min-width="180"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column><el-table-column prop="actor" label="运营账号"/><el-table-column label="操作" min-width="180"><template #default="{row}">{{ actionLabels[row.action] || row.action }}</template></el-table-column><el-table-column prop="target" label="关联编号" min-width="280"/><el-table-column prop="detail" label="操作记录" min-width="240" show-overflow-tooltip/></el-table>
          <ListPager :total="total" :state="listState"/>
        </el-card>
      </section>
    </div>
    <el-dialog v-model="dialog" :title="dialogTitle" width="min(580px,94vw)" destroy-on-close>
      <el-form label-position="top" @submit.prevent="save">
        <template v-if="kind==='customer'"><el-form-item label="客户编号"><el-input v-model="form.id" :disabled="editing" placeholder="如 742，须与客户系统配置一致"/></el-form-item><el-form-item label="客户名称"><el-input v-model="form.name" maxlength="80"/></el-form-item><el-form-item v-if="editing" label="客户状态"><el-select v-model="form.status"><el-option label="启用" value="ACTIVE"/><el-option label="停用" value="DISABLED"/></el-select><span class="muted">停用后不能再为该客户新增实例，已有项目数据保留。</span></el-form-item><el-form-item label="备注"><el-input v-model="form.note" type="textarea" maxlength="500"/></el-form-item></template>
        <template v-if="kind==='instance'"><el-form-item v-if="!form.editing" label="所属客户"><el-select v-model="form.customerId" placeholder="选择客户"><el-option v-for="customer in data.customers" :key="customer.id" :value="customer.id" :label="customer.name+' · '+customer.id"/></el-select></el-form-item><el-form-item v-if="!form.editing" label="所属项目"><el-select v-model="form.projectId"><el-option v-for="project in data.projects.filter(item=>item.customer_id===form.customerId)" :key="project.id" :value="project.id" :label="project.name"/></el-select></el-form-item><el-form-item v-if="!form.editing" label="实例编号"><el-input v-model="form.id" placeholder="从客户后台功能商城复制 UUID"/></el-form-item><el-form-item label="实例名称"><el-input v-model="form.name"/></el-form-item><el-form-item label="运行时租户编号（可选）"><el-input v-model="form.runtimeTenantId" maxlength="48" placeholder="如 jax、742、747"/><span class="muted">只允许 1 至 48 位小写字母、数字或短横线；全局唯一。留空的实例不会出现在运行时租户导出中。</span></el-form-item><el-form-item label="域名授权（每行或逗号分隔）"><el-input v-model="form.domainsText" type="textarea" :rows="3" placeholder="jaxapi.kkimg.top&#10;jax.kkimg.top"/><span class="muted">项目业务通过这里列出的域名授权访问；支持 *.example.com 子域名授权。</span></el-form-item><el-form-item label="维护期至（即授权到期时间）"><el-date-picker v-model="form.maintenanceUntilDate" type="datetime" :clearable="false" format="YYYY-MM-DD HH:mm:ss" placeholder="选择维护期截止时间"/><span class="muted">授权到期时间与维护期一致。</span></el-form-item><el-alert title="客户端版本由已授权客户端自动上报，无需手工填写。" type="info" :closable="false"/></template>
        <template v-if="kind==='newModule'"><el-form-item label="所属软件"><el-select v-model="form.productId"><el-option v-for="product in data.products" :key="product.id" :value="product.id" :label="product.name"/></el-select></el-form-item><el-form-item label="模块编号"><el-input v-model="form.id" placeholder="全局唯一的英文字母编号"/></el-form-item><el-form-item label="模块名称"><el-input v-model="form.name"/></el-form-item><el-form-item label="模块说明"><el-input v-model="form.description" type="textarea" :rows="3"/></el-form-item><el-form-item label="最低客户端版本"><el-input v-model="form.minVersion" placeholder="1.0.0"/></el-form-item><el-form-item label="价格（元）"><el-input-number v-model="form.priceYuan" :precision="2" :min="0" :max="1000000"/></el-form-item><el-form-item label="上架状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT"/><el-option label="已上架" value="ACTIVE"/></el-select></el-form-item></template><template v-if="kind==='module'"><p>{{ form.name }} · {{ form.id }}</p><el-form-item label="模块名称"><el-input v-model="form.name"/></el-form-item><el-form-item label="模块说明"><el-input v-model="form.description" type="textarea" :rows="3"/></el-form-item><el-form-item label="最低客户端版本"><el-input v-model="form.minVersion"/></el-form-item><el-form-item label="价格（元）"><el-input-number v-model="form.priceYuan" :precision="2" :min="0" :max="1000000"/></el-form-item><el-form-item label="计价周期参考天数（实际到期以项目维护期为准）"><el-input-number v-model="form.termDays" :min="0" :max="3660"/></el-form-item><el-form-item label="上架状态"><el-select v-model="form.status"><el-option label="草稿" value="DRAFT"/><el-option label="已上架" value="ACTIVE"/></el-select></el-form-item></template>
        <template v-if="kind==='entitlement'"><el-form-item label="客户实例"><el-select v-model="form.instanceId" :disabled="editing" placeholder="选择客户实例" filterable><el-option v-for="instance in data.instances" :key="instance.id" :value="instance.id" :label="instance.customer_name+' / '+instance.name"/></el-select></el-form-item><el-form-item label="付费功能"><el-select v-model="form.moduleId" :disabled="editing" placeholder="选择已定价功能"><el-option v-for="module in availableEntitlementModules" :key="module.id" :value="module.id" :label="module.name+' · '+money(module.price_cents)+' / '+module.term_days+'天'"/></el-select></el-form-item><el-form-item label="原始开始时间（不得晚于当前时间）"><el-date-picker v-model="form.validFromDate" type="datetime" :clearable="false" format="YYYY-MM-DD HH:mm:ss"/></el-form-item><el-form-item label="原始到期时间（新值不得超过当前维护期）"><el-date-picker v-model="form.validUntilDate" type="datetime" :clearable="false" format="YYYY-MM-DD HH:mm:ss"/><span class="muted">维护期缩短时保留原授权期限，但当前只生效到维护期；维护期恢复后自动恢复。</span></el-form-item><el-form-item label="授权状态"><el-switch v-model="form.enabled" active-text="授权有效" inactive-text="暂停授权"/><span class="muted">授权中心只控制功能授权是否有效；客户后台是否实际启用由客户管理员决定。</span></el-form-item><el-alert title="保存后会重新签发当前实例的功能授权；客户后台同步授权期限，不会覆盖客户自己的启用开关。" type="info" :closable="false"/></template>
        <template v-if="kind==='order'"><el-form-item label="客户实例"><el-select v-model="form.instanceId" placeholder="选择客户实例" filterable><el-option v-for="instance in data.instances" :key="instance.id" :value="instance.id" :label="instance.customer_name+' / '+instance.name"/></el-select></el-form-item><el-form-item label="功能模块"><el-select v-model="form.moduleId" placeholder="选择当前平台已定价上架的模块"><el-option v-for="module in availableOrderModules" :key="module.id" :value="module.id" :label="module.name+' · '+money(module.price_cents)"/></el-select></el-form-item><el-alert v-if="orderIntent==='renew'" title="续费订单需要完成收款并签发后才会顺延权益。" type="info" :closable="false"/><el-alert v-if="previewError" :title="previewError" type="error" :closable="false"/><div v-if="orderQuote" class="order-preview" :aria-busy="previewBusy"><div><span>价格</span><strong>{{ money(orderQuote.priceCents) }}</strong></div><div><span>计价周期</span><strong>{{ orderQuote.termDays }} 天</strong></div><div><span>{{ orderQuote.renewal?'续费起算':'生效时间' }}</span><strong>{{ time(orderQuote.validFrom) }}</strong></div><div><span>到期时间</span><strong>{{ time(orderQuote.validUntil) }}</strong></div><div><span>本次新增</span><strong>{{ orderQuote.days }} 天</strong></div><div><span>剩余总计</span><strong>{{ orderQuote.totalRemainingDays }} 天</strong></div></div><el-alert v-if="orderQuote?.renewal" :title="'已开通，可按当前到期日 '+time(orderQuote.currentExpiry)+' 续费；价格与时长以下单快照为准。'" type="success" :closable="false"/><el-alert title="功能模块按所属平台筛选；订单保存下单时的报价快照；未支付订单会在价格、授权周期或上架条件变化时作废并重新报价，已支付订单不受影响。" type="info" :closable="false"/></template>
        <template v-if="kind==='payment'"><el-alert :title="'请核对实际收款 '+money(form.amount_cents)+' 后再确认。本操作只记账，不会执行扣款。'" type="warning" :closable="false"/><el-form-item label="收款核对凭据 / 备注"><el-input v-model="form.reference" placeholder="填写核对凭据或内部单号" maxlength="200"/></el-form-item></template>
        <template v-if="kind==='release'"><el-form-item label="所属软件"><el-select v-model="form.productId"><el-option v-for="product in data.products" :key="product.id" :value="product.id" :label="product.name"/></el-select></el-form-item><el-form-item label="版本号"><el-input v-model="form.version" placeholder="1.4.1"/></el-form-item><el-form-item label="发布通道"><el-select v-model="form.channel"><el-option label="正式版" value="stable"/></el-select></el-form-item><el-form-item label="更新说明"><el-input v-model="form.notes" type="textarea" :rows="4" maxlength="4000"/></el-form-item><el-form-item label="客户端仓库的 GitHub Release 地址"><el-input v-model="form.sourceUrl" placeholder="https://github.com/zhz520/cangshuo-detla/releases/tag/..."/></el-form-item><el-alert title="这里登记版本信息；不会自动构建软件或安装到客户服务器。" type="info" :closable="false"/></template>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" :disabled="kind==='order'&&(previewBusy||!orderQuote)" @click="save">{{ kind==='payment'?'已核对，确认收款':'保存' }}</el-button></template>
    </el-dialog>
    <el-dialog v-model="deliveryVisible" :title="deliveryType==='key'?'客户系统验证公钥':deliveryType==='identity'?'实例接入凭据':'授权交付内容'" width="min(720px,94vw)"><p class="muted">{{ deliveryType==='key'?'将公钥配置到客户系统。此处不包含签发私钥。':deliveryType==='identity'?'用于支持 cangshuo-instance-v1 的程序接入。电竞客户端功能商城需导入授权管理中的 delta-license-v1 功能授权文件。':'客户在功能商城导入完整 JSON 后，启用已授权模块。内容只适用于绑定的客户与实例。' }}</p><el-input :model-value="deliveryText" type="textarea" :rows="11" readonly/><template #footer><el-button @click="copyDelivery">复制内容</el-button><el-button type="primary" @click="downloadDelivery">下载{{ deliveryType==='key'?'公钥':deliveryType==='identity'?'接入凭据':'授权文件' }}</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import {createApiClient} from './request'
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ListPager from './ListPager.vue'
import UsageAccounts from './UsageAccounts.vue'
import { useRecords } from './records'
const Operations=defineAsyncComponent({loader:()=>import('./Operations.vue'),delay:120,timeout:30000,loadingComponent:{render:()=>h('div',{class:'page-loading',role:'status'},'正在加载页面…')},errorComponent:{render:()=>h('div',{class:'page-loading',role:'alert'},['页面资源加载失败，请检查网络。',h('button',{onClick:()=>window.location.reload()},'重新加载')])}})
const ServiceGroups=defineAsyncComponent({loader:()=>import('./ServiceGroups.vue'),delay:120,timeout:30000,loadingComponent:{render:()=>h('div',{class:'page-loading',role:'status'},'正在加载服务组页面…')},errorComponent:{render:()=>h('div',{class:'page-loading',role:'alert'},['页面资源加载失败，请检查网络。',h('button',{onClick:()=>window.location.reload()},'重新加载')])}})
const SupportAdmin=defineAsyncComponent(()=>import('./SupportAdmin.vue'))
import { ElMessage, ElMessageBox } from 'element-plus'
import { HomeFilled, User, Monitor, Goods, Document, Key, UploadFilled, Clock, Connection, CreditCard } from '@element-plus/icons-vue'
const navigationGroups=[
  {name:'工作台',items:[{id:'overview',name:'运营概览',icon:HomeFilled},{id:'support',name:'在线客服',icon:Connection}]},
  {name:'客户与项目',items:[{id:'customers',name:'客户管理',icon:User},{id:'projects',name:'项目管理',icon:Monitor},{id:'instances',name:'实例接入',icon:Connection},{id:'products',name:'软件中心',icon:Goods}]},
  {name:'授权与发布',items:[{id:'modules',name:'功能与定价',icon:Goods},{id:'entitlements',name:'客户功能',icon:Key},{id:'usage',name:'实名用量账户',icon:CreditCard},{id:'orders',name:'购买订单',icon:Document},{id:'licenses',name:'授权管理',icon:Key},{id:'releases',name:'版本发布',icon:UploadFilled},{id:'serviceGroups',name:'服务组发布',icon:Connection}]},
  {name:'系统设置',items:[{id:'payments',name:'支付设置',icon:CreditCard},{id:'mail',name:'邮件通知',icon:Connection},{id:'audit',name:'操作记录',icon:Clock}]}
]
const navigation=computed(()=>navigationGroups.flatMap(group=>group.items))
const descriptions={overview:'统一管理客户授权、开通流程与交付状态。',support:'管理授权中心在线客服会话与客户入口。',customers:'登记客户编号与名称，与客户系统独立维护。',instances:'将授权绑定到客户系统显示的实例编号。',modules:'先确认价格与期限，再开放客户在线购买。',entitlements:'按实例维护每项付费功能的授权状态、有效期和续费。',usage:'管理实名核验的按次余额、冻结金额、核验请求和资金流水。',products:'登记不同类型的软件项目与 GitHub 正式版仓库。',projects:'按项目维护到期时间、暂停策略、支付接入和通知邮箱。',payments:'统一维护授权中心收款参数，再由项目选择可用支付方式。',mail:'配置邮箱发信与查看重要通知发送记录。',orders:'查看客户在线购买、人工维护期接入和授权签发记录。',licenses:'查看与交付签名授权，签发私钥留在运营中心。',releases:'维护客户端的版本目录与发布说明。',serviceGroups:'登记多租户服务组成员，签发共享发布计划。',audit:'保留客户登记、在线收款、退款和签发记录。'}
const actionLabels={SAVE_PRODUCT:'保存软件与仓库',UPDATE_CUSTOMER:'更新客户',DELETE_CUSTOMER:'删除客户',CREATE_PROJECT:'新增项目',UPDATE_PROJECT:'更新项目维护',CREATE_MODULE:'登记功能模块',UPDATE_MAIL_SETTINGS:'保存邮箱配置',QUEUE_TEST_MAIL:'测试发信',RETRY_MAIL:'重试邮件',UPDATE_RELEASE_ITEMS:'配置更新内容',CREATE_UPDATE_PLAN:'生成更新计划',REISSUE_MAINTENANCE_LICENSE:'同步维护授权',EXPORT_INSTANCE_IDENTITY:'导出实例接入凭据',CLIENT_VERSION_REPORT:'客户端版本上报',LOGIN:'登录后台',CREATE_CUSTOMER:'登记客户',CREATE_INSTANCE:'登记实例',UPDATE_INSTANCE:'更新授权域名/维护期',CREATE_SERVICE_GROUP:'新增共享服务组',UPDATE_SERVICE_GROUP:'更新共享服务组',CREATE_SHARED_RELEASE_PLAN:'签发共享发布计划',UPDATE_MODULE:'调整模块价格',CREATE_ORDER:'创建功能订单',CONFIRM_ONLINE_PAYMENT:'在线支付自动确认',CONFIRM_MANUAL_PAYMENT:'确认人工收款',UPLOAD_PAYMENT_KEY:'上传支付密钥',UPDATE_PLUGIN:'配置客户插件',GRANT_MAINTENANCE_ACCESS:'维护期接入',ISSUE_LICENSE:'签发授权',CREATE_ENTITLEMENT:'新增客户功能',UPDATE_ENTITLEMENT:'编辑客户功能',DELETE_ENTITLEMENT:'删除客户功能',CREATE_RELEASE_DRAFT:'登记版本草稿',PUBLISH_RELEASE_METADATA:'发布版本信息'}
const createActions={customers:'customer',instances:'instance',entitlements:'entitlement',orders:'order',modules:'newModule',releases:'release'},createLabels={customers:'新增客户',instances:'登记实例',entitlements:'新增客户功能',orders:'创建订单',modules:'新增功能模块',releases:'新增版本'}
const menuOpen=ref(false), sidebarCollapsed=ref(false), searchOpen=ref(false), notificationsOpen=ref(false), accountOpen=ref(false), globalQuery=ref(''), globalSearchInput=ref(null)
const ready=ref(false),bootError=ref(''),loggedIn=ref(false),username=ref(''),csrf=ref(''),busy=ref(false),saving=ref(false),loginBusy=ref(false),logoutBusy=ref(false),page=ref('overview'),heading=ref(null),dataError=ref(''),loaded=ref(false)
const operationsPages=['products','projects','payments','mail','releases']
const credentials=reactive({username:'admin',password:''}),data=reactive({products:[],projects:[],paymentProviders:[],mailSettings:{},mailQueue:[],customers:[],instances:[],modules:[],entitlements:[],orders:[],licenses:[],releases:[],serviceGroups:[],sharedReleasePlans:[],audit:[]})
const title=computed(()=>navigation.value.find(item=>item.id===page.value)?.name)
const recentAudit=computed(()=>data.audit.slice(0,4))
const searchResults=computed(()=>{
  const query=globalQuery.value.trim().toLowerCase()
  if(!query)return []
  const pool=[
    ...navigation.value.map(item=>({key:'page:'+item.id,title:item.name,meta:'功能入口',target:item.id,search:item.name})),
    ...data.customers.map(row=>({key:'customer:'+row.id,title:row.name||row.id,meta:'客户 · '+(row.id||''),target:'customers',search:[row.name,row.id,row.note].filter(Boolean).join(' ')})),
    ...data.projects.map(row=>({key:'project:'+row.id,title:row.name||row.id,meta:'项目 · '+(row.customer_name||row.customer_id||''),target:'projects',search:[row.name,row.id,row.customer_name,row.customer_id].filter(Boolean).join(' ')})),
    ...data.instances.map(row=>({key:'instance:'+row.id,title:row.name||row.id,meta:'实例 · '+(row.runtime_tenant_id||row.id),target:'instances',search:[row.name,row.id,row.runtime_tenant_id,...(row.domains||[])].filter(Boolean).join(' ')})),
    ...data.licenses.map(row=>({key:'license:'+row.id,title:row.id,meta:'授权 · '+(row.customer_name||row.instance_name||''),target:'licenses',search:[row.id,row.customer_name,row.instance_name,row.instance_id].filter(Boolean).join(' ')})),
    ...data.orders.map(row=>({key:'order:'+row.id,title:row.id,meta:'订单 · '+status(row.status),target:'orders',search:[row.id,row.customer_name,row.instance_name,row.module_name].filter(Boolean).join(' ')}))
  ]
  return pool.filter(item=>item.search.toLowerCase().includes(query)).slice(0,8)
})
const availableOrderModules=computed(()=>{const instance=data.instances.find(item=>item.id===form.instanceId);return data.modules.filter(item=>item.status==='ACTIVE'&&(!instance||item.product_id===instance.product_id))})
const availableEntitlementModules=computed(()=>{const instance=data.instances.find(item=>item.id===form.instanceId);return data.modules.filter(item=>(item.status==='ACTIVE'&&item.price_cents!=null||item.id===form.moduleId)&&(!instance||item.product_id===instance.product_id)&&(item.id===form.moduleId||!data.entitlements.some(grant=>grant.instance_id===form.instanceId&&grant.module_id===item.id)))})
const stats=computed(()=>[
  {name:'已登记客户',value:data.customers.length,detail:'在册客户主体',target:'customers',icon:User},
  {name:'客户实例',value:data.instances.length,detail:'按实例绑定授权',target:'instances',icon:Monitor},
  {name:'待确认收款',value:data.orders.filter(order=>order.status==='UNPAID').length,detail:'在线支付或人工核对',target:'orders',icon:Document},
  {name:'已签发授权',value:data.licenses.length,detail:'完成交付的授权记录',target:'licenses',icon:Key}
])
const processSteps=computed(()=>{
  const done=[data.customers.length>0&&data.instances.length>0,data.modules.some(item=>item.price_cents!=null&&item.status==='ACTIVE'),data.orders.some(item=>['PAID','MAINTENANCE'].includes(item.status)),data.licenses.length>0]
  const active=Math.max(0,done.findIndex(item=>!item))
  return [
    ['登记客户和实例','创建客户并登记实例信息'],
    ['配置功能与价格','选择授权功能与定价方案'],
    ['客户在线购买或人工确认','在线支付或运营人工核对收款'],
    ['授权自动签发并同步','完成签发并同步客户系统']
  ].map(([title,subtitle],index)=>({title,subtitle,done:done[index],active:index===active&&!done[index]}))
})
const {query:search,state:listState,total,rows:records}=useRecords(()=>data[page.value]||[],()=>page.value)
function go(target){if(target)page.value=target}
function closeHeaderPanels(){searchOpen.value=false;notificationsOpen.value=false;accountOpen.value=false}
function openHeaderPanel(panel){searchOpen.value=panel==='search';notificationsOpen.value=panel==='notifications';accountOpen.value=panel==='account'}
function activateGlobalSearch(){openHeaderPanel('search');nextTick(()=>globalSearchInput.value?.focus())}
function toggleHeaderPanel(panel){if(panel==='notifications'){const next=!notificationsOpen.value;closeHeaderPanels();notificationsOpen.value=next}else{const next=!accountOpen.value;closeHeaderPanels();accountOpen.value=next}}
function selectSearchResult(result){page.value=result.target;globalQuery.value='';closeHeaderPanels()}
function selectFirstSearchResult(){if(searchResults.value[0])selectSearchResult(searchResults.value[0])}
function money(cents){return '¥'+(Number(cents)/100).toFixed(2)}
function productName(id){return data.products.find(item=>item.id===id)?.name||id||'—'}
function time(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—'}
function orderActualDays(row){const start=Date.parse(row?.valid_from),end=Date.parse(row?.valid_until);return Number.isFinite(start)&&Number.isFinite(end)&&end>start?Math.ceil((end-start)/86400000):null}
function publicReleaseUrl(row){return `${window.location.origin}/public/release-notes/${encodeURIComponent(row.product_id)}/${encodeURIComponent(row.version)}`}
function status(value){return {ACTIVE:'已启用',DISABLED:'已停用',EXPIRED:'已过期',PENDING:'未生效',DRAFT:'草稿',UNPAID:'待收款',PAID:'已收款',MAINTENANCE:'维护期接入',CANCELLED:'已作废',PUBLISHED:'已发布'}[value]||value}
function entitlementStatus(value){return {ACTIVE:'授权有效',DISABLED:'已暂停授权',EXPIRED:'已过期',PENDING:'未生效'}[value]||value}
function entitlementTag(value){return {ACTIVE:'success',DISABLED:'info',EXPIRED:'danger',PENDING:'warning'}[value]||'info'}
let sessionEpoch=0,refreshTask=null
function clearSession(){sessionEpoch++;loggedIn.value=false;csrf.value='';username.value='';menuOpen.value=false;dialog.value=false;deliveryVisible.value=false;loaded.value=false;dataError.value='';for(const key of Object.keys(data))data[key]=Array.isArray(data[key])?[]:{}}
const api=createApiClient({getCsrf:()=>csrf.value,onUnauthorized:clearSession,getSessionVersion:()=>sessionEpoch})
function refresh(){
  if(refreshTask)return refreshTask
  const epoch=sessionEpoch;busy.value=true;dataError.value=''
  refreshTask=(async()=>{try{const result=await api('/data');if(epoch!==sessionEpoch)return false;Object.assign(data,result);loaded.value=true;return true}catch(error){if(epoch===sessionEpoch)dataError.value=error.message;return false}finally{busy.value=false;refreshTask=null}})()
  return refreshTask
}
async function refreshAfterWrite(){if(refreshTask)await refreshTask;return refresh()}
async function login(){if(loginBusy.value)return;loginBusy.value=true;try{const session=await api('/login',{method:'POST',body:credentials});sessionEpoch++;username.value=session.username;csrf.value=session.csrf;credentials.password='';loggedIn.value=true;await refreshAfterWrite()}catch(error){ElMessage.error(error.message)}finally{loginBusy.value=false}}
async function logout(){if(logoutBusy.value)return;logoutBusy.value=true;try{await api('/logout',{method:'POST',body:{}});clearSession()}catch(error){ElMessage.error(error.message)}finally{logoutBusy.value=false}}
const dialog=ref(false),kind=ref(''),editing=ref(false),form=reactive({}),orderIntent=ref('purchase'),dialogTitle=computed(()=>kind.value==='customer'?(editing.value?'编辑客户':'新增客户'):kind.value==='order'?(orderIntent.value==='renew'?'创建续费订单':'创建购买订单'):({instance:'登记客户实例',entitlement:editing.value?'编辑客户功能':'新增客户功能',newModule:'新增功能模块',module:'编辑功能模块',payment:'确认人工收款',release:'新增版本草稿'}[kind.value]))
const orderQuote=ref(null),previewBusy=ref(false),previewError=ref(''),previewEpoch=ref(0),orderPreviewKey=ref(0),entitlementBusy=ref('')
watch(()=>form.customerId,()=>{if(kind.value==='instance'&&!form.editing)form.projectId=undefined})
watch(()=>form.instanceId,()=>{if(kind.value==='order'&&!availableOrderModules.value.some(item=>item.id===form.moduleId))form.moduleId=undefined;if(kind.value==='entitlement'&&!availableEntitlementModules.value.some(item=>item.id===form.moduleId))form.moduleId=undefined})
watch([()=>form.instanceId,()=>form.moduleId,orderPreviewKey],async()=>{const epoch=++previewEpoch.value;orderQuote.value=null;previewError.value='';if(kind.value!=='order'||!form.instanceId||!form.moduleId)return;previewBusy.value=true;try{const quote=await api(`/orders/preview?instanceId=${encodeURIComponent(form.instanceId)}&moduleId=${encodeURIComponent(form.moduleId)}`);if(epoch===previewEpoch.value)orderQuote.value=quote}catch(error){if(epoch===previewEpoch.value)previewError.value=error.message}finally{if(epoch===previewEpoch.value)previewBusy.value=false}})
function open(type,row={}){previewEpoch.value++;orderIntent.value='purchase';orderQuote.value=null;previewError.value='';for(const key of Object.keys(form))delete form[key];kind.value=type;editing.value=type==='entitlement'?!!row.instance_id:!!row.id;Object.assign(form,{channel:'stable',status:type==='customer'?(row.status||'ACTIVE'):'DRAFT',termDays:365,...row});if(['module','newModule'].includes(type)){form.minVersion=row.min_version||'1.0.0';form.productId=row.product_id||data.products[0]?.id;form.priceYuan=row.price_cents==null?undefined:row.price_cents/100;form.termDays=row.term_days??365}if(type==='instance'){form.domainsText=(row.domains||[]).join('\n');form.runtimeTenantId=row.runtime_tenant_id||'';form.maintenanceUntilDate=row.maintenance_until?new Date(row.maintenance_until):new Date(Date.now()+365*86400000);form.editing=!!row.id}if(type==='entitlement'){form.instanceId=row.instance_id;form.moduleId=row.module_id;form.validFromDate=row.valid_from?new Date(row.valid_from):new Date();form.validUntilDate=row.original_until||row.valid_until?new Date(row.original_until||row.valid_until):new Date(Date.now()+365*86400000);form.enabled=row.enabled??true;form.editing=!!row.instance_id}if(type==='release'){form.version='';form.productId=data.products[0]?.id}orderPreviewKey.value++;dialog.value=true}
async function save(){if(saving.value)return;saving.value=true;try{
  const instanceBody={name:form.name,runtimeTenantId:form.runtimeTenantId||'',domains:form.domainsText,maintenanceUntil:form.maintenanceUntilDate instanceof Date?form.maintenanceUntilDate.toISOString():form.maintenanceUntilDate,customerId:form.customerId,projectId:form.projectId,id:form.id}
  const moduleBody={...form,priceCents:form.priceYuan==null?null:Math.round(Number(form.priceYuan)*100),termDays:Number(form.termDays),status:form.status}
  const entitlementBody={instanceId:form.instanceId,moduleId:form.moduleId,validFrom:form.validFromDate instanceof Date?form.validFromDate.toISOString():form.validFromDate,validUntil:form.validUntilDate instanceof Date?form.validUntilDate.toISOString():form.validUntilDate,enabled:form.enabled}
  const requests={newModule:()=>api('/modules',{method:'POST',body:moduleBody}),customer:()=>editing.value?api('/customers/'+form.id,{method:'PUT',body:form}):api('/customers',{method:'POST',body:form}),instance:()=>form.editing?api(`/instances/${form.id}`,{method:'PUT',body:instanceBody}):api('/instances',{method:'POST',body:instanceBody}),entitlement:()=>editing.value?api(`/entitlements/${encodeURIComponent(form.instanceId)}/${encodeURIComponent(form.moduleId)}`,{method:'PUT',body:entitlementBody}):api('/entitlements',{method:'POST',body:entitlementBody}),order:()=>api('/orders',{method:'POST',body:form}),release:()=>api('/releases',{method:'POST',body:form}),payment:()=>api(`/orders/${form.id}/paid`,{method:'POST',body:{reference:form.reference}}),module:()=>api(`/modules/${form.id}`,{method:'PUT',body:moduleBody})}
  await requests[kind.value]();dialog.value=false;ElMessage.success('已保存');await refreshAfterWrite()
}catch(error){ElMessage.error(error.message)}finally{saving.value=false}}
const deliveryVisible=ref(false),deliveryType=ref('license'),deliveryText=ref(''),deliveryName=ref('')
async function removeCustomer(customer){try{await ElMessageBox.confirm('确认删除客户“'+customer.name+'”？有关联项目或实例时系统会阻止删除。','删除客户',{type:'warning'});await api('/customers/'+customer.id,{method:'DELETE',body:{}});await refreshAfterWrite();ElMessage.success('客户已删除')}catch(error){if(error?.message)ElMessage.error(error.message)}}
async function removeModule(module){try{await ElMessageBox.confirm('确认删除功能模块“'+module.name+'”？已有订单或授权的模块不能删除，可改为草稿停用。','删除功能模块',{type:'warning'});await api('/modules/'+module.id,{method:'DELETE',body:{}});await refreshAfterWrite();ElMessage.success('功能模块已删除')}catch(error){if(error?.message)ElMessage.error(error.message)}}
async function toggleEntitlement(row,enabled){if(entitlementBusy.value)return;entitlementBusy.value=row.instance_id+':'+row.module_id;try{await api(`/entitlements/${encodeURIComponent(row.instance_id)}/${encodeURIComponent(row.module_id)}`,{method:'PUT',body:{enabled}});await refreshAfterWrite();ElMessage.success(enabled?'功能已开通':'功能已停用')}catch(error){ElMessage.error(error.message);await refreshAfterWrite()}finally{entitlementBusy.value=''}}
async function removeEntitlement(row){try{await ElMessageBox.confirm(`确认删除“${row.customer_name} / ${row.module_name}”功能权益？删除后将不再签发该项许可证。`,'删除客户功能',{type:'warning'});await api(`/entitlements/${encodeURIComponent(row.instance_id)}/${encodeURIComponent(row.module_id)}`,{method:'DELETE',body:{}});await refreshAfterWrite();ElMessage.success('客户功能已删除')}catch(error){if(error?.message)ElMessage.error(error.message)}}
function startEntitlementRenewal(row){open('order',{instanceId:row.instance_id,moduleId:row.module_id});orderIntent.value='renew'}
async function issue(order){try{const result=await api(`/orders/${order.id}/issue`,{method:'POST',body:{}});deliveryType.value='license';deliveryName.value=result.id+'.license.json';deliveryText.value=JSON.stringify(result.envelope,null,2);deliveryVisible.value=true;await refreshAfterWrite()}catch(error){ElMessage.error(error.message)}}
async function exportIdentity(instance){try{deliveryText.value=JSON.stringify(await api('/instances/'+instance.id+'/identity'),null,2);deliveryType.value='identity';deliveryName.value=instance.id+'.identity.json';deliveryVisible.value=true}catch(error){ElMessage.error(error.message)}}
async function viewLicense(license){try{deliveryText.value=JSON.stringify(await api('/licenses/'+license.id),null,2);deliveryType.value='license';deliveryName.value=license.id+'.license.json';deliveryVisible.value=true}catch(error){ElMessage.error(error.message)}}
async function maintenanceGrant(order){try{const result=await ElMessageBox.prompt('该操作只登记现有客户的维护期接入，不记为线上收款。请填写维护依据或内部单号。','维护期接入',{inputPlaceholder:'如：年度维护服务已续签',inputValidator:value=>value?.trim()?true:'请填写维护期接入说明'});await api(`/orders/${order.id}/maintenance`,{method:'POST',body:{note:result.value.trim()}});await refreshAfterWrite();ElMessage.success('已登记维护期接入')}catch(error){if(error?.message)ElMessage.error(error.message)}}
async function cancelOrder(order){const paid=order.status==='PAID';try{const result=await ElMessageBox.prompt(paid?'请确认退款或冲正已经完成。填写退款凭据后，订单将作废并解除功能下单阻塞。':'作废后订单不能再收款或签发。请填写作废原因，便于后续核对。',paid?'退款并作废订单':'作废订单',{inputPlaceholder:paid?'退款流水号、冲正单号或内部依据':'如：报价已失效、客户取消',inputValidator:value=>value?.trim()?true:(paid?'请填写退款凭据':'请填写作废原因')});const value=result.value.trim();await api(`/orders/${order.id}/cancel`,{method:'POST',body:{reason:value,refundReference:paid?value:undefined}});await refreshAfterWrite();ElMessage.success(paid?'订单已退款作废':'订单已作废')}catch(error){if(error?.message)ElMessage.error(error.message)}}
async function showPublicKey(){try{deliveryText.value=(await api('/public-key')).publicKey;deliveryType.value='key';deliveryName.value='license-public.pem';deliveryVisible.value=true}catch(error){ElMessage.error(error.message)}}
async function copyDelivery(){try{await navigator.clipboard.writeText(deliveryText.value);ElMessage.success('已复制')}catch{ElMessage.info('请手动选中并复制内容')}}
function downloadDelivery(){const url=URL.createObjectURL(new Blob([deliveryText.value],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=deliveryName.value;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function publish(release){try{await ElMessageBox.confirm('请确认 GitHub Release 与说明已经核对。此操作发布版本信息，不执行客户服务器更新。','发布版本信息',{type:'info'});await api(`/releases/${encodeURIComponent(release.version)}/publish`,{method:'POST',body:{productId:release.product_id}});await refreshAfterWrite();ElMessage.success('版本信息已发布')}catch(error){if(error?.message)ElMessage.error(error.message)}}
async function connect(){bootError.value='';try{const session=await api('/session');if(session.authenticated){loggedIn.value=true;username.value=session.username;csrf.value=session.csrf;await refresh()}ready.value=true}catch(error){bootError.value='运营服务连接失败：'+error.message}}
function readPage(){const id=window.location.hash.slice(1);page.value=navigation.value.some(item=>item.id===id)?id:'overview'}
function escapeMenu(event){if(event.key==='Escape'){menuOpen.value=false;closeHeaderPanels()}}
watch(page,async value=>{window.location.hash=value;menuOpen.value=false;closeHeaderPanels();dialog.value=false;deliveryVisible.value=false;window.scrollTo(0,0);await nextTick();heading.value?.focus({preventScroll:true})})
watch(menuOpen,value=>{document.body.style.overflow=value?'hidden':''})
watch(loggedIn,value=>{if(!value){dialog.value=false;deliveryVisible.value=false}})
onMounted(()=>{readPage();window.addEventListener('hashchange',readPage);window.addEventListener('keydown',escapeMenu);document.addEventListener('pointerdown',closeHeaderPanels);connect()})
onUnmounted(()=>{window.removeEventListener('hashchange',readPage);window.removeEventListener('keydown',escapeMenu);document.removeEventListener('pointerdown',closeHeaderPanels);document.body.style.overflow=''})
</script>
<style>
.el-date-editor.el-input,
.el-date-editor .el-input__wrapper { width: 100%; }
aside { width: 236px; padding: 22px 12px 18px; overflow: hidden; }
.brand { margin-bottom: 22px; padding: 0 8px; }
.nav-scroll { min-height: 0; overflow-y: auto; padding-right: 3px; scrollbar-width: thin; scrollbar-color: #405273 transparent; }
.nav-section { display: flex; flex-direction: column; gap: 3px; margin-bottom: 15px; }
aside .nav-label { padding: 0 12px; margin: 0 0 5px; }
aside button { min-height: 40px; padding: 10px 12px; margin: 0; font-size: 13px; }
.workspace { margin-left: 236px; width: calc(100% - 236px); }
.aside-bottom { padding: 14px 12px 0; }
.status-tag { margin-left: 8px; }
.order-preview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:16px 0; padding:14px; border:1px solid #dce4ef; border-radius:12px; background:#f8fafc; }
.order-preview div { display:flex; flex-direction:column; gap:3px; min-width:0; }
.order-preview span { color:#748196; font-size:12px; }
.order-preview strong { color:#23324a; font-size:14px; overflow-wrap:anywhere; }
@media (max-width: 1050px) {
  aside { width: 208px; }
  .workspace { margin-left: 208px; width: calc(100% - 208px); }
}
@media (max-width: 720px) {
  .order-preview { grid-template-columns:repeat(2,minmax(0,1fr)); }
  aside { width: 100%; padding: 16px; }
  .nav-scroll { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; overflow: visible; }
  .nav-section { margin: 0; gap: 2px; }
  aside .nav-label { padding: 0 7px; margin-bottom: 2px; }
  .aside-bottom { display: none; }
}
</style>
