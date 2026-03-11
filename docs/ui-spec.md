# UI 设计规范

本项目为**原生 HTML + CSS + JS** 实现，无前端框架。所有页面必须遵循本规范，确保风格和控件一致。

---

## 1. 技术栈与文件引用

### 1.1 样式文件

| 文件 | 用途 |
|------|------|
| `static/style.css` | 主样式，所有页面必须引入 |
| `static/theme.css` | 主题切换（light/dark/checkin/yellow-green），所有页面必须引入 |
| `static/checkin.css` | 打卡页专用样式，仅打卡页引入 |

### 1.2 页面基础结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>页面标题 - 工作小助手</title>
    <link rel="stylesheet" href="/static/style.css">
    <link rel="stylesheet" href="/static/theme.css">
</head>
<body>
<div class="app-container">
    <header class="app-header app-header-with-action">
        <div class="app-header-left">
            <h1>页面标题</h1>
        </div>
        <div class="header-actions">
            <div id="theme-switcher-container"></div>
            <button id="btn-go-home" class="btn">返回首页</button>
        </div>
    </header>
    <!-- 主内容 -->
</div>
<div id="toast-container"></div>
<script src="/static/theme-switcher.js"></script>
</body>
</html>
```

---

## 2. 色彩规范

### 2.1 主色（Light 主题）

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色 Primary | `#2563eb` | 主按钮、链接、选中态 |
| 主色 Hover | `#1d4ed8` | 主按钮悬停 |
| 成功 Success | `#16a34a` | 成功提示、完成态 |
| 危险 Danger | `#dc2626` / `#b91c1c` | 删除、错误 |
| 强调 Accent | `#F59A23` | 数量、统计数字 |

### 2.2 中性色

| 用途 | 色值 |
|------|------|
| 正文 | `#222` / `#111827` |
| 次要文字 | `#374151` / `#6b7280` |
| 辅助文字 | `#9ca3af` |
| 边框 | `#e5e7eb` / `#d1d5db` |
| 背景-页面 | `#f5f7fb` |
| 背景-卡片 | `#fff` |
| 背景-表头/斑马行 | `#f9fafb` |
| 悬停背景 | `#f3f4f6` / `#eef2ff` |

### 2.3 主题

通过 `html[data-theme]` 切换：

- `light`（默认）：浅色背景
- `dark`：深色背景
- `checkin`：紫粉青渐变
- `yellow-green`：黄绿渐变

新页面需在 `theme.css` 中补充对应主题覆盖样式。

---

## 3. 字体与排版

### 3.1 字体

```css
font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
```

### 3.2 字号与字重

| 用途 | 字号 | 字重 |
|------|------|------|
| 页面标题 h1 | 26px | 默认 |
| 卡片/区块标题 | 16px | 600 |
| 正文 | 14px | 默认 |
| 辅助/标签 | 13px | 默认 |
| 小字 | 12px | 默认 |

---

## 4. 间距与圆角

### 4.1 间距

| 值 | 用途 |
|----|------|
| 4px | 紧凑元素间距 |
| 8px | 表单项、控件组内 |
| 12px | 布局分栏 gap、行内元素、同行字段间距 |
| 16px | 区块间距、padding |
| 20px | 卡片间距、大区块 |
| 24px | 容器水平 padding |

### 4.2 圆角

| 值 | 用途 |
|----|------|
| 4px | 按钮、小控件 |
| 6px | 输入框、Tab、日历格 |
| 8px | 卡片、表格区、侧边栏 |
| 12px | 首页卡片 |

---

## 5. 组件规范

### 5.1 按钮

**普通按钮** `.btn`

```html
<button class="btn">返回首页</button>
```

- 背景：`#e5e7eb`
- 悬停：`#d1d5db`
- padding：`6px 14px`
- font-size：14px
- border-radius：4px

**主按钮** `.btn.primary`

```html
<button class="btn primary">添加</button>
```

- 背景：`#2563eb`
- 悬停：`#1d4ed8`
- 颜色：白色
- 高度：`36px`（按钮统一高度）

**幽灵按钮** `.btn-ghost`（打卡页）

- 背景：`#f3f4f6`
- 边框：`1px solid #d1d5db`

**危险按钮** `.btn-ghost-danger` / `.btn-edit-event`（用于删除、危险操作）

- 背景：`#ffffff`
- 边框：`1px solid #dc2626`
- 文字颜色：`#dc2626`

### 5.2 输入框

**通用输入** `.field-control`

```html
<input type="text" class="field-control" placeholder="提示文字" />
```

- padding：`6px 10px` 或 `8px 12px`
- border：`1px solid #d1d5db`
- border-radius：4px 或 6px
- font-size：14px
- 高度：`36px`（表单场景统一）
- 聚焦态（:focus）：
  - `border-color: #2563eb`
  - `outline: 2px solid rgba(37, 99, 235, 0.35)`
  - `outline-offset: -2px`（向内绘制，避免被父容器的 `overflow` 裁剪）

**表单输入** `.notes-form-input`

- 用于笔记等表单，max-width：500px
- border-radius：6px

#### 5.2.1 下拉单选（Select / Combobox）

用于“分类标签筛选”等需要**单选下拉**且支持输入过滤的场景。

- **选择框高度**：必须复用 `.field-control`（高度 `36px`）。
- **面板最大高度**：固定 `240px`；当选项高度超过 `240px` 时，面板必须出现滚动条（`overflow: auto`）。
- **面板宽度**：必须始终与选择框宽度一致（通常通过“相对定位容器 + 绝对定位面板，左右贴合”实现）。

推荐结构与样式（示例）：

```html
<div class="select-combobox">
  <input class="field-control select-input" />
  <div class="select-panel">...</div>
</div>
```

```css
.select-combobox { position: relative; width: 100%; }
.select-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;              /* 确保面板宽度 = 选择框宽度 */
  max-height: 240px;     /* 固定最大高度 */
  overflow: auto;        /* 超出显示滚动条 */
}
```

### 5.3 标签

**行内标签** `.field-label`

```html
<span class="field-label">系统</span>
<input class="field-control" />
```

- font-size：13px
- color：`#374151`

**块级标签** `.notes-form-label`

- font-size：14px
- font-weight：500
- margin-bottom：6px

**必填标识** `.required-label::before`

- 红色圆点 `●`，margin-right：4px

**展示标签/徽章** `.detail-label-tag`（打卡页日历标签等）

```html
<span class="detail-label-tag">国庆节</span>
```

- padding：`4px 10px`
- font-size：13px
- background：透明
- border：`1px solid`，border-radius：6px
- 文字和边框颜色根据主题色系适配：
  - light：color `#374151`，border `#d1d5db`
  - dark：color `#e4e4e7`，border `#52525b`
  - checkin：color `#1a1a2e`，border `rgba(102, 126, 234, 0.5)`
  - yellow-green：color `#166534`，border `rgba(34, 197, 94, 0.5)`
- 多个标签同行显示时使用 `display: flex; flex-wrap: wrap; gap: 6px` 包裹

### 5.4 卡片

**控制面板** `.control-panel`

- 背景：`#fff`
- border-radius：8px
- box-shadow：`0 1px 3px rgba(15, 23, 42, 0.08)`
- padding：`16px 20px 12px`

**查询结果卡片（单词本「查询词汇」）** `.vocab-result-card`

- 用途：展示查询到的单词、释义以及后续操作按钮。
- 外边距：与上一行内容（查询输入行）之间保持 `margin-top: 12px`。
- 内边距：`16px 20px`，与控制面板整体视觉统一。
- 行间距与边框间距：
  - 单词标题 `.result-word` 与顶部边框、释义内容的上下间距均通过 `margin-bottom: 8px` 控制。
  - 释义文本 `.result-meaning` 行高约 `1.6`，并设置 `margin-bottom: 8px`，与卡片内其他元素之间形成一致的垂直间距。
  - 下方操作按钮区域 `.vocab-actions` 不再额外增加顶部外边距（`margin-top: 0`），整体依赖前一块内容的 `margin-bottom: 8px` 形成稳定、统一的行间距。
- 该间距规范与「每日打卡」页面中卡片内容区域的垂直间距保持一致，后续类似“查询结果”类内容区域应复用此模式：**相邻内容块之间使用统一的 `8px` 垂直间距，卡片与上一行内容之间使用 `12px` 间距。**

**表格区** `.table-section`

- 同 control-panel 背景与圆角
- flex: 1，overflow-y: auto

**首页卡片** `.home-card`

- border-radius：12px
- padding：`20px 16px`
- box-shadow：`0 1px 4px rgba(15, 23, 42, 0.08)`
- 悬停：`translateY(-2px)`，阴影加深

**通用卡片** `.card`（打卡页）

- border：`1px solid #e5e7eb`
- border-radius：8px
- padding：16px

### 5.5 Tab

统一用于上方横向切换区域（如“每日打卡”的打卡/提醒、“单词本”的多个 TAB）。

```html
<div class="nav-tabs">
    <button class="nav-tab active">打卡</button>
    <button class="nav-tab">提醒</button>
</div>
```

- **TAB 行**（`nav-tabs` / `vocab-tabs`）：
  - `display: flex; gap: 16px;`
  - 底部分割线：`border-bottom: 1px solid #e5e7eb`（浅灰色下划线）
- **TAB 按钮**（`nav-tab` / `vocab-tab`）：
  - 无填充底色：`background: transparent`
  - 无盒状边框：`border: none`（仅通过 `border-bottom` 表示下划线）
  - 内边距：`padding: 8px 4px`
  - 文本左对齐：`text-align: left`
  - 字号：14px
  - 默认文字颜色：随主题（light 下为 `#374151`）
  - 下划线基线：`border-bottom: 2px solid transparent`
- **选中态**：
  - 字体加粗：`font-weight: 500`
  - 2px 下划线：`border-bottom-color` 使用当前主题主色
  - 文字颜色：与下划线同色，随主题适配（light/dark/checkin/yellow-green/orange/lavender）
- **悬停**：
  - 仅改变文字颜色，不改变背景（保持无底色）
  - 悬停颜色靠近当前主题主色

**内部无边框 Tab** `.event-type-tab`（打卡/提醒内子类型）

- 无背景、无边框
- 选中：`color` 使用当前主题主色；`font-weight: 500`

### 5.6 表格

**基础表格** `.file-table`

```html
<section class="table-section">
    <table class="file-table">
        <thead><tr><th>列1</th><th>列2</th></tr></thead>
        <tbody>...</tbody>
    </table>
</section>
```

- font-size：13px
- 表头：`background: #f9fafb`，`font-weight: 600`
- 单元格：`padding: 8px 10px`，`border-bottom: 1px solid #e5e7eb`
- 斑马行：`tbody tr:nth-child(even)` 背景 `#f9fafb`
- 悬停：`background: #eef2ff`

**表格内编辑态输入框**（如“常用账号”“本地文件管理工具”等页面）

- 使用 `.remark-input` / `.edit-input`（或等价类名），并遵循：
  - 高度：`36px`（与通用输入框一致）
  - 宽度：`100%`，但通过单元格 `padding: 8px 10px` 控制左右留白
  - 左右间距：输入框与其所在表格区域左右边框之间的距离固定为 `10px`
  - 聚焦态：与 `.field-control` 相同（蓝色边框 + 内侧 outline）

**操作链接** `.operation-btn`

- 无背景，`color: #0078E1`
- font-size：12px

### 5.7 侧边栏与列表项

**侧边栏** `.notes-sidebar` / `.bookmarks-sidebar`

- width：260px / 200px
- border：`1px solid #e5e7eb`
- border-radius：8px

**列表项** `.notes-list-item` / `.bookmarks-category-item`

- padding：`10px 16px` 或 `10px 12px`
- 悬停：`background: #f3f4f6`
- 选中：`background: #e8f5e9`，`border-left: 3px solid #4caf50`

### 5.8 Toast

```html
<div id="toast-container"></div>
```

- 位置：`top: 96px`，居中
- 类名：`.toast-info` / `.toast-success` / `.toast-error`
- 背景：主色 / 绿 / 红

### 5.9 右侧抽屉 Drawer

用于详情查看、编辑、创建（例如单词本的“加入词汇本 / 编辑”）。

#### 结构

```html
<div class="xxx-drawer-overlay"></div>
<div class="xxx-drawer">
  <div class="xxx-drawer-header">
    <span class="xxx-drawer-title">标题</span>
    <button class="xxx-drawer-close">×</button>
  </div>
  <div class="xxx-drawer-body">
    <!-- 表单字段 / 内容 -->
  </div>
  <div class="xxx-drawer-footer">
    <button class="btn">取消</button>
    <button class="btn primary">保存</button>
  </div>
</div>
```

#### 布局与尺寸

- 遮罩：`position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 999;`
- 抽屉容器：
  - `position: fixed; top: 0; right: 0; height: 100%;`
  - `width: 100%; max-width: 720px;`
  - `display: flex; flex-direction: column;`
  - 背景：白色（深色主题下由 `theme.css` 覆盖）
  - 阴影：`box-shadow: -4px 0 20px rgba(0,0,0,0.15);`
  - 进入动画：通过 `transform: translateX(100%)` / `.open { transform: translateX(0); }`
- Header：
  - padding：`20px 24px`
  - 底部分割线：`1px solid #e5e7eb`
  - 左侧标题 + 右侧关闭按钮（flex 对齐）
- Body：
  - `flex: 1; overflow-y: auto;`
  - padding：`24px`
  - 字段容器 `.xxx-drawer-field`：`margin-bottom: 20px`
- Footer：
  - padding：`16px 24px`
  - 顶部分割线：`1px solid #e5e7eb`
  - 右对齐按钮：`display: flex; gap: 12px; justify-content: flex-end;`

> 单词本抽屉示例：5 个字段（单词展示、发音、中文释义富文本、英文释义富文本、分组标签 + 同义词）在 1080p 屏幕上可一屏展示主要内容。后续新增右侧抽屉，请以本规范为基础统一实现样式与结构。

---

## 6. 布局规范

### 6.1 页面容器

```css
.app-container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px 24px 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
}
```

### 6.2 左右分栏

```css
.xxx-layout {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: 12px;
    min-height: 0;
    overflow: hidden;
}
```

- 使用 `align-items: stretch` 保证左右等高
- gap：12px

### 6.3 表单行

```css
.control-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
}
```

**字段组** `.field-group`

- `display: inline-flex`
- `align-items: center`
- `gap: 8px`

**同行字段间距** `.inline-fields-gap`

- 同行排列的筛选框、按钮等控件组统一使用 `gap: 12px`
- 全局生效，确保同一行内元素间距一致

```css
.inline-fields-gap {
    display: flex;
    align-items: center;
    gap: 12px;
}
```

### 6.4 页面宽度统一

- 所有页面（含词汇本、复习模式）均使用 **同一页面宽度**：由 `.app-container` 控制，`max-width: 1400px`，`margin: 0 auto`，水平 `padding: 24px`。
- 词汇本 / 复习模式等子页面**不得**在 main 或内容容器上再设置更窄的 `max-width`，以与其他页面（首页、打卡、笔记、书签等）保持一致。

### 6.5 响应式

- 900px 以下：home-grid 2 列、表格字体缩小
- 700px 以下：calendar-layout 单列

---

## 7. 新页面开发检查清单

- [ ] 引入 `style.css` 和 `theme.css`
- [ ] 使用 `app-container`、`app-header`、`header-actions` 结构
- [ ] 包含 `#theme-switcher-container` 和 `#toast-container`
- [ ] 按钮使用 `.btn` / `.btn.primary`
- [ ] 输入框使用 `.field-control` 或 `.notes-form-input`
- [ ] 卡片使用 `.control-panel` / `.table-section` / `.card`
- [ ] 表格使用 `.file-table`，包裹在 `.table-section` 中
- [ ] 间距使用 8/12/16/20px，圆角使用 4/6/8px
- [ ] 在 `theme.css` 中补充 dark/checkin/yellow-green 主题覆盖（如适用）

---

## 8. 禁止事项

- 禁止使用 Element Plus 或其他 UI 框架（项目为原生实现）
- 禁止自定义与规范冲突的按钮、输入框、卡片样式
- 禁止使用规范外的颜色值（主色、边框、背景等）
- 禁止使用规范外的间距（如 10px、18px 等非标准值）
