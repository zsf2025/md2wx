# md2wx 转换测试

这是一段**加粗**、*斜体*、~~删除线~~和 `inline code` 的正文测试，用于验证两端对齐与行高。

## 列表测试

- 第一项：列表间距修复
- 第二项：`break-all` 防止巨大空白
  1. 有序子项 A
  2. 有序子项 B

## 表格测试

| 列A | 列B (长文本) |
| :--- | :--- |
| 短文本 | 这里是一段比较长的文本，测试 table cell 的等距拉伸问题是否解决。 |

## 引用测试

> 引用块：左侧绿色边框，浅灰背景。

## 代码块测试

```javascript
function md2wx(md) {
  // 中文注释 & 缩进保留测试
  const html = render(md);
  return html;
}
```

## 图片与分割线

![测试图片](https://mmbiz.qpic.cn/example.png)

---

结束。
