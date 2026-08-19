# 记忆记录模板

使用以下字段组织候选记忆。具体存储格式服从当前平台，不要求逐字使用这些键名。

```yaml
subject: 用户
category: preferred-name | language | timezone | communication | tool-preference | project-alias | role | workflow
statement: 用户明确确认的最小事实或偏好
scope: global | project:<name> | task-type:<name> | time-bound:<range>
reuse_rule: 未来何时应用这条记录
boundary: 不应从该记录推断的内容
status: active | superseded | delete-requested
source: explicit-user-instruction
```

## 示例

### 项目别名

```yaml
subject: 用户
category: project-alias
statement: 在“灯塔改版”项目中，用“灯塔”指代“灯塔官网改版项目”
scope: project:灯塔官网改版项目
reuse_rule: 仅在该项目的后续沟通中使用“灯塔”
boundary: 这只是命名偏好，不代表项目状态或范围已确认
status: active
source: explicit-user-instruction
```

### 沟通偏好

```yaml
subject: 用户
category: communication
statement: 默认先给结论，再给必要细节
scope: global
reuse_rule: 在未指定其他格式时采用结论优先的表达顺序
boundary: 不限制用户明确要求的长文、逐步教程或固定模板
status: active
source: explicit-user-instruction
```

## 更正模板

当用户更正已有记忆时，记录新的有效值，并按平台机制更新旧记录：

```yaml
statement: 新的明确值
status: active
supersedes: 旧记录的标识或可检索描述
```

不要同时保留两条看似都有效、实际互相冲突的记录。
