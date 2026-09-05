from webgaze_api.models import TaskRun


def test_only_one_running_task_is_allowed_per_session() -> None:
    index = next(
        item for item in TaskRun.__table__.indexes if item.name == "uq_one_running_task_per_session"
    )

    assert index.unique is True
    assert [column.name for column in index.columns] == ["session_id"]
    assert str(index.dialect_options["postgresql"]["where"]) == "outcome = 'RUNNING'"
    assert str(index.dialect_options["sqlite"]["where"]) == "outcome = 'RUNNING'"
