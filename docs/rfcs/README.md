# Project RFCs

本目录包含会务系统的 RFC（Request for Comments）文档。RFC 是项目设计、范围、接口契约和实现任务的单一事实来源。

## RFC 状态

| 状态 | 说明 |
|------|------|
| `draft` | 草稿，正在讨论 |
| `accepted` | 已接受，待实现 |
| `implementing` | 实现中 |
| `implemented` | 已实现 |
| `superseded` | 被后续 RFC 取代 |
| `rejected` | 已拒绝 |

## RFC 列表

### 会务系统

| RFC | 标题 | 状态 | 优先级 |
|-----|------|------|--------|
| [RFC-0001](./0001-local-meeting-room-system.md) | 本地会议室查询与预订系统 | implementing | P0 |

## RFC 编号规则

- 使用 4 位数字编号，如 `0001`。
- 编号顺序分配，不跳号。
- 被取代或拒绝的 RFC 保留原编号。
- RFC 元数据只能通过 `ncoder rfc` 命令维护，不直接编辑 `meta/*.json`。

