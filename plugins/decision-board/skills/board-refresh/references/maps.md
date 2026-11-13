# Example maps

Read this only when you write the map of a new source (step 2 of `SKILL.md`). Each value names a row field. A
value in `equals` is compared as text, case ignored, so `4` and `true` match too. Every url must be on a host of
`link_hosts`, for example `tracker.example.com`.

An issue tracker that exports `number`, `title`, `url`, `created_at`, `state` and `labels`:

```json
{"key": "number", "title": "title", "url": "url", "created": "created_at",
 "closed": {"field": "state", "equals": ["closed"]},
 "priority": [{"field": "labels.name", "equals": ["p1", "urgent"], "priority": "now"},
              {"field": "labels.name", "equals": ["p3"], "priority": "later"}],
 "tags": [{"field": "labels.name", "equals": "incident", "tag": "incident"}]}
```

A task list that exports `id`, `content`, `url`, `created_at`, `due.date`, `priority` and `is_completed`:

```json
{"key": "id", "title": "content", "url": "url", "created": "created_at", "due": "due.date",
 "closed": {"field": "is_completed", "equals": [true]},
 "priority": [{"field": "priority", "equals": [4], "priority": "now"}]}
```
