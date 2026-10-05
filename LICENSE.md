# ZHIRAI 短剧创作系统 —— 专有软件许可协议

**版本：1.0.0（免费版）**
**版权所有 © 2026 ZHIRAI (zhirai-tech)。保留所有权利。**

> ⚠️ **重要：这不是开源协议。** 本软件是**专有软件（proprietary software）**，
> 本协议不是 MIT / Apache / GPL 等任何开源许可证，也不授予开源软件所赋予的权利。
> 源代码以**加密形式**分发，**不提供源码**。

---

## 一、定义

- **「本软件」**：本目录下的 DeepSeek Harness bundle，包括 `cordis.patch.yml`、
  `index.js`、`_7f2c.cjs`、`_7f2c/`（加密资源包）、`agents/`、`locale/`、`icon.svg`
  及其全部文档。
- **「加密资源」**：`_7f2c/` 与 `_7f2c.cjs` 中封装的提示词、角色技能、调度拓扑等核心内容。
- **「您」**：安装或使用本软件的自然人或法人。

## 二、授予的权利

在遵守本协议全部条款的前提下，ZHIRAI 授予您一项**免费的、非独占的、不可转让的**
许可，用于：

1. **个人使用**：在您自己的设备上安装并使用本软件进行创作；
2. **商业创作使用**（免费版）：使用本软件产出的剧本、分镜、提示词等
   创作成果（「产出内容」）归**您**所有，您可自由用于商业项目；
3. **备份**：为您自己的使用目的复制本软件以作备份。

**产出内容的权利归您**：本软件不主张对您使用它生成的作品拥有任何权利。

## 三、限制

未经 ZHIRAI 事先书面许可，您**不得**：

1. **逆向工程**：反编译、反汇编、解密、脱壳，或以其他方式试图获取本软件的
   源代码、加密资源或内部实现（包括但不限于提取提示词、角色技能、调度拓扑）；
2. **规避保护**：移除、绕过、禁用或以其他方式干扰本软件的加密与保护机制；
3. **再分发**：出售、出租、转授权、分发本软件或其任何部分（含加密资源包），
   无论是否修改、是否收费；
4. **改造后再分发**：修改本软件后以任何形式对外提供；
5. **去除标识**：移除或篡改本软件的版权声明、许可协议、水印（免费版产出文件的末尾水印）或版本标识；
6. **用于训练**：将本软件的提示词、加密资源或其解密内容用于训练、微调任何机器学习模型；
7. **商业转售**：将本软件本身（而非其产出内容）作为商品或服务的一部分对外销售。

## 四、开源声明

本软件**不是开源软件**：

- **不提供源码**：核心知识资产（6 个 Agent 的 persona、5 个派活子 Agent persona、
  6 份角色技能、落盘结构、调度拓扑）以 AES-256-GCM 加密形式分发。
- **不授予源码权利**：本协议不授予您获取、阅读、修改、再分发源码的任何权利。
- **无开源许可证**：本软件不受任何开源许可证约束，也不包含任何开源许可证的授权。

## 五、第三方组件

本软件运行于 DeepSeek Harness（DSH）之上，依赖 DSH 提供的运行时与插件机制。
DSH 及其组件适用其各自的许可条款，与本协议无关。本软件通过 DSH 官方插件机制加载，
**未修改 DSH 本体**。

## 六、无担保

本软件按**「现状」**提供，不附带任何明示或默示的担保，包括但不限于对
适销性、特定用途适用性、不侵权的担保。ZHIRAI 不保证本软件无错误、
不保证其运行不中断、不保证产出内容符合任何特定标准或平台要求。

## 七、责任限制

在适用法律允许的最大范围内，ZHIRAI 不对任何间接的、附带的、特殊的、
惩罚性的或后果性的损害承担责任，包括但不限于利润损失、数据丢失、
业务中断，无论其如何引起、基于何种责任理论，即使已被告知此类损害的可能性。

## 八、协议终止

您违反本协议任一条款时，本协议授予的许可**自动终止**，无需通知。
终止后您必须立即停止使用并删除本软件的全部副本。

## 九、适用法律

本协议的解释与适用，以中华人民共和国法律为准。

## 十、联系方式

如需商业授权、定制开发或其他许可安排，请通过项目仓库联系：
https://github.com/zhirai-tech/zhirai-short-drama-agents

---

## English Summary (non-binding)

This is **proprietary software**, NOT open source. The source code is distributed
in **encrypted form** and is not provided. The license above grants you a free,
non-exclusive, non-transferable right to **use** this software for personal and
commercial creation, and **you own the content you create with it**.

You may **NOT**: reverse engineer, decompile, decrypt, or attempt to extract the
encrypted assets (prompts, agent skills, topology); bypass or disable the
protection mechanisms; redistribute, resell, or sublicense this software or any
part of it; remove copyright notices or watermarks; or use its prompts to train
machine-learning models.

The software is provided "AS IS" without warranty of any kind. The Chinese text
above is the binding version; this summary is for convenience only.
