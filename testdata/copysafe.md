# 剪贴板白名单回归样例

用于 `scripts/test_copysafe.js`：覆盖只在 copySafe() 阶段生效的逻辑（属性白名单 / 标签白名单 /
代码行号 DOM 化 / 任务列表勾选态）。这些用例在 DOM 桩环境下不可测，必须是真实 DOM。

## 任务列表

- [x] 已完成事项
- [ ] 未完成事项

## 表格

| 列 A | 列 B |
|:---|:---:|
| 单元格 | 内容 |

## 代码块

```js
const a = 1;
console.log(a);
```

## 引用与图片

> 引用段落

![图片](https://www.workbuddy.cn/favicon.ico)

## 链接与分割线

[链接文字](https://example.com)

---

## 原始 HTML（标签/属性白名单测试）

<div style="color:#07c160;" id="raw" data-x="1" onclick="alert(1)">原始 HTML 块</div>

<details><summary>折叠标题</summary>折叠内容必须保留</details>

其他标签：<abbr title="tip">API</abbr>、<meter value="0.7">70%</meter>、<progress value="3" max="10">30%</progress>、<marquee>跑马灯文字</marquee>、<kbd>Ctrl</kbd>

<img src="https://www.workbuddy.cn/favicon.ico" onerror="alert(1)" alt="带 onerror 的图">

<script>alert('危险脚本内容');</script>
