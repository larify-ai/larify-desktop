# Workflow

```text
phase = Explore

while True:
    if phase == Explore:
        follow the `nest-explore` skill
    elif phase == Execute:
        follow the `nest-execute` skill
        phase = Critique
    elif phase == Critique:
        follow the `nest-critique` skill
    elif phase == Reflect:
        follow the `nest-reflect` skill

    if verdict is `schedule` or `terminate`:
        return verdict

    otherwise, continue with the phase selected by the skill
```
