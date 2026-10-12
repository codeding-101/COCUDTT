# PDF 字体资源

`quote-sans.base64.txt` 为 zlib 压缩、base64 编码的本地 TrueType 字体；来源、哈希与覆盖在 `provenance.json`，许可在 `LICENSE-OFL.txt`。源字体 Noto Sans CJK SC 的派生资源更名为 COCUDTT Quote Sans SC，并保留版权及 OFL 信息。

运行 `python tools/build-quote-font.py /path/to/NotoSansCJKsc-Regular.otf` 复建；需要 fontTools 4.65.0，上游文件必须通过脚本内固定的 SHA-256。普通 npm 构建无需复建。生成 PDF 时完整嵌入这个已减少字符集的资源，不再次用 fontkit 子集化；曾遇到提取正确但渲染缺字，任何变更须独立渲染及逐页查看。

支持 8663 个字符，不承诺全部 Unicode；应用遇到不支持字符明确退出并保留原文。应用本身的 Apache-2.0 许可不覆盖这个 OFL 字体。完整验收见 [PDF 验收](../../../docs/pdf-validation.md)。
