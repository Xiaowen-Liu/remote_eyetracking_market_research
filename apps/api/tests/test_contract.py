from webgaze_api.schemas import StudyDraft


def valid_study():
    return {
        "title": "Pricing attention",
        "consent_version": "1.0",
        "consent_text": "I agree to local webcam-based gaze estimation.",
        "target_origins": ["https://example.test"],
        "tasks": [
            {
                "position": 1,
                "title": "Choose a plan",
                "prompt": "Find the plan suitable for a ten-person team.",
                "start_url": "https://example.test/pricing",
                "areas_of_interest": [
                    {
                        "label": "Professional plan",
                        "source": "manual",
                        "x": 0.1,
                        "y": 0.2,
                        "width": 0.3,
                        "height": 0.2,
                    }
                ],
            }
        ],
    }


def test_study_contract_accepts_one_to_four_contiguous_tasks():
    study = StudyDraft.model_validate(valid_study())
    assert len(study.tasks) == 1
    assert str(study.tasks[0].start_url) == "https://example.test/pricing"


def test_openapi_has_stable_operation_ids_and_error_schema(client):
    schema = client.get("/api/v1/openapi.json").json()
    assert schema["paths"]["/api/v1/projects"]["post"]["operationId"] == "createProject"
    assert (
        schema["paths"]["/api/v1/projects/{project_id}/studies"]["post"]["operationId"]
        == "createStudy"
    )
    assert (
        schema["paths"]["/api/v1/studies/{study_id}/publish"]["post"]["operationId"]
        == "publishStudy"
    )
    assert (
        schema["paths"]["/api/v1/participate/{token}"]["get"]["operationId"]
        == "resolveParticipantLink"
    )
    assert (
        schema["paths"]["/api/v1/participant-sessions/{session_id}/calibrations"]["post"]
        ["operationId"]
        == "recordCalibrationResult"
    )
    assert (
        schema["paths"]["/api/v1/participant-sessions/{session_id}/gaze-batches"]["post"]
        ["operationId"]
        == "ingestGazeBatch"
    )
    assert "ErrorResponse" in schema["components"]["schemas"]
