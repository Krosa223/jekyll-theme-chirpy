---
title: "解决word中mathtype选项变灰色无法使用的问题"
date: 2026-07-25 21:43:37 +0800
media_subpath: /assets/post_image/解决word中mathtype选项变灰色无法使用的问题
image:
  path: cover.webp
  alt: "mathtype问题解决"
categories: [电脑问题解决]
tags: [mathtype, 电脑问题解决]
---
mathtype打开第一个文档还是好的，切换文档或者重新启动文档后突然变成灰色无法使用。解决方案如下：找到文件 -> 选项 -> 加载项 -> mathyepe的加载项，选中mathtype项找到其路径。

复制其路径（弹窗内无法直接复制，可以自行转到文件管理器内复制），然后打开文件 -> 选项 -> 信任中心 ->  信任中心设置 -> 受信任位置，选中添加新位置，将路径黏贴进去即可。
