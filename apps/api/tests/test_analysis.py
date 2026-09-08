from fastapi.testclient import TestClient
from test_participants import gaze_batch, ready_session


def complete_study_with_samples(client: TestClient) -> tuple[dict, dict[str, str]]:
    session, headers = ready_session(client)
    task_endpoint = f"/api/v1/participant-sessions/{session['id']}/task-runs"
    batch_endpoint = f"/api/v1/participant-sessions/{session['id']}/gaze-batches"
    batch_ids = [
        "aaf26cf0-9dd1-4f0d-b970-7cb45471228e",
        "ad51fd53-d13c-4691-b7f5-6280fa9dc9de",
    ]
    for position, batch_id in enumerate(batch_ids, start=1):
        started = client.post(task_endpoint, headers=headers, json={"task_position": position})
        assert started.status_code == 201
        uploaded = client.post(
            batch_endpoint,
            headers=headers,
            json=gaze_batch(batch_id, position - 1, x=position / 4),
        )
        assert uploaded.status_code == 201
        completed = client.post(
            f"{task_endpoint}/{started.json()['id']}/complete",
            headers=headers,
            json={"outcome": "completed"},
        )
        assert completed.status_code == 200
    return session, headers


def test_submission_queues_idempotent_analysis_and_task_metrics(client: TestClient) -> None:
    session, headers = complete_study_with_samples(client)
    submit_endpoint = f"/api/v1/participant-sessions/{session['id']}/submit"

    submitted = client.post(submit_endpoint, headers=headers)
    assert submitted.status_code == 200
    body = submitted.json()
    assert body["lifecycle"] == "submitted"
    assert body["analysis_job"]["status"] == "queued"
    assert body["replayed"] is False

    replay = client.post(submit_endpoint, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["analysis_job"]["id"] == body["analysis_job"]["id"]

    job_id = body["analysis_job"]["id"]
    pending = client.get(f"/api/v1/analysis-jobs/{job_id}/result")
    assert pending.status_code == 409
    assert pending.json()["error"]["code"] == "ANALYSIS_RESULT_PENDING"

    result = client.post(f"/api/v1/analysis-jobs/{job_id}/run")
    assert result.status_code == 200
    result_body = result.json()
    assert result_body["quality"]["batch_continuity"] == "complete"
    assert result_body["quality"]["calibration_quality"] == "strong"
    assert result_body["diagnostics"]["sample_count"] == 2
    metrics = result_body["task_metrics"]["tasks"]
    assert [metric["task_position"] for metric in metrics] == [1, 2]
    assert [metric["sample_count"] for metric in metrics] == [1, 1]
    assert metrics[0]["centroid"]["x_normalized"] == 0.25

    job = client.get(f"/api/v1/analysis-jobs/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "succeeded"
    repeated_run = client.post(f"/api/v1/analysis-jobs/{job_id}/run")
    assert repeated_run.status_code == 200
    assert repeated_run.json()["id"] == result_body["id"]
